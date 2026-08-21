import { redact } from "./redact.js";

/**
 * A logger that scrubs known secrets from every line.
 *
 * Actions logs on a public repository are world-readable, so log volumes and
 * counts only - never an app name, an app ID or a version string.
 */
export function createLogger(secrets = [], { stream = process.stdout } = {}) {
  const write = (level, message) => {
    stream.write(`${level} ${redact(message, secrets)}\n`);
  };
  return {
    info: (message) => write("[info]", message),
    warn: (message) => write("[warn]", message),
    error: (message) => write("[error]", message),
  };
}
