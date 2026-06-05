/**
 * Lightweight update checker using GitHub Releases API.
 * No tauri-plugin-updater required.
 */

const GITHUB_API_URL = "https://api.github.com/repos/SounDoer/PLVS/releases/latest";

/**
 * Compare two semantic version strings.
 * Returns:
 *   > 0  if a > b  (a is newer)
 *   < 0  if a < b  (b is newer)
 *    0   if equal
 */
export function compareVersions(a, b) {
  const parse = (v) =>
    String(v)
      .replace(/^v/i, "")
      .split(".")
      .map((n) => parseInt(n, 10) || 0);

  const aa = parse(a);
  const bb = parse(b);
  const len = Math.max(aa.length, bb.length);

  for (let i = 0; i < len; i++) {
    const x = aa[i] ?? 0;
    const y = bb[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

/**
 * Fetch the latest release info from GitHub.
 * Returns { latestVersion, releaseUrl, hasUpdate } or null on failure.
 *
 * @param {string} currentVersion - e.g. "0.1.3"
 */
export async function checkForUpdate(currentVersion) {
  try {
    const res = await fetch(GITHUB_API_URL, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return null;

    const data = await res.json();
    const latestVersion = String(data.tag_name ?? "").replace(/^v/i, "");
    const releaseUrl = data.html_url ?? "https://github.com/SounDoer/PLVS/releases/latest";

    if (!latestVersion) return null;

    const hasUpdate = compareVersions(latestVersion, currentVersion) > 0;

    return { latestVersion, releaseUrl, hasUpdate };
  } catch {
    return null;
  }
}
