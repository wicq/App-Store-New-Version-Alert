import { ConfigError } from "./errors.js";

const APP_ID_PATTERN = /^\d{6,12}$/;
const ALLOWED_WEBHOOK_HOSTS = new Set(["hooks.slack.com"]);

const DEFAULTS = {
  stateFile: "state/versions.json",
  country: "us",
  lookupTimeoutMs: 15_000,
  lookupRetries: 2,
  slackTimeoutMs: 15_000,
  slackRetries: 2,
  /** Slack Workflow Builder triggers allow roughly 1 request/second. */
  slackMinIntervalMs: 1_100,
};

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function parseInteger(value, fallback, { min, max, name }) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new ConfigError(`${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

/** Parse the comma-separated secret into a deduplicated list of app IDs. */
export function parseAppIds(raw) {
  const ids = String(raw ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  const invalid = ids.filter((id) => !APP_ID_PATTERN.test(id));
  if (invalid.length > 0) {
    // The offending values are part of the private list, so only the count is reported.
    throw new ConfigError(
      `COMPETITOR_APP_IDS contains ${invalid.length} value(s) that are not numeric App Store IDs`,
    );
  }
  return [...new Set(ids)];
}

function validateWebhook(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new ConfigError("SLACK_WEBHOOK_URL is not a valid URL");
  }
  if (parsed.protocol !== "https:") {
    throw new ConfigError("SLACK_WEBHOOK_URL must use https");
  }
  if (!ALLOWED_WEBHOOK_HOSTS.has(parsed.hostname)) {
    // Guards against a mistyped or swapped secret sending competitor data elsewhere.
    throw new ConfigError("SLACK_WEBHOOK_URL must point at hooks.slack.com");
  }
}

/**
 * Build the run configuration from the environment.
 * Throws ConfigError on anything that would make the run meaningless.
 */
export function loadConfig(env = process.env) {
  const appIds = parseAppIds(env.COMPETITOR_APP_IDS);
  if (appIds.length === 0) {
    throw new ConfigError("COMPETITOR_APP_IDS is missing or empty");
  }

  const dryRun = parseBoolean(env.DRY_RUN);
  const webhookUrl = (env.SLACK_WEBHOOK_URL ?? "").trim();
  if (!dryRun) {
    if (!webhookUrl) throw new ConfigError("SLACK_WEBHOOK_URL is missing or empty");
    validateWebhook(webhookUrl);
  }

  const country = (env.STOREFRONT_COUNTRY ?? DEFAULTS.country).trim().toLowerCase();
  if (!/^[a-z]{2}$/.test(country)) {
    throw new ConfigError("STOREFRONT_COUNTRY must be a two-letter country code");
  }

  // Small lists stay sequential; larger ones get limited concurrency (see README).
  const defaultConcurrency = appIds.length <= 5 ? 1 : 3;

  return {
    appIds,
    dryRun,
    webhookUrl,
    country,
    stateFile: (env.STATE_FILE ?? DEFAULTS.stateFile).trim() || DEFAULTS.stateFile,
    stateSalt: env.STATE_SALT ?? "",
    lookupConcurrency: parseInteger(env.LOOKUP_CONCURRENCY, defaultConcurrency, {
      min: 1,
      max: 5,
      name: "LOOKUP_CONCURRENCY",
    }),
    lookupTimeoutMs: DEFAULTS.lookupTimeoutMs,
    lookupRetries: DEFAULTS.lookupRetries,
    slackTimeoutMs: DEFAULTS.slackTimeoutMs,
    slackRetries: DEFAULTS.slackRetries,
    slackMinIntervalMs: parseInteger(env.SLACK_MIN_INTERVAL_MS, DEFAULTS.slackMinIntervalMs, {
      min: 0,
      max: 10_000,
      name: "SLACK_MIN_INTERVAL_MS",
    }),
  };
}

/** Everything that must never reach a public log. */
export function secretsOf(config) {
  return [config.webhookUrl, config.stateSalt, ...config.appIds].filter(Boolean);
}
