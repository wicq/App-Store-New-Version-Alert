import assert from "node:assert/strict";
import { test } from "node:test";

import { lookupApp, normalizeResult } from "../src/lib/appstore.js";

const APPLE_RESULT = {
  trackId: 444555666,
  trackName: "Example App",
  bundleId: "com.example.app",
  version: "7.136.0",
  currentVersionReleaseDate: "2026-08-18T14:00:10Z",
  releaseNotes: "Bug fixes.",
  artworkUrl512: "https://example.com/icon.png",
  trackViewUrl: "https://apps.apple.com/us/app/id444555666",
  minimumOsVersion: "17.0",
  fileSizeBytes: 512500736,
};

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  headers: new Headers(),
});

test("normalizeResult keeps the fields Slack needs and stringifies the size", () => {
  const app = normalizeResult(APPLE_RESULT, { appId: "444555666", country: "us" });
  assert.equal(app.version, "7.136.0");
  assert.equal(app.fileSizeBytes, "512500736");
  assert.equal(app.iconUrl, "https://example.com/icon.png");
});

test("normalizeResult fails when Apple omits the version", () => {
  assert.throws(
    () => normalizeResult({ ...APPLE_RESULT, version: "  " }, { appId: "1", country: "us" }),
    /no version field/,
  );
});

test("normalizeResult falls back to a constructed App Store URL", () => {
  const { trackViewUrl: _dropped, ...withoutUrl } = APPLE_RESULT;
  const app = normalizeResult(withoutUrl, { appId: "444555666", country: "de" });
  assert.equal(app.appStoreUrl, "https://apps.apple.com/de/app/id444555666");
});

test("lookupApp requests the configured storefront", async () => {
  const seen = [];
  const app = await lookupApp("444555666", {
    country: "de",
    fetchImpl: async (url) => {
      seen.push(url.toString());
      return jsonResponse({ resultCount: 1, results: [APPLE_RESULT] });
    },
  });
  assert.equal(app.version, "7.136.0");
  assert.match(seen[0], /id=444555666/);
  assert.match(seen[0], /country=de/);
});

test("lookupApp retries a 503 and then succeeds", async () => {
  let calls = 0;
  const app = await lookupApp("444555666", {
    retryDelayMs: 0,
    fetchImpl: async () => {
      calls += 1;
      return calls === 1
        ? jsonResponse({}, 503)
        : jsonResponse({ resultCount: 1, results: [APPLE_RESULT] });
    },
  });
  assert.equal(calls, 2);
  assert.equal(app.version, "7.136.0");
});

test("lookupApp does not retry a permanent 400", async () => {
  let calls = 0;
  await assert.rejects(
    lookupApp("444555666", {
      retryDelayMs: 0,
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse({}, 400);
      },
    }),
    /HTTP 400/,
  );
  assert.equal(calls, 1);
});

test("lookupApp reports an unknown app ID as an empty result", async () => {
  await assert.rejects(
    lookupApp("999999999", {
      retryDelayMs: 0,
      fetchImpl: async () => jsonResponse({ resultCount: 0, results: [] }),
    }),
    (error) => error.reason === "empty-result",
  );
});

test("lookupApp surfaces a timeout without leaking the request URL", async () => {
  await assert.rejects(
    lookupApp("444555666", {
      retries: 0,
      fetchImpl: async () => {
        const error = new Error("fetch failed for https://itunes.apple.com/lookup?id=444555666");
        error.name = "TimeoutError";
        throw error;
      },
    }),
    (error) => error.reason === "timeout" && !error.message.includes("444555666"),
  );
});

test("lookupApp gives up after exhausting retries on network errors", async () => {
  let calls = 0;
  await assert.rejects(
    lookupApp("444555666", {
      retries: 2,
      retryDelayMs: 0,
      fetchImpl: async () => {
        calls += 1;
        throw new TypeError("fetch failed");
      },
    }),
    (error) => error.reason === "network",
  );
  assert.equal(calls, 3);
});
