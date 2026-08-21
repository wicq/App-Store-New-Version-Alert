#!/usr/bin/env node
/**
 * Competitor App Store version monitor.
 *
 * Runs on a schedule, looks up every configured App Store ID on Apple's public
 * Lookup API, and posts a Slack Workflow Builder notification whenever an app's
 * `version` differs from the last observed one.
 *
 * Privacy rules that shape this file:
 *   - the tracked app list and the Slack trigger URL come from GitHub Secrets;
 *   - nothing identifying an app is ever logged (the repository is public);
 *   - the committed state file is keyed by a salted digest, never a raw app ID.
 */

import { lookupApp } from "./lib/appstore.js";
import { loadConfig, secretsOf } from "./lib/config.js";
import { mapWithConcurrency } from "./lib/concurrency.js";
import { ConfigError, StateError } from "./lib/errors.js";
import { createLogger } from "./lib/log.js";
import { safeMessage } from "./lib/redact.js";
import { buildPayload, sendNotification } from "./lib/slack.js";
import { readState, stateKey, writeState } from "./lib/state.js";

const sleep = (ms) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : undefined);

/** Group failure reasons into "2 timeout, 1 http-503" for a safe log line. */
function summarizeReasons(reasons) {
  const counts = new Map();
  for (const reason of reasons) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([reason, count]) => `${count} ${reason}`)
    .join(", ");
}

async function run() {
  const config = loadConfig(process.env);
  const secrets = secretsOf(config);
  const log = createLogger(secrets);

  if (!config.stateSalt) {
    log.warn(
      "STATE_SALT is not set: state keys fall back to plain SHA-256, which is reversible for numeric App Store IDs. Set the STATE_SALT secret.",
    );
  }
  if (config.dryRun) {
    log.warn("DRY_RUN is enabled: version changes are detected but Slack is not called.");
  }

  const state = await readState(config.stateFile);
  log.info(
    `Checking ${config.appIds.length} configured application(s); ${
      Object.keys(state.apps).length
    } known baseline(s) in state.`,
  );

  // 1. Look up every app. One failure must not affect the others.
  const outcomes = await mapWithConcurrency(config.appIds, config.lookupConcurrency, async (appId) => {
    try {
      const app = await lookupApp(appId, {
        country: config.country,
        timeoutMs: config.lookupTimeoutMs,
        retries: config.lookupRetries,
      });
      return { ok: true, key: stateKey(appId, config.stateSalt), app };
    } catch (error) {
      return { ok: false, reason: error.reason ?? "unknown", message: safeMessage(error, secrets) };
    }
  });

  const succeeded = outcomes.filter((outcome) => outcome.ok);
  const failed = outcomes.filter((outcome) => !outcome.ok);
  log.info(`${succeeded.length} lookup(s) completed, ${failed.length} failed.`);
  if (failed.length > 0) {
    log.warn(`Lookup failures by reason: ${summarizeReasons(failed.map((f) => f.reason))}.`);
    for (const failure of failed) log.warn(`Lookup failure detail: ${failure.message}`);
  }

  // 2. Compare against stored versions.
  const baselines = [];
  const changes = [];
  for (const { key, app } of succeeded) {
    const stored = state.apps[key]?.version;
    if (!stored) {
      baselines.push({ key, app });
    } else if (stored !== app.version) {
      changes.push({ key, app, oldVersion: stored });
    }
  }

  let stateDirty = false;
  const stamp = () => new Date().toISOString();

  // First run for an app: remember the version, stay quiet (spec: no backfill alerts).
  if (baselines.length > 0) {
    for (const { key, app } of baselines) {
      state.apps[key] = { version: app.version, detected_at: stamp() };
    }
    await writeState(config.stateFile, state);
    stateDirty = true;
    log.info(`${baselines.length} application(s) had no baseline; current version stored silently.`);
  }

  log.info(`${changes.length} version change(s) detected.`);

  // 3. Notify Slack sequentially, then advance state only for delivered changes.
  let notified = 0;
  const notificationFailures = [];
  for (const [index, change] of changes.entries()) {
    if (config.dryRun) {
      log.info("Dry run: skipping Slack notification and leaving state untouched.");
      continue;
    }
    if (index > 0) await sleep(config.slackMinIntervalMs); // ~1 request/second trigger limit
    try {
      await sendNotification(config.webhookUrl, buildPayload(change), {
        timeoutMs: config.slackTimeoutMs,
        retries: config.slackRetries,
      });
      notified += 1;
      // State advances per delivered notification, so a later failure cannot
      // resend an already-announced release.
      state.apps[change.key] = { version: change.app.version, detected_at: stamp() };
      await writeState(config.stateFile, state);
      stateDirty = true;
      log.info(`Slack notification sent successfully (${notified}/${changes.length}).`);
    } catch (error) {
      notificationFailures.push(error.reason ?? "unknown");
      log.error(
        `Slack notification failed: ${safeMessage(error, secrets)}. State kept unchanged; the change will be retried on the next run.`,
      );
    }
  }

  log.info(
    [
      "Summary:",
      `apps checked: ${config.appIds.length}`,
      `successful lookups: ${succeeded.length}`,
      `failed lookups: ${failed.length}`,
      `new baselines: ${baselines.length}`,
      `version changes: ${changes.length}`,
      `slack notifications: ${notified}`,
      `slack failures: ${notificationFailures.length}`,
      `state updated: ${stateDirty}`,
    ].join(" | "),
  );

  const everyLookupFailed = config.appIds.length > 0 && succeeded.length === 0;
  if (everyLookupFailed) {
    log.error("Every lookup failed; treating this run as unsuccessful.");
    return 1;
  }
  return notificationFailures.length > 0 ? 1 : 0;
}

const exitCode = await run().catch((error) => {
  // Nothing is configured yet at this point, so redact defensively from raw env.
  const secrets = [process.env.SLACK_WEBHOOK_URL, process.env.STATE_SALT].filter(Boolean);
  const label = error instanceof ConfigError || error instanceof StateError ? error.name : "Fatal error";
  process.stderr.write(`[error] ${label}: ${safeMessage(error, secrets)}\n`);
  return 1;
});

process.exit(exitCode);
