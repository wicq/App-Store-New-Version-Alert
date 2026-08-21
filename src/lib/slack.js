import { SlackError } from "./errors.js";

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_RELEASE_NOTES_LENGTH = 2_500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function truncate(text, limit) {
  const value = String(text ?? "");
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

/**
 * Build the flat payload for a Slack Workflow Builder webhook.
 * Workflow Builder variables cannot hold nested JSON, so every value is a
 * string and all presentation is left to the Slack workflow itself.
 */
export function buildPayload({ app, oldVersion }) {
  return {
    app_name: String(app.name ?? ""),
    app_id: String(app.appId ?? ""),
    bundle_id: String(app.bundleId ?? ""),
    old_version: String(oldVersion ?? ""),
    new_version: String(app.version ?? ""),
    release_date: String(app.releaseDate ?? ""),
    release_notes: truncate(app.releaseNotes, MAX_RELEASE_NOTES_LENGTH),
    app_store_url: String(app.appStoreUrl ?? ""),
    icon_url: String(app.iconUrl ?? ""),
    minimum_ios: String(app.minimumOsVersion ?? ""),
    file_size_bytes: String(app.fileSizeBytes ?? ""),
  };
}

function retryDelayMs(response, attempt, baseDelayMs) {
  const header = Number(response.headers?.get?.("retry-after"));
  if (Number.isFinite(header) && header > 0) return Math.min(header * 1_000, 30_000);
  return baseDelayMs * (attempt + 1);
}

/**
 * POST one notification. Retries throttling and 5xx; a 4xx is permanent
 * (bad or revoked trigger URL, payload rejected by the workflow).
 */
export async function sendNotification(webhookUrl, payload, options = {}) {
  const { timeoutMs = 15_000, retries = 2, retryDelayBaseMs = 1_000, fetchImpl = fetch } = options;

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchImpl(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (response.ok) return;

      const retryable = RETRYABLE_STATUSES.has(response.status);
      lastError = new SlackError(`Slack returned HTTP ${response.status}`, {
        reason: `http-${response.status}`,
        retryable,
        status: response.status,
      });
      if (!retryable || attempt === retries) throw lastError;
      await sleep(retryDelayMs(response, attempt, retryDelayBaseMs));
    } catch (error) {
      if (error instanceof SlackError) {
        if (!error.retryable || attempt === retries) throw error;
        continue;
      }
      const name = error?.name ?? "";
      const timedOut = name === "TimeoutError" || name === "AbortError";
      // The webhook URL can appear in raw fetch errors, so never reuse their message.
      lastError = new SlackError(timedOut ? "Slack request timed out" : "Slack request failed", {
        reason: timedOut ? "timeout" : "network",
        retryable: true,
      });
      if (attempt === retries) throw lastError;
      await sleep(retryDelayBaseMs * (attempt + 1));
    }
  }
  throw lastError;
}
