/**
 * Secret scrubbing for anything that might be logged.
 *
 * The repository and its Actions logs are public, so the Slack webhook URL and
 * the tracked app IDs must never appear in output - not even inside an error
 * message produced by a library we do not control (fetch, for instance, puts
 * the request URL into some of its errors).
 */

const PLACEHOLDER = "[redacted]";

/** Replace every occurrence of every secret in `text` with a placeholder. */
export function redact(text, secrets = []) {
  let output = String(text ?? "");
  for (const secret of secrets) {
    if (!secret || String(secret).length < 4) continue;
    output = output.split(String(secret)).join(PLACEHOLDER);
  }
  return output;
}

/**
 * Turn an unknown thrown value into a single-line, secret-free message.
 * Stack traces are dropped on purpose: they add nothing to a public log.
 */
export function safeMessage(error, secrets = []) {
  const raw =
    error instanceof Error
      ? error.message || error.name
      : typeof error === "string"
        ? error
        : "unknown error";
  return redact(raw, secrets).replace(/\s+/g, " ").trim().slice(0, 300);
}
