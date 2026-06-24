import { formatClock } from "../hooks/useSessionTimer.js";
import { FileAnalysisHistoryMenu } from "./FileAnalysisHistoryMenu.jsx";
import {
  SHELL_SURFACE_BASE,
  SHELL_SURFACE_INSET_SHADOW,
  SHELL_SURFACE_SOFT_SHADOW,
} from "@/lib/shellLayout";
import { cn } from "@/lib/utils";

function fmtNumber(value, suffix) {
  return Number.isFinite(value) ? `${value.toFixed(1)} ${suffix}` : `-- ${suffix}`;
}

function trackLine(track) {
  if (!track) return "No track metadata";
  const sampleRate = Number.isFinite(track.sampleRateHz)
    ? `${Math.round(track.sampleRateHz / 1000)} kHz`
    : "unknown rate";
  const channels = Number.isFinite(track.channels) ? `${track.channels} ch` : "unknown channels";
  return `Track ${track.index ?? 0} · ${track.codec || "unknown codec"} · ${sampleRate} · ${channels}`;
}

function fileStateLine(fileSession) {
  if (fileSession?.state === "analyzing") {
    const pct = Number.isFinite(fileSession.progress) ? Math.round(fileSession.progress * 100) : 0;
    return `${Math.max(0, Math.min(100, pct))}%`;
  }
  if (fileSession?.state === "ready") return "Ready";
  return null;
}

// Metrics come from the authoritative completion summary payload (fileSession.summary), not the
// last displayed UI frame, so throttled/batched frames cannot skew the delivery numbers.
export function FileAnalysisSummary({
  fileSession,
  fileSessions,
  activeFileId,
  analyzingFileId,
  onSelectFile,
  onReanalyzeFile,
  onRemoveFile,
  onClearAllFiles,
}) {
  const historyMenu = (
    <FileAnalysisHistoryMenu
      fileSessions={fileSessions}
      activeFileId={activeFileId}
      analyzingFileId={analyzingFileId}
      onSelectFile={onSelectFile}
      onReanalyzeFile={onReanalyzeFile}
      onRemoveFile={onRemoveFile}
      onClearAllFiles={onClearAllFiles}
    />
  );

  if (fileSession?.state === "error") {
    return (
      <section
        className={cn(
          "flex w-full min-w-0 items-center gap-3 border-[color:color-mix(in_srgb,var(--ui-signal-bad)_30%,var(--border))] bg-[color:color-mix(in_srgb,var(--ui-signal-bad)_7%,var(--card))] py-2 text-sm text-popover-foreground",
          SHELL_SURFACE_BASE,
          SHELL_SURFACE_INSET_SHADOW
        )}
      >
        <p className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--ui-signal-bad)]">
          File analysis error
        </p>
        <p className="min-w-0 flex-1 truncate text-xs text-foreground">{fileSession.error}</p>
        {historyMenu}
      </section>
    );
  }

  const metadata = fileSession?.metadata;
  const summary = fileSession?.summary ?? {};
  const fileName = fileSession?.fileName || "No file";
  const track = metadata?.selectedTrack;
  const isComplete = fileSession?.state === "complete";
  const stateLine = fileStateLine(fileSession);
  const samplePeakMax = Math.max(
    summary.samplePeakMaxLDb ?? -Infinity,
    summary.samplePeakMaxRDb ?? -Infinity
  );

  return (
    <section
      className={cn(
        "flex w-full min-w-0 flex-wrap items-center gap-x-4 gap-y-2 border-border bg-card/55 py-2 text-sm text-popover-foreground",
        SHELL_SURFACE_BASE,
        SHELL_SURFACE_SOFT_SHADOW
      )}
    >
      <div className="min-w-[14rem] flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{fileName}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{trackLine(track)}</p>
      </div>
      {isComplete ? (
        <dl className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs">
          <MetricChip label="Integrated" value={fmtNumber(summary.integratedLufs, "LUFS")} />
          <MetricChip label="LRA" value={fmtNumber(summary.lra, "LU")} />
          <MetricChip label="True Peak Max" value={fmtNumber(summary.truePeakMaxDbtp, "dBTP")} />
          <MetricChip label="Sample Peak Max" value={fmtNumber(samplePeakMax, "dBFS")} />
        </dl>
      ) : stateLine ? (
        <p className="rounded-md border border-border/70 bg-background/35 px-2.5 py-1 text-xs font-semibold tabular-nums text-foreground">
          {stateLine}
        </p>
      ) : null}
      {isComplete && fileSession?.historyTruncated ? (
        <p className="min-w-0 text-xs text-[color:var(--ui-signal-warn)]">
          Delivery metrics cover the whole file. Scrub history is limited to the last{" "}
          {formatClock(fileSession.historyCoveredMs ?? 0)}.
        </p>
      ) : null}
      {historyMenu}
    </section>
  );
}

function MetricChip({ label, value }) {
  return (
    <div className="flex items-baseline gap-2 rounded-md border border-border/70 bg-background/35 px-2.5 py-1">
      <dt className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">{label}</dt>
      <dd className="font-semibold tabular-nums text-foreground">{value}</dd>
    </div>
  );
}
