# App Store New Version Alert

A small GitHub Actions service that watches a private list of iOS apps on Apple's
public App Store Lookup API and posts a Slack message when one of them ships a
new version.

No servers, no dependencies, no database: a scheduled workflow, one Node.js 24
script, and a digest-keyed state file committed back to this repository.

```
schedule (*/5 * * * *)
        │
        ▼
app IDs from GitHub Secrets
        │
        ▼
itunes.apple.com/lookup  ──► current version
        │
        ▼
compare with stored version
        │
   ┌────┴────┐
 same      changed
   │          │
 nothing   POST Slack Workflow Builder ──► save new version
```

## How it works

1. `COMPETITOR_APP_IDS` (a secret) is parsed into a list of numeric App Store IDs.
2. Each ID is looked up on `https://itunes.apple.com/lookup`, sequentially for
   short lists and with a small concurrency limit for longer ones.
3. The returned `version` is compared with the last observed version in
   [`state/versions.json`](state/versions.json).
4. On the first sighting of an app the current version is stored **without**
   notifying, so deploying the monitor does not announce every app at once.
5. On a change, a flat JSON payload is POSTed to a Slack Workflow Builder
   webhook. State is advanced **only after Slack accepts the request**, so an
   outage delays a notification instead of losing it.
6. The workflow commits the updated state file, which makes every version
   transition fire exactly once.

## Setup

### 1. Create the Slack trigger

In Slack, build a workflow starting **From a webhook** and declare these
variables (all of type *text*):

| Variable | Description |
| --- | --- |
| `app_name` | App Store app name |
| `app_id` | App Store ID |
| `bundle_id` | Bundle identifier |
| `old_version` | Previously observed version |
| `new_version` | Newly detected version |
| `release_date` | Release date of the current version |
| `release_notes` | Release notes (truncated to 2,500 characters) |
| `app_store_url` | App Store URL |
| `icon_url` | App icon URL |
| `minimum_ios` | Minimum supported iOS version |
| `file_size_bytes` | Download size in bytes |

Message layout lives in Slack, not in this repository — the script only sends
data. Copy the generated request URL; it is a credential.

### 2. Add the repository secrets

| Secret | Required | Purpose |
| --- | --- | --- |
| `COMPETITOR_APP_IDS` | yes | Comma-separated App Store IDs, e.g. `111111111,222222222` |
| `SLACK_WEBHOOK_URL` | yes | The Slack Workflow Builder request URL |
| `STATE_SALT` | strongly recommended | Random string that salts the state keys (see below) |

Generate a salt once and never change it — changing it orphans the existing
state, and every app is re-baselined on the next run:

```bash
openssl rand -hex 32
```

### 3. Enable the workflow

The schedule starts on its own once
[`.github/workflows/monitor.yml`](.github/workflows/monitor.yml) is on the
default branch. Use **Run workflow** to trigger a manual check; tick *dry run*
to detect changes without calling Slack.

## Privacy model

This repository is public, so both the tracked app list and the Slack credential
must stay out of the code, the state file and the logs.

- **App IDs and the webhook URL** only ever arrive through GitHub Secrets.
- **State keys** are `HMAC-SHA256(STATE_SALT, app_id)`, truncated to 32 hex
  characters. A plain SHA-256 of an App Store ID would be trivially reversible
  (the ID space is small enough to enumerate), which is exactly why the salt
  matters; without `STATE_SALT` the script still runs but logs a warning.
- **Logs** contain counts and failure reasons only — never an app name, an ID or
  a version string. Every log line and every error message is passed through a
  redactor that scrubs known secrets, because third-party errors (`fetch`, in
  particular) happily embed the request URL.
- **The webhook host** is pinned to `hooks.slack.com`, so a mistyped or swapped
  secret cannot ship competitor metadata to another host.
- **Commits** made by the workflow touch `state/` only, and that file holds
  digests and version strings.

What a reader of this repository can still learn: that monitoring exists, how
often it polls, and how many apps are tracked.

## State

```json
{
  "version": 1,
  "apps": {
    "3c57d294edfb37ce776859780fa2e072": {
      "version": "7.136.0",
      "detected_at": "2026-08-18T14:05:00Z"
    }
  }
}
```

The file is written atomically, keys are sorted for clean diffs, and it is
committed by the workflow with `if: always()` so a notification that already
reached Slack is never re-sent, even if a later step in the same run fails.

If the state file is ever lost, the next run re-baselines every app silently: no
duplicate alerts, but one release could be missed in that window.

## Local development

```bash
npm test
```

A dry run against the live Apple API, with state kept out of the repository:

```bash
COMPETITOR_APP_IDS="111111111,222222222" STATE_SALT="local-salt" STATE_FILE="/tmp/monitor-state.json" DRY_RUN=1 node src/monitor.js
```

`DRY_RUN=1` detects changes, skips Slack and leaves state untouched, so it is
safe to run repeatedly. To rehearse a notification, edit the version inside your
local state file and run again without `DRY_RUN`.

## Configuration

Beyond the three secrets, these environment variables are available (all optional):

| Variable | Default | Purpose |
| --- | --- | --- |
| `STATE_FILE` | `state/versions.json` | Where observed versions are stored |
| `STOREFRONT_COUNTRY` | `us` | Storefront used for the lookup |
| `DRY_RUN` | `false` | Detect changes without calling Slack |
| `LOOKUP_CONCURRENCY` | `1` for ≤5 apps, else `3` | In-flight Apple requests |
| `SLACK_MIN_INTERVAL_MS` | `1100` | Spacing between Slack posts (~1 req/s limit) |

## Failure handling

| Situation | Behaviour |
| --- | --- |
| Apple timeout, 5xx, 429/403, malformed JSON | Retried twice with backoff; other apps unaffected |
| Unknown app ID (empty result) or missing `version` | That app is reported as failed, the run continues |
| Slack 429/5xx/timeout | Retried (honouring `Retry-After`), then left for the next run |
| Slack 4xx | Permanent failure; state unchanged so the change is retried |
| Every lookup failed, or any notification failed | Run exits non-zero to surface a red check |
| Missing or malformed secrets, unreadable state | Run exits non-zero before any request is made |

Each run ends with a summary line: apps checked, successful and failed lookups,
new baselines, version changes, notifications sent and failed.

## Operational notes

- GitHub's scheduler is best-effort; a 5-minute cron can drift under load, so
  detection is near-real-time, not real-time.
- Scheduled workflows in a public repository are disabled after 60 days without
  repository activity. The state commits produced by this workflow count as
  activity, so that only matters during long quiet stretches.
- Runs are serialized through a `concurrency` group so two polls cannot race on
  the state file.

## Scope

Apple App Store version changes only. Google Play, binary or IPA analysis,
screenshot/description/pricing/ranking diffing, dashboards and interactive Slack
messages are deliberately out of scope. The lookup response is already
normalized in [`src/lib/appstore.js`](src/lib/appstore.js), so adding fields such
as `releaseNotes`, `price` or `averageUserRating` to the comparison is a small,
contained change.
