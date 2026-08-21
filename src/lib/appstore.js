import { LookupError } from "./errors.js";

const LOOKUP_ENDPOINT = "https://itunes.apple.com/lookup";
const RETRYABLE_STATUSES = new Set([403, 408, 429, 500, 502, 503, 504]);
const USER_AGENT = "competitor-version-monitor/1.0 (+github-actions)";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function lookupUrl(appId, country) {
  const url = new URL(LOOKUP_ENDPOINT);
  url.searchParams.set("id", appId);
  url.searchParams.set("country", country);
  url.searchParams.set("entity", "software");
  return url;
}

/** Map an Apple lookup result onto only the fields the monitor cares about. */
export function normalizeResult(result, { appId, country }) {
  const version = typeof result?.version === "string" ? result.version.trim() : "";
  if (!version) {
    throw new LookupError("lookup response has no version field", { reason: "missing-version" });
  }
  return {
    appId: String(result.trackId ?? appId),
    name: result.trackName ?? "",
    bundleId: result.bundleId ?? "",
    version,
    releaseDate: result.currentVersionReleaseDate ?? "",
    releaseNotes: result.releaseNotes ?? "",
    iconUrl: result.artworkUrl512 ?? result.artworkUrl100 ?? "",
    appStoreUrl: result.trackViewUrl ?? `https://apps.apple.com/${country}/app/id${appId}`,
    minimumOsVersion: result.minimumOsVersion ?? "",
    fileSizeBytes: result.fileSizeBytes ? String(result.fileSizeBytes) : "",
  };
}

/**
 * Look up one app on Apple's public Lookup API.
 * Retries network errors, timeouts, throttling and 5xx responses; a 404-style
 * "no results" answer is treated as a permanent configuration problem.
 */
export async function lookupApp(appId, options = {}) {
  const {
    country = "us",
    timeoutMs = 15_000,
    retries = 2,
    retryDelayMs = 1_000,
    fetchImpl = fetch,
  } = options;

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) await sleep(retryDelayMs * attempt);

    try {
      const response = await fetchImpl(lookupUrl(appId, country), {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: "application/json", "user-agent": USER_AGENT },
      });

      if (!response.ok) {
        throw new LookupError(`Apple API returned HTTP ${response.status}`, {
          reason: `http-${response.status}`,
          retryable: RETRYABLE_STATUSES.has(response.status),
        });
      }

      let body;
      try {
        body = await response.json();
      } catch {
        throw new LookupError("Apple API returned a malformed JSON body", {
          reason: "malformed-json",
          retryable: true,
        });
      }

      const result = Array.isArray(body?.results) ? body.results[0] : undefined;
      if (!result) {
        throw new LookupError("Apple API returned no results for the requested app", {
          reason: "empty-result",
        });
      }
      return normalizeResult(result, { appId, country });
    } catch (error) {
      lastError = toLookupError(error);
      if (!lastError.retryable || attempt === retries) throw lastError;
    }
  }
  throw lastError;
}

function toLookupError(error) {
  if (error instanceof LookupError) return error;
  const name = error?.name ?? "";
  if (name === "TimeoutError" || name === "AbortError") {
    return new LookupError("Apple API request timed out", { reason: "timeout", retryable: true });
  }
  // fetch() network failures land here; the message can embed the URL, so keep it generic.
  return new LookupError("Apple API request failed", { reason: "network", retryable: true });
}
