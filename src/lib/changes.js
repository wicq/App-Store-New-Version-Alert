/**
 * Decide what a single lookup means for one app.
 *
 * Apple's Lookup API is fronted by caches that do not all expire together, so
 * the same query can return an older snapshot minutes after returning a newer
 * one. Comparing `version` alone turns that into a stream of false alerts that
 * flip back and forth between two versions.
 *
 * Releases only ever move forward in time, so `currentVersionReleaseDate` is
 * the ordering signal: a snapshot older than what we already stored is stale by
 * definition and is ignored outright, without advancing state.
 */

const parseDate = (value) => {
  if (!value) return NaN;
  return new Date(value).getTime();
};

/**
 * @returns {{ action: "notify" | "store" | "ignore", reason: string }}
 *   notify - a genuine new release; send Slack, then store
 *   store  - remember this reading silently (first sighting, or metadata drift)
 *   ignore - leave state untouched
 */
export function classifyObservation({ stored, app }) {
  if (!stored?.version) {
    // First sighting: never announce a release that happened before we looked.
    return { action: "store", reason: "baseline" };
  }

  // Written by a version of the monitor that did not record release dates, so
  // the stored version may itself have come from a stale snapshot. Re-baseline.
  if (!stored.release_date) {
    return { action: "store", reason: "rebaseline" };
  }

  const versionChanged = app.version !== stored.version;
  const observedAt = parseDate(app.releaseDate);
  const storedAt = parseDate(stored.release_date);

  if (Number.isNaN(observedAt) || Number.isNaN(storedAt)) {
    // No usable ordering signal; fall back to comparing versions alone.
    return versionChanged
      ? { action: "notify", reason: "no-release-date" }
      : { action: "ignore", reason: "unchanged" };
  }

  if (observedAt < storedAt) {
    return { action: "ignore", reason: "stale" };
  }

  if (observedAt > storedAt) {
    return versionChanged
      ? { action: "notify", reason: "release" }
      : { action: "store", reason: "metadata" };
  }

  // Same release timestamp but a different version string: the caches disagree
  // in a way the date cannot resolve, so refuse to guess.
  return versionChanged
    ? { action: "ignore", reason: "ambiguous" }
    : { action: "ignore", reason: "unchanged" };
}
