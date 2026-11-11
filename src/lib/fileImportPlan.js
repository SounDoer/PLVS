import { getSuccessfulFileSession } from "./fileAnalysisSessionRegistry.js";
import { sameFileSourceVersion } from "./fileAnalysisSource.js";

/** The audio tracks an import chooses from; a file with more than one needs an explicit choice. */
export function fileImportTracks(probe) {
  return probe.audioTracks?.length ? probe.audioTracks : [probe.selectedTrack];
}

/**
 * What importing `probe` (with its track already chosen) does to the File ledger. The GUI and Agent
 * Control share this so reimporting an unchanged file and track never creates a second entry.
 *
 * @returns {{ action: "select" | "rerun" | "analyze", sessionId: string | null }}
 */
export function planFileImport(files, probe) {
  const existing = files.find(
    (file) =>
      file.metadata?.selectedTrack?.index === probe.selectedTrack.index &&
      sameFileSourceVersion(file.metadata?.sourceVersion, probe.sourceVersion)
  );
  if (!existing) return { action: "analyze", sessionId: null };
  return {
    action: getSuccessfulFileSession(existing) ? "select" : "rerun",
    sessionId: existing.id,
  };
}
