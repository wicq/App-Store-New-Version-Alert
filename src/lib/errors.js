/**
 * Error types shared across the monitor.
 *
 * Every message that can reach stdout must stay free of anything that identifies
 * a tracked app or exposes a credential. See `redact()` in ./redact.js.
 */

/** Bad or missing environment configuration. Fatal: nothing can run. */
export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigError";
  }
}

/** A single App Store lookup failed. Non-fatal: other apps keep going. */
export class LookupError extends Error {
  constructor(message, { reason = "unknown", retryable = false } = {}) {
    super(message);
    this.name = "LookupError";
    this.reason = reason;
    this.retryable = retryable;
  }
}

/** A Slack webhook delivery failed. Non-fatal, but state is not advanced. */
export class SlackError extends Error {
  constructor(message, { reason = "unknown", retryable = false, status } = {}) {
    super(message);
    this.name = "SlackError";
    this.reason = reason;
    this.retryable = retryable;
    this.status = status;
  }
}

/** Reading or writing the state file failed. */
export class StateError extends Error {
  constructor(message, { cause } = {}) {
    super(message, { cause });
    this.name = "StateError";
  }
}
