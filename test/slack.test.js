import assert from "node:assert/strict";
import { test } from "node:test";

import { buildPayload, sendNotification } from "../src/lib/slack.js";

const APP = {
  appId: "444555666",
  name: "Example App",
  bundleId: "com.example.app",
  version: "7.136.0",
  releaseDate: "2026-08-18T14:00:10Z",
  releaseNotes: "Bug fixes.",
  iconUrl: "https://example.com/icon.png",
  appStoreUrl: "https://apps.apple.com/us/app/id444555666",
  minimumOsVersion: "17.0",
  fileSizeBytes: "512500736",
};

const WEBHOOK = "https://hooks.slack.com/triggers/T/1/abc";
const okResponse = { ok: true, status: 200, headers: new Headers() };

test("buildPayload is flat and entirely made of strings", () => {
  const payload = buildPayload({ app: APP, oldVersion: "7.135.0" });
  assert.deepEqual(Object.keys(payload).sort(), [
    "app_id",
    "app_name",
    "app_store_url",
    "bundle_id",
    "file_size_bytes",
    "icon_url",
    "minimum_ios",
    "new_version",
    "old_version",
    "release_date",
    "release_notes",
  ]);
  for (const value of Object.values(payload)) assert.equal(typeof value, "string");
  assert.equal(payload.old_version, "7.135.0");
  assert.equal(payload.new_version, "7.136.0");
});

test("buildPayload truncates very long release notes", () => {
  const payload = buildPayload({ app: { ...APP, releaseNotes: "x".repeat(5_000) }, oldVersion: "1" });
  assert.equal(payload.release_notes.length, 2_500);
  assert.ok(payload.release_notes.endsWith("…"));
});

test("buildPayload tolerates missing optional metadata", () => {
  const payload = buildPayload({ app: { version: "1.0.0" }, oldVersion: undefined });
  assert.equal(payload.old_version, "");
  assert.equal(payload.release_notes, "");
});

test("sendNotification posts JSON once on success", async () => {
  const calls = [];
  await sendNotification(WEBHOOK, { app_name: "Example App" }, {
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return okResponse;
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0].init.body), { app_name: "Example App" });
});

test("sendNotification retries a 429 and honours Retry-After", async () => {
  let calls = 0;
  await sendNotification(WEBHOOK, {}, {
    retryDelayBaseMs: 0,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return { ok: false, status: 429, headers: new Headers({ "retry-after": "0" }) };
      }
      return okResponse;
    },
  });
  assert.equal(calls, 2);
});

test("sendNotification does not retry a 403 trigger rejection", async () => {
  let calls = 0;
  await assert.rejects(
    sendNotification(WEBHOOK, {}, {
      retryDelayBaseMs: 0,
      fetchImpl: async () => {
        calls += 1;
        return { ok: false, status: 403, headers: new Headers() };
      },
    }),
    (error) => error.status === 403 && error.retryable === false,
  );
  assert.equal(calls, 1);
});

test("sendNotification never puts the webhook URL in its error message", async () => {
  await assert.rejects(
    sendNotification(WEBHOOK, {}, {
      retries: 0,
      fetchImpl: async () => {
        throw new TypeError(`fetch failed: POST ${WEBHOOK}`);
      },
    }),
    (error) => !error.message.includes("hooks.slack.com") && error.reason === "network",
  );
});
