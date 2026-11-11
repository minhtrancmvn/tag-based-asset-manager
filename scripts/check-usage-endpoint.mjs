#!/usr/bin/env node
// Release guard for opt-in usage analytics (docs/usage-analytics.md).
// The app only asks about usage data when built with TAG_ASSET_MANAGER_USAGE_ENDPOINT,
// and silently ignores anything that isn't HTTPS. Official builds must carry the exact
// official endpoint; forks and local builds may leave it empty and stay silent.
import { pathToFileURL } from "node:url";

export const OFFICIAL_REPOSITORY = "minhtrancmvn/tag-based-asset-manager";
export const OFFICIAL_ENDPOINT = "https://usage.minhtran.id.vn/v1/events";

export function checkUsageEndpoint({ repository, endpoint }) {
  const value = endpoint ?? "";
  if (repository === OFFICIAL_REPOSITORY) {
    if (value === OFFICIAL_ENDPOINT) return { ok: true, message: "Usage endpoint set for the official build." };
    if (value === "") {
      return { ok: false, message: "TAG_ASSET_MANAGER_USAGE_ENDPOINT is empty. Set the repository variable USAGE_ENDPOINT to the official endpoint." };
    }
    return { ok: false, message: "TAG_ASSET_MANAGER_USAGE_ENDPOINT doesn't match the official endpoint. Check the repository variable USAGE_ENDPOINT." };
  }
  if (value === "") return { ok: true, message: "No usage endpoint: this build never asks about or sends usage data." };
  if (value.startsWith("https://")) return { ok: true, message: "Usage endpoint set." };
  return { ok: false, message: "TAG_ASSET_MANAGER_USAGE_ENDPOINT must start with https://, or the app ignores it." };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = checkUsageEndpoint({
    repository: process.env.GITHUB_REPOSITORY,
    endpoint: process.env.TAG_ASSET_MANAGER_USAGE_ENDPOINT,
  });
  if (result.ok) {
    console.log(result.message);
  } else {
    console.log(`::error::${result.message}`);
    process.exitCode = 1;
  }
}
