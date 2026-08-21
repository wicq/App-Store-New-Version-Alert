import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { parseState, readState, serializeState, stateKey, writeState } from "../src/lib/state.js";

const scratch = async () => mkdtemp(join(tmpdir(), "monitor-state-"));

test("stateKey is deterministic and never contains the app ID", () => {
  const key = stateKey("444555666", "pepper");
  assert.equal(key, stateKey("444555666", "pepper"));
  assert.equal(key.length, 32);
  assert.ok(!key.includes("444555666"));
});

test("stateKey changes with the salt, so a salted key resists ID enumeration", () => {
  assert.notEqual(stateKey("444555666", "pepper"), stateKey("444555666"));
  assert.notEqual(stateKey("444555666", "pepper"), stateKey("444555666", "other"));
});

test("readState treats a missing file as a first run", async () => {
  const directory = await scratch();
  assert.deepEqual(await readState(join(directory, "versions.json")), { version: 1, apps: {} });
});

test("readState accepts a legacy flat map", () => {
  assert.deepEqual(parseState('{"abc":{"version":"1.0.0"}}'), {
    version: 1,
    apps: { abc: { version: "1.0.0" } },
  });
});

test("readState rejects a corrupted file instead of silently resetting", async () => {
  const directory = await scratch();
  const path = join(directory, "versions.json");
  await writeFile(path, "{ not json", "utf8");
  await assert.rejects(readState(path), /not usable/);
});

test("serializeState sorts keys for stable diffs", () => {
  const text = serializeState({ apps: { b: { version: "2" }, a: { version: "1" } } });
  assert.ok(text.indexOf('"a"') < text.indexOf('"b"'));
  assert.ok(text.endsWith("\n"));
});

test("writeState round-trips through disk", async () => {
  const directory = await scratch();
  const path = join(directory, "nested", "versions.json");
  await writeState(path, { apps: { abc: { version: "7.136.0", detected_at: "2026-08-18T14:05:00Z" } } });
  assert.deepEqual((await readState(path)).apps.abc.version, "7.136.0");
  assert.ok((await readFile(path, "utf8")).includes("7.136.0"));
});
