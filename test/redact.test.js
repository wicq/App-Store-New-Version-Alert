import assert from "node:assert/strict";
import { test } from "node:test";

import { createLogger } from "../src/lib/log.js";
import { redact, safeMessage } from "../src/lib/redact.js";

test("redact removes every occurrence of every secret", () => {
  const text = redact("POST https://hooks.slack.com/triggers/abc for 444555666", [
    "https://hooks.slack.com/triggers/abc",
    "444555666",
  ]);
  assert.equal(text, "POST [redacted] for [redacted]");
});

test("redact ignores empty or trivially short secrets", () => {
  assert.equal(redact("a b c", ["", "a"]), "a b c");
});

test("safeMessage flattens a message, drops the stack and scrubs secrets", () => {
  const error = new Error("failed\n  for 444555666");
  assert.equal(safeMessage(error, ["444555666"]), "failed for [redacted]");
});

test("safeMessage handles non-Error throws", () => {
  assert.equal(safeMessage("boom"), "boom");
  assert.equal(safeMessage(undefined), "unknown error");
});

test("createLogger scrubs secrets from every level", () => {
  const lines = [];
  const log = createLogger(["444555666"], { stream: { write: (line) => lines.push(line) } });
  log.info("checked 444555666");
  log.warn("warn 444555666");
  log.error("error 444555666");
  assert.deepEqual(lines, [
    "[info] checked [redacted]\n",
    "[warn] warn [redacted]\n",
    "[error] error [redacted]\n",
  ]);
});
