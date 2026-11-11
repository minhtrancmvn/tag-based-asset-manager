import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, it } from "node:test";
import worker from "./src/worker.mjs";

const fixtures = JSON.parse(readFileSync(new URL("../fixtures/usage-payload.json", import.meta.url), "utf8"));
const spec = JSON.parse(readFileSync(new URL("../usage-events.json", import.meta.url), "utf8"));
const workerSource = readFileSync(new URL("./src/worker.mjs", import.meta.url), "utf8");

const MEASUREMENT_ID = "G-TEST123";
const API_SECRET = "s3cr3t-value";
const CLIENT_IP = "203.0.113.7";
const URL_EVENTS = "https://proxy.example/v1/events";

const realFetch = globalThis.fetch;
let fetchCalls;
let fetchImpl;
let limitCalls;
let limitResult;

function makeEnv(overrides = {}) {
  return {
    GA_MEASUREMENT_ID: MEASUREMENT_ID,
    GA_API_SECRET: API_SECRET,
    FORWARD: "on",
    USAGE_RATE_LIMIT: {
      limit: async (o) => {
        limitCalls.push(o);
        return limitResult;
      },
    },
    ...overrides,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function post(body, { path = "/v1/events", method = "POST", headers = {}, cf } = {}) {
  const init = { method, headers: { "content-type": "application/json", ...headers } };
  if (method !== "GET" && method !== "HEAD" && body !== undefined) {
    if (body instanceof ReadableStream) {
      init.body = body;
      init.duplex = "half";
    } else {
      init.body = typeof body === "string" || body instanceof Uint8Array ? body : JSON.stringify(body);
    }
  }
  const req = new Request(`https://proxy.example${path}`, init);
  if (cf !== undefined) Object.defineProperty(req, "cf", { value: cf });
  return req;
}

function base(name = "app_open") {
  return clone(fixtures[name]);
}

async function expectRejected(request, status, env = makeEnv()) {
  const res = await worker.fetch(request, env);
  assert.equal(res.status, status);
  assert.equal(await res.text(), "");
  assert.equal(fetchCalls.length, 0, "fetch must not be called");
  return res;
}

function expectBad(mutate, name = "app_open") {
  const body = base(name);
  mutate(body);
  return expectRejected(post(body), 400);
}

beforeEach(() => {
  fetchCalls = [];
  limitCalls = [];
  limitResult = { success: true };
  fetchImpl = async () => new Response("", { status: 200 });
  globalThis.fetch = async (input, init) => {
    fetchCalls.push({ input, init });
    return fetchImpl(input, init);
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function forwarded(index = 0) {
  const call = fetchCalls[index];
  assert.ok(call, "expected a forwarded fetch call");
  let url;
  let method;
  let headers;
  let bodyText;
  if (call.input instanceof Request) {
    url = call.input.url;
    method = call.input.method;
    headers = call.input.headers;
    bodyText = call.init?.body;
  } else {
    url = String(call.input);
    method = call.init?.method;
    headers = new Headers(call.init?.headers);
    bodyText = call.init?.body;
  }
  return { url: new URL(url), rawUrl: url, method, headers, bodyText, body: JSON.parse(bodyText) };
}

describe("routing", () => {
  it("returns 404 for the wrong path", async () => {
    await expectRejected(post(base(), { path: "/v2/events" }), 404);
    await expectRejected(post(base(), { path: "/" }), 404);
  });

  it("returns 405 for the wrong method", async () => {
    await expectRejected(post(undefined, { method: "GET" }), 405);
    await expectRejected(post(base(), { method: "PUT" }), 405);
  });
});

describe("body cap", () => {
  it("returns 413 when content-length is over the cap", async () => {
    await expectRejected(post("{}", { headers: { "content-length": "8193" } }), 413);
  });

  it("returns 413 for an oversize body without relying on content-length", async () => {
    const big = JSON.stringify({ pad: "x".repeat(9000) });
    const req = post(new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(big));
        c.close();
      },
    }));
    await expectRejected(req, 413);
  });

  it("returns 413 for an oversize body with a lying content-length", async () => {
    const big = JSON.stringify({ pad: "x".repeat(9000) });
    await expectRejected(post(big, { headers: { "content-length": "10" } }), 413);
  });

  it("returns 413 for a streamed body that exceeds the cap in chunks", async () => {
    const chunk = new TextEncoder().encode("x".repeat(3000));
    const req = new Request(URL_EVENTS, {
      method: "POST",
      body: new ReadableStream({
        start(c) {
          for (let i = 0; i < 4; i += 1) c.enqueue(chunk);
          c.close();
        },
      }),
      duplex: "half",
    });
    await expectRejected(req, 413);
  });

  it("accepts a body of exactly 8192 bytes as far as the cap goes", async () => {
    const res = await worker.fetch(post(" ".repeat(8192 - 2) + "{}"), makeEnv());
    assert.equal(res.status, 400);
    assert.equal(fetchCalls.length, 0);
  });
});

describe("validation", () => {
  it("rejects invalid JSON", async () => {
    await expectRejected(post("{not json"), 400);
    await expectRejected(post(""), 400);
  });

  it("rejects non-object JSON", async () => {
    for (const text of ["[]", "null", "42", '"str"', "true"]) {
      await expectRejected(post(text), 400);
    }
  });

  it("rejects a missing top-level key", async () => {
    for (const key of ["client_id", "device", "events"]) {
      await expectBad((b) => delete b[key]);
    }
  });

  it("rejects an extra top-level key", async () => {
    await expectBad((b) => {
      b.user_id = "abc";
    });
    await expectBad((b) => {
      b.ip_override = CLIENT_IP;
    });
  });

  it("rejects an uppercase client_id", async () => {
    await expectBad((b) => {
      b.client_id = "AAAAAAAA-0000-4000-8000-000000000000";
    });
  });

  it("rejects malformed client_id values", async () => {
    for (const v of ["", "not-a-uuid", "00000000-0000-4000-8000-00000000000", "00000000000040008000000000000000", " 00000000-0000-4000-8000-000000000000", 123, null, {}]) {
      await expectBad((b) => {
        b.client_id = v;
      });
    }
  });

  it("rejects a device with the wrong category", async () => {
    await expectBad((b) => {
      b.device.category = "mobile";
    });
  });

  it("rejects a device with an extra key", async () => {
    await expectBad((b) => {
      b.device.model = "x";
    });
  });

  it("rejects a device missing a key or of the wrong type", async () => {
    await expectBad((b) => delete b.device.category);
    await expectBad((b) => delete b.device.operating_system);
    await expectBad((b) => {
      b.device = "desktop";
    });
    await expectBad((b) => {
      b.device = null;
    });
  });

  it("rejects an unknown device operating system", async () => {
    await expectBad((b) => {
      b.device.operating_system = "BeOS";
    });
  });

  it("rejects zero events", async () => {
    await expectBad((b) => {
      b.events = [];
    });
  });

  it("rejects two events", async () => {
    await expectBad((b) => {
      b.events.push(clone(b.events[0]));
    });
  });

  it("rejects events that is not an array", async () => {
    await expectBad((b) => {
      b.events = b.events[0];
    });
  });

  it("rejects an extra key on the event", async () => {
    await expectBad((b) => {
      b.events[0].timestamp_micros = 1;
    });
  });

  it("rejects an event missing name or params", async () => {
    await expectBad((b) => delete b.events[0].name);
    await expectBad((b) => delete b.events[0].params);
  });

  it("rejects an unknown event name", async () => {
    await expectBad((b) => {
      b.events[0].name = "purchase";
    });
    await expectBad((b) => {
      b.events[0].name = 5;
    });
  });

  it("rejects a missing common param", async () => {
    for (const key of spec.commonParams) {
      await expectBad((b) => delete b.events[0].params[key]);
    }
  });

  it("rejects an extra param", async () => {
    await expectBad((b) => {
      b.events[0].params.extra = "x";
    });
  });

  it("rejects an extra param on an event that has none", async () => {
    await expectBad((b) => {
      b.events[0].params.theme = "workshop";
    });
    await expectBad((b) => {
      b.events[0].params.size_range = "under_100";
    });
  });

  it("rejects the wrong extra param", async () => {
    await expectBad((b) => {
      b.events[0].params.size_range = "under_100";
      delete b.events[0].params.theme;
    }, "theme_change");
    await expectBad((b) => {
      b.events[0].params.theme = "workshop";
      delete b.events[0].params.size_range;
    }, "library_scanned");
  });

  it("rejects a missing extra param", async () => {
    await expectBad((b) => delete b.events[0].params.theme, "theme_change");
    await expectBad((b) => delete b.events[0].params.size_range, "library_scanned");
  });

  it("rejects params that is not an object", async () => {
    await expectBad((b) => {
      b.events[0].params = [];
    });
    await expectBad((b) => {
      b.events[0].params = null;
    });
  });

  it("rejects session_id with non-digits", async () => {
    for (const v of ["abc", "12a", "", "-1", "1.5", " 1", "1".repeat(21)]) {
      await expectBad((b) => {
        b.events[0].params.session_id = v;
      });
    }
  });

  it("rejects session_id of number type", async () => {
    await expectBad((b) => {
      b.events[0].params.session_id = 1700000000;
    });
  });

  it("rejects engagement_time_msec out of range", async () => {
    for (const v of [0, 60001, -5]) {
      await expectBad((b) => {
        b.events[0].params.engagement_time_msec = v;
      });
    }
  });

  it("rejects non-integer engagement_time_msec", async () => {
    for (const v of [1.5, "1000", null, true, [], {}]) {
      await expectBad((b) => {
        b.events[0].params.engagement_time_msec = v;
      });
    }
  });

  it("accepts the engagement_time_msec bounds", async () => {
    for (const v of [1, 60000]) {
      const body = base();
      body.events[0].params.engagement_time_msec = v;
      const res = await worker.fetch(post(body), makeEnv());
      assert.equal(res.status, 204);
    }
  });

  it("rejects malformed app_version", async () => {
    for (const v of ["1.2", "1.2.3.4", "v1.2.3", "1.2.x", "1.2.3-beta", "", " 1.2.3", "1.2.3\n", 123, null]) {
      await expectBad((b) => {
        b.events[0].params.app_version = v;
      });
    }
  });

  it("rejects unknown edition", async () => {
    await expectBad((b) => {
      b.events[0].params.edition = "enterprise";
    });
  });

  it("rejects unknown params operating_system", async () => {
    await expectBad((b) => {
      b.events[0].params.operating_system = "BeOS";
    });
  });

  it("rejects unknown theme", async () => {
    await expectBad((b) => {
      b.events[0].params.theme = "neon";
    }, "theme_change");
  });

  it("rejects unknown size_range", async () => {
    await expectBad((b) => {
      b.events[0].params.size_range = "huge";
    }, "library_scanned");
  });

  it("rejects wrong types for string params", async () => {
    for (const key of ["edition", "operating_system", "app_version", "session_id"]) {
      for (const v of [1, true, null, {}, ["github"]]) {
        await expectBad((b) => {
          b.events[0].params[key] = v;
        });
      }
    }
    for (const v of [1, true, null, {}]) {
      await expectBad((b) => {
        b.events[0].params.theme = v;
      }, "theme_change");
      await expectBad((b) => {
        b.events[0].params.size_range = v;
      }, "library_scanned");
    }
  });

  it("rejects prototype-style keys", async () => {
    await expectRejected(post('{"client_id":"00000000-0000-4000-8000-000000000000","device":{"category":"desktop","operating_system":"macOS"},"events":[],"__proto__":{}}'), 400);
  });
});

describe("accepted payloads", () => {
  it("fixture covers every allowlisted event", () => {
    assert.deepEqual(Object.keys(fixtures).sort(), [...spec.events].sort());
  });

  for (const name of Object.keys(fixtures)) {
    it(`accepts and forwards the ${name} fixture once`, async () => {
      const res = await worker.fetch(post(fixtures[name]), makeEnv());
      assert.equal(res.status, 204);
      assert.equal(await res.text(), "");
      assert.equal(fetchCalls.length, 1);
      assert.equal(forwarded().body.events[0].name, name);
    });
  }
});

describe("forwarding", () => {
  it("posts to the GA collect endpoint with credentials in the query", async () => {
    await worker.fetch(post(base()), makeEnv());
    const f = forwarded();
    assert.equal(`${f.url.origin}${f.url.pathname}`, "https://www.google-analytics.com/mp/collect");
    assert.equal(f.url.searchParams.get("measurement_id"), MEASUREMENT_ID);
    assert.equal(f.url.searchParams.get("api_secret"), API_SECRET);
    assert.deepEqual([...f.url.searchParams.keys()].sort(), ["api_secret", "measurement_id"]);
    assert.equal(f.method, "POST");
  });

  it("forwards the input body plus denied consent and no location when cf is absent", async () => {
    const input = base();
    await worker.fetch(post(input), makeEnv());
    const f = forwarded();
    assert.deepEqual(f.body, { ...input, consent: { ad_user_data: "DENIED", ad_personalization: "DENIED" } });
    assert.ok(!("user_location" in f.body));
  });

  it("adds user_location.country_id from cf.country", async () => {
    const input = base();
    await worker.fetch(post(input, { cf: { country: "JP" } }), makeEnv());
    const f = forwarded();
    assert.deepEqual(f.body, {
      ...input,
      user_location: { country_id: "JP" },
      consent: { ad_user_data: "DENIED", ad_personalization: "DENIED" },
    });
  });

  it("omits user_location for XX, T1 and malformed countries", async () => {
    for (const country of ["XX", "T1", "", "J", "JPN", undefined, 5]) {
      fetchCalls.length = 0;
      await worker.fetch(post(base(), { cf: { country } }), makeEnv());
      assert.ok(!("user_location" in forwarded().body), `country ${String(country)}`);
    }
    fetchCalls.length = 0;
    await worker.fetch(post(base(), { cf: {} }), makeEnv());
    assert.ok(!("user_location" in forwarded().body));
  });

  it("rebuilds the body from validated fields", async () => {
    const spaced = JSON.stringify(base(), null, 4);
    await worker.fetch(post(spaced), makeEnv());
    const f = forwarded();
    assert.ok(!f.bodyText.includes("\n"));
    assert.deepEqual(Object.keys(f.body).sort(), ["client_id", "consent", "device", "events"]);
  });

  it("never sends ip_override or any client IP", async () => {
    const headers = {
      "cf-connecting-ip": CLIENT_IP,
      "x-real-ip": CLIENT_IP,
      "x-forwarded-for": CLIENT_IP,
      "user-agent": "SecretAgent/9.9",
      cookie: "sid=abc123",
      authorization: "Bearer topsecret",
    };
    await worker.fetch(post(base(), { headers, cf: { country: "JP" } }), makeEnv());
    const f = forwarded();
    assert.ok(!f.bodyText.includes("ip_override"));
    assert.ok(!f.bodyText.includes(CLIENT_IP));
    assert.ok(!f.rawUrl.includes(CLIENT_IP));
    for (const [k, v] of f.headers) {
      assert.ok(!v.includes(CLIENT_IP), `header ${k}`);
    }
    assert.ok(!JSON.stringify(f.body).includes("ip_override"));
  });

  it("sends only the content-type header", async () => {
    const headers = {
      "cf-connecting-ip": CLIENT_IP,
      "x-real-ip": CLIENT_IP,
      "x-forwarded-for": CLIENT_IP,
      "user-agent": "SecretAgent/9.9",
      cookie: "sid=abc123",
      authorization: "Bearer topsecret",
    };
    await worker.fetch(post(base(), { headers }), makeEnv());
    const f = forwarded();
    assert.deepEqual([...f.headers.keys()], ["content-type"]);
    assert.equal(f.headers.get("content-type"), "application/json");
    for (const name of Object.keys(headers)) {
      assert.equal(f.headers.has(name), false, name);
    }
  });

  it("does not pass the incoming request object to fetch", async () => {
    const req = post(base());
    await worker.fetch(req, makeEnv());
    assert.notEqual(fetchCalls[0].input, req);
  });

  it("returns 204 when GA responds 200", async () => {
    fetchImpl = async () => new Response("", { status: 200 });
    const res = await worker.fetch(post(base()), makeEnv());
    assert.equal(res.status, 204);
    assert.equal(await res.text(), "");
  });

  it("returns 204 when GA responds 204", async () => {
    fetchImpl = async () => new Response(null, { status: 204 });
    const res = await worker.fetch(post(base()), makeEnv());
    assert.equal(res.status, 204);
  });

  it("returns 502 when GA responds 500", async () => {
    fetchImpl = async () => new Response("upstream says G-TEST123 s3cr3t-value", { status: 500 });
    const res = await worker.fetch(post(base()), makeEnv());
    assert.equal(res.status, 502);
    assert.equal(await res.text(), "");
  });

  it("returns 502 when GA responds 3xx or 4xx", async () => {
    for (const status of [301, 400, 403]) {
      fetchImpl = async () => new Response("", { status });
      const res = await worker.fetch(post(base()), makeEnv());
      assert.equal(res.status, 502);
    }
  });

  it("returns 502 when fetch throws", async () => {
    fetchImpl = async () => {
      throw new Error("boom https://www.google-analytics.com/mp/collect?api_secret=s3cr3t-value");
    };
    const res = await worker.fetch(post(base()), makeEnv());
    assert.equal(res.status, 502);
    assert.equal(await res.text(), "");
  });
});

describe("FORWARD switch", () => {
  it("returns 204 without forwarding when FORWARD is off", async () => {
    const res = await worker.fetch(post(base()), makeEnv({ FORWARD: "off" }));
    assert.equal(res.status, 204);
    assert.equal(await res.text(), "");
    assert.equal(fetchCalls.length, 0);
  });

  it("still validates when FORWARD is off", async () => {
    const body = base();
    body.events[0].name = "nope";
    await expectRejected(post(body), 400, makeEnv({ FORWARD: "off" }));
  });

  it("does not consume the rate limit when FORWARD is off", async () => {
    await worker.fetch(post(base()), makeEnv({ FORWARD: "off" }));
    assert.equal(limitCalls.length, 0);
  });

  it("forwards for any value other than off", async () => {
    await worker.fetch(post(base()), makeEnv({ FORWARD: "on" }));
    assert.equal(fetchCalls.length, 1);
  });
});

describe("rate limit", () => {
  it("returns 429 without forwarding when the limit is exceeded", async () => {
    limitResult = { success: false };
    const res = await worker.fetch(post(base()), makeEnv());
    assert.equal(res.status, 429);
    assert.equal(await res.text(), "");
    assert.equal(fetchCalls.length, 0);
  });

  it("calls limit with the fixed key only", async () => {
    await worker.fetch(post(base(), { headers: { "cf-connecting-ip": CLIENT_IP }, cf: { country: "JP" } }), makeEnv());
    assert.deepEqual(limitCalls, [{ key: "v1-events" }]);
  });

  it("does not call the limiter for rejected requests", async () => {
    await expectRejected(post("{bad"), 400);
    await expectRejected(post(base(), { path: "/nope" }), 404);
    assert.equal(limitCalls.length, 0);
  });
});

describe("no secret leaks", () => {
  function assertNoLeak(res) {
    const all = [...res.headers].map(([k, v]) => `${k}: ${v}`).join("\n");
    for (const needle of [API_SECRET, MEASUREMENT_ID, "google-analytics", CLIENT_IP]) {
      assert.ok(!all.includes(needle), `response header leaks ${needle}`);
    }
  }

  it("leaks nothing in 204, 400, 404, 405, 413, 429 and 502 responses", async () => {
    const cases = [];
    cases.push([204, async () => worker.fetch(post(base()), makeEnv())]);
    cases.push([400, async () => worker.fetch(post("{bad"), makeEnv())]);
    cases.push([404, async () => worker.fetch(post(base(), { path: "/x" }), makeEnv())]);
    cases.push([405, async () => worker.fetch(post(undefined, { method: "GET" }), makeEnv())]);
    cases.push([413, async () => worker.fetch(post("{}", { headers: { "content-length": "99999" } }), makeEnv())]);
    cases.push([429, async () => {
      limitResult = { success: false };
      return worker.fetch(post(base()), makeEnv());
    }]);
    cases.push([502, async () => {
      limitResult = { success: true };
      fetchImpl = async () => {
        throw new Error(`${API_SECRET} ${MEASUREMENT_ID}`);
      };
      return worker.fetch(post(base()), makeEnv());
    }]);
    for (const [status, run] of cases) {
      const res = await run();
      assert.equal(res.status, status);
      const text = await res.text();
      assert.equal(text, "");
      assertNoLeak(res);
    }
  });

  it("leaks nothing when GA returns an error body", async () => {
    fetchImpl = async () => new Response(`${API_SECRET} ${MEASUREMENT_ID}`, { status: 500 });
    const res = await worker.fetch(post(base()), makeEnv());
    assert.equal(res.status, 502);
    assert.equal(await res.text(), "");
    assertNoLeak(res);
  });
});

describe("source checks", () => {
  it("contains no console calls", () => {
    assert.ok(!workerSource.includes("console."));
  });

  it("contains no ip_override", () => {
    assert.ok(!workerSource.includes("ip_override"));
  });

  it("never reads incoming headers for forwarding", () => {
    assert.ok(!/\.\.\.\s*request\.headers/.test(workerSource));
    assert.ok(!/headers:\s*request\.headers/.test(workerSource));
  });
});
