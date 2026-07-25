/**
 * Slice aggregated updater release notes down to the versions newer than the
 * installed one, so an update spanning several releases shows every version's
 * notes instead of only the target's.
 *
 * The updater manifest (latest.json) carries a cumulative changelog: a run of
 * `## [x.y.z]` sections from the target version downward. This keeps the sections
 * strictly newer than `currentVersion`. Bodies without version headers (legacy
 * single-section manifests) are returned unchanged.
 */

const SECTION_HEADER = /^## \[([^\]]+)\]/gm;

function parseVersion(raw) {
  if (typeof raw !== "string") return null;
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(raw.replace(/^v/i, "").trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isNewer(version, baseline) {
  for (let i = 0; i < 3; i++) {
    if (version[i] !== baseline[i]) return version[i] > baseline[i];
  }
  return false;
}

export function sliceChangelogSince(body, currentVersion) {
  if (typeof body !== "string" || body.trim() === "") return "";

  const headers = [];
  SECTION_HEADER.lastIndex = 0;
  let match;
  while ((match = SECTION_HEADER.exec(body))) {
    headers.push({ index: match.index, version: parseVersion(match[1]) });
  }

  // No version headers (legacy single-section notes) or an unparseable installed
  // version: nothing to slice on, so show the notes as they arrived.
  const baseline = parseVersion(currentVersion);
  if (headers.length === 0 || !baseline) return body.trim();

  const kept = [];
  for (let i = 0; i < headers.length; i++) {
    const { index, version } = headers[i];
    const end = i + 1 < headers.length ? headers[i + 1].index : body.length;
    if (version && isNewer(version, baseline)) kept.push(body.slice(index, end).trim());
  }

  // Everything is at or below the installed version (shouldn't happen for a real
  // update): fall back to the full body rather than an empty dialog.
  return kept.length > 0 ? kept.join("\n\n") : body.trim();
}
