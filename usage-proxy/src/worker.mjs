import spec from "../../usage-events.json" with { type: "json" };

const MAX_BODY_BYTES = 8192;
const GA_ENDPOINT = "https://www.google-analytics.com/mp/collect";
const RATE_LIMIT_KEY = "v1-events";

const EVENTS = new Set(spec.events);
const THEMES = new Set(spec.themes);
const SIZE_RANGES = new Set(spec.sizeRanges);
const EDITIONS = new Set(spec.editions);
const OPERATING_SYSTEMS = new Set(spec.operatingSystems);
const EXTRA_PARAM_VALUES = { theme: THEMES, size_range: SIZE_RANGES };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SESSION_ID_PATTERN = /^\d{1,20}$/;
const APP_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const COUNTRY_PATTERN = /^[A-Z]{2}$/;
const MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]+$/;

class Rejection extends Error {
  constructor(status) {
    super("rejected");
    this.status = status;
  }
}

function empty(status) {
  return new Response(null, { status });
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isJson(request) {
  const type = request.headers.get("content-type") ?? "";
  return type.split(";")[0].trim().toLowerCase() === "application/json";
}

// GA answers 2xx even for a wrong or missing secret, so a misconfigured Worker must not report success.
function isConfigured(env) {
  return typeof env.GA_API_SECRET === "string" && env.GA_API_SECRET.length > 0
    && typeof env.GA_MEASUREMENT_ID === "string" && MEASUREMENT_ID_PATTERN.test(env.GA_MEASUREMENT_ID);
}

function isMember(set, value) {
  return typeof value === "string" && set.has(value);
}

async function readBody(request) {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (Number.isFinite(length) && length > MAX_BODY_BYTES) throw new Rejection(413);
  }
  if (request.body === null) return "";

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Rejection(413);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Rejection(400);
  }
}

function validate(text) {
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isPlainObject(body) || !hasExactKeys(body, ["client_id", "device", "events"])) return null;

  if (typeof body.client_id !== "string" || !UUID_PATTERN.test(body.client_id)) return null;

  const { device } = body;
  if (!isPlainObject(device) || !hasExactKeys(device, ["category", "operating_system"])) return null;
  if (device.category !== "desktop" || !isMember(OPERATING_SYSTEMS, device.operating_system)) return null;

  if (!Array.isArray(body.events) || body.events.length !== 1) return null;
  const [event] = body.events;
  if (!isPlainObject(event) || !hasExactKeys(event, ["name", "params"])) return null;
  if (!isMember(EVENTS, event.name)) return null;

  const extra = Object.hasOwn(spec.extraParams, event.name) ? spec.extraParams[event.name] : null;
  const expectedKeys = extra === null ? spec.commonParams : [...spec.commonParams, extra];
  const { params } = event;
  if (!isPlainObject(params) || !hasExactKeys(params, expectedKeys)) return null;

  if (typeof params.session_id !== "string" || !SESSION_ID_PATTERN.test(params.session_id)) return null;
  const engagement = params.engagement_time_msec;
  if (!Number.isInteger(engagement) || engagement < 1 || engagement > 60000) return null;
  if (typeof params.app_version !== "string" || !APP_VERSION_PATTERN.test(params.app_version)) return null;
  if (!isMember(EDITIONS, params.edition)) return null;
  if (!isMember(OPERATING_SYSTEMS, params.operating_system)) return null;
  if (extra !== null && !isMember(EXTRA_PARAM_VALUES[extra], params[extra])) return null;

  const cleanParams = {
    session_id: params.session_id,
    engagement_time_msec: engagement,
    app_version: params.app_version,
    edition: params.edition,
    operating_system: params.operating_system,
  };
  if (extra !== null) cleanParams[extra] = params[extra];

  return {
    client_id: body.client_id,
    device: { category: "desktop", operating_system: device.operating_system },
    events: [{ name: event.name, params: cleanParams }],
  };
}

function buildOutbound(payload, request) {
  const outbound = { ...payload };
  const country = request.cf?.country;
  if (typeof country === "string" && COUNTRY_PATTERN.test(country) && country !== "XX") {
    outbound.user_location = { country_id: country };
  }
  outbound.consent = { ad_user_data: "DENIED", ad_personalization: "DENIED" };
  return outbound;
}

async function forward(payload, request, env) {
  const query = new URLSearchParams({
    measurement_id: env.GA_MEASUREMENT_ID,
    api_secret: env.GA_API_SECRET,
  });
  try {
    const response = await globalThis.fetch(`${GA_ENDPOINT}?${query.toString()}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildOutbound(payload, request)),
    });
    return empty(response.status >= 200 && response.status < 300 ? 204 : 502);
  } catch {
    return empty(502);
  }
}

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname !== "/v1/events") return empty(404);
    if (request.method !== "POST") return empty(405);
    // Requiring JSON forces a CORS preflight, which is never answered, so web pages can't send events.
    if (!isJson(request)) return empty(415);

    let payload;
    try {
      payload = validate(await readBody(request));
    } catch (error) {
      if (error instanceof Rejection) return empty(error.status);
      return empty(400);
    }
    if (payload === null) return empty(400);

    // Fail closed: anything but an explicit "on" (a typo, a deleted line, a new environment) stops forwarding.
    if (env.FORWARD !== "on") return empty(204);
    if (!isConfigured(env)) return empty(503);

    let limited;
    try {
      limited = await env.USAGE_RATE_LIMIT.limit({ key: RATE_LIMIT_KEY });
    } catch {
      return empty(502);
    }
    if (!limited || limited.success !== true) return empty(429);

    return forward(payload, request, env);
  },
};
