import { createHash, createHmac } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { StateError } from "./errors.js";

const STATE_VERSION = 1;

/**
 * Derive the state key for an app ID.
 *
 * The state file lives in a public repository, so the raw ID is never stored.
 * A plain SHA-256 of a numeric App Store ID is brute-forceable (the ID space is
 * small), so a secret STATE_SALT turns the digest into an HMAC that cannot be
 * reversed by enumeration. Without a salt we fall back to SHA-256 and warn.
 */
export function stateKey(appId, salt = "") {
  const digest = salt
    ? createHmac("sha256", salt).update(String(appId)).digest("hex")
    : createHash("sha256").update(String(appId)).digest("hex");
  return digest.slice(0, 32);
}

function emptyState() {
  return { version: STATE_VERSION, apps: {} };
}

/** Accept the current shape, and also a bare `{ key: {...} }` map from older runs. */
export function parseState(text) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("state file is not a JSON object");
  }
  if (parsed.apps && typeof parsed.apps === "object") {
    return { version: STATE_VERSION, apps: { ...parsed.apps } };
  }
  const { version: _ignored, ...legacy } = parsed;
  return { version: STATE_VERSION, apps: legacy };
}

/** Read state from disk. A missing file is a valid first run, not an error. */
export async function readState(path) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return emptyState();
    throw new StateError(`unable to read the state file: ${error.code ?? "read error"}`, {
      cause: error,
    });
  }
  if (text.trim() === "") return emptyState();
  try {
    return parseState(text);
  } catch (error) {
    throw new StateError(`state file is not usable: ${error.message}`, { cause: error });
  }
}

/** Serialize state with sorted keys so committed diffs stay minimal and stable. */
export function serializeState(state) {
  const apps = {};
  for (const key of Object.keys(state.apps).sort()) {
    apps[key] = state.apps[key];
  }
  return `${JSON.stringify({ version: STATE_VERSION, apps }, null, 2)}\n`;
}

/** Write state atomically: a killed runner must not leave a truncated file. */
export async function writeState(path, state) {
  try {
    await mkdir(dirname(path), { recursive: true });
    const temporaryPath = `${path}.tmp`;
    await writeFile(temporaryPath, serializeState(state), "utf8");
    await rename(temporaryPath, path);
  } catch (error) {
    throw new StateError(`unable to write the state file: ${error.code ?? "write error"}`, {
      cause: error,
    });
  }
}
