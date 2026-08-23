import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyObservation } from "../src/lib/changes.js";

const app = (version, releaseDate) => ({ version, releaseDate });
const stored = (version, release_date) => ({ version, release_date, detected_at: "2026-08-23T21:26:09Z" });

test("a first sighting is stored without notifying", () => {
  assert.deepEqual(classifyObservation({ stored: undefined, app: app("1.82.0", "2026-08-23T06:06:51Z") }), {
    action: "store",
    reason: "baseline",
  });
});

test("an entry with no recorded release date is re-baselined silently", () => {
  assert.deepEqual(
    classifyObservation({ stored: { version: "1.81.0" }, app: app("1.82.0", "2026-08-23T06:06:51Z") }),
    { action: "store", reason: "rebaseline" },
  );
});

test("an unchanged reading does nothing", () => {
  assert.deepEqual(
    classifyObservation({
      stored: stored("1.82.0", "2026-08-23T06:06:51Z"),
      app: app("1.82.0", "2026-08-23T06:06:51Z"),
    }),
    { action: "ignore", reason: "unchanged" },
  );
});

test("a newer release date with a new version is a real release", () => {
  assert.deepEqual(
    classifyObservation({
      stored: stored("1.81.0", "2026-08-13T13:52:52Z"),
      app: app("1.82.0", "2026-08-23T06:06:51Z"),
    }),
    { action: "notify", reason: "release" },
  );
});

test("a stale snapshot is ignored instead of announced as a downgrade", () => {
  // The exact flap that produced the false Loora alerts: an edge cache replayed
  // 1.81.0 (released Aug 13) after 1.82.0 (Aug 23) was already stored.
  assert.deepEqual(
    classifyObservation({
      stored: stored("1.82.0", "2026-08-23T06:06:51Z"),
      app: app("1.81.0", "2026-08-13T13:52:52Z"),
    }),
    { action: "ignore", reason: "stale" },
  );
});

test("a stale snapshot never advances state, so it cannot cause a re-announcement", () => {
  const before = stored("4.3.5", "2026-08-23T15:46:05Z");
  const result = classifyObservation({ stored: before, app: app("4.3.4", "2026-08-21T16:53:29Z") });
  assert.equal(result.action, "ignore");
  assert.deepEqual(before, stored("4.3.5", "2026-08-23T15:46:05Z"));
});

test("a newer release date with the same version only refreshes state", () => {
  assert.deepEqual(
    classifyObservation({
      stored: stored("1.82.0", "2026-08-23T06:06:51Z"),
      app: app("1.82.0", "2026-08-24T09:00:00Z"),
    }),
    { action: "store", reason: "metadata" },
  );
});

test("the same release date with a different version is too ambiguous to announce", () => {
  assert.deepEqual(
    classifyObservation({
      stored: stored("1.82.0", "2026-08-23T06:06:51Z"),
      app: app("1.83.0", "2026-08-23T06:06:51Z"),
    }),
    { action: "ignore", reason: "ambiguous" },
  );
});

test("a developer rollback still notifies, because its release date is newer", () => {
  assert.deepEqual(
    classifyObservation({
      stored: stored("1.82.0", "2026-08-23T06:06:51Z"),
      app: app("1.81.1", "2026-08-24T10:00:00Z"),
    }),
    { action: "notify", reason: "release" },
  );
});

test("an unusable release date falls back to comparing versions", () => {
  assert.deepEqual(
    classifyObservation({ stored: stored("1.82.0", "nonsense"), app: app("1.83.0", "also nonsense") }),
    { action: "notify", reason: "no-release-date" },
  );
  assert.deepEqual(
    classifyObservation({ stored: stored("1.82.0", "nonsense"), app: app("1.82.0", "") }),
    { action: "ignore", reason: "unchanged" },
  );
});
