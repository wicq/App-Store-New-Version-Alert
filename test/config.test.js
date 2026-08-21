import assert from "node:assert/strict";
import { test } from "node:test";

import { loadConfig, parseAppIds, secretsOf } from "../src/lib/config.js";
import { ConfigError } from "../src/lib/errors.js";

const baseEnv = { COMPETITOR_APP_IDS: "444555666", SLACK_WEBHOOK_URL: "https://hooks.slack.com/triggers/T/1/abc" };

test("parseAppIds trims, drops blanks and deduplicates", () => {
  assert.deepEqual(parseAppIds(" 444555666 , 777888999,,444555666 "), ["444555666", "777888999"]);
});

test("parseAppIds rejects non-numeric IDs without echoing them", () => {
  assert.throws(
    () => parseAppIds("444555666,not-an-id"),
    (error) =>
      error instanceof ConfigError &&
      !error.message.includes("not-an-id") &&
      /1 value\(s\)/.test(error.message),
  );
});

test("loadConfig requires the app list", () => {
  assert.throws(() => loadConfig({ ...baseEnv, COMPETITOR_APP_IDS: "" }), ConfigError);
});

test("loadConfig requires a Slack webhook unless DRY_RUN is set", () => {
  assert.throws(() => loadConfig({ COMPETITOR_APP_IDS: "444555666" }), ConfigError);
  const config = loadConfig({ COMPETITOR_APP_IDS: "444555666", DRY_RUN: "true" });
  assert.equal(config.dryRun, true);
});

test("loadConfig rejects a webhook that does not point at Slack", () => {
  assert.throws(
    () => loadConfig({ ...baseEnv, SLACK_WEBHOOK_URL: "https://example.com/collect" }),
    ConfigError,
  );
  assert.throws(
    () => loadConfig({ ...baseEnv, SLACK_WEBHOOK_URL: "http://hooks.slack.com/triggers/x" }),
    ConfigError,
  );
});

test("lookup concurrency stays sequential for small lists", () => {
  const small = loadConfig({ ...baseEnv, COMPETITOR_APP_IDS: "111111,222222" });
  assert.equal(small.lookupConcurrency, 1);
  const large = loadConfig({ ...baseEnv, COMPETITOR_APP_IDS: "111111,222222,333333,444444,555555,666666" });
  assert.equal(large.lookupConcurrency, 3);
});

test("secretsOf covers the webhook, the salt and every app ID", () => {
  const config = loadConfig({ ...baseEnv, COMPETITOR_APP_IDS: "111111,222222", STATE_SALT: "pepper" });
  assert.deepEqual(secretsOf(config), [baseEnv.SLACK_WEBHOOK_URL, "pepper", "111111", "222222"]);
});
