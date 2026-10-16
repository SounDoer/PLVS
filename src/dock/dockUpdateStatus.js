/**
 * Dock's compact update state. `label` is the stable phase name for the toolbar toggle's badge
 * tip; `text` is the toolbar entry and adds the version or download progress.
 *
 * @param {{ updateInfo?: { hasUpdate?: boolean, latestVersion?: string }, error?: any,
 *   downloading?: boolean, downloadProgress?: number | null, ready?: any }} updates
 * @returns {{ phase: string, label: string, text: string } | null}
 */
export function dockUpdateStatus(updates) {
  if (!updates?.updateInfo?.hasUpdate) return null;
  const version = updates.updateInfo.latestVersion ? ` · v${updates.updateInfo.latestVersion}` : "";
  if (updates.error) return { phase: "error", label: "Update Failed", text: "Update Failed" };
  if (updates.downloading) {
    const progress = updates.downloadProgress;
    const percent = Number.isFinite(progress) ? ` · ${Math.round(progress * 100)}%` : "";
    return {
      phase: "downloading",
      label: "Downloading Update",
      text: `Downloading Update${percent}`,
    };
  }
  if (updates.ready)
    return { phase: "ready", label: "Update Ready", text: `Update Ready${version}` };
  return { phase: "available", label: "Update Available", text: `Update Available${version}` };
}
