import { formatClock } from "../hooks/useSessionTimer.js";
import { FileAnalysisHistoryMenu } from "./FileAnalysisHistoryMenu.jsx";
import { formatMetric, formatSessionMetadataLine } from "@/lib/fileAnalysisDisplay";
import {
  SHELL_SURFACE_BASE,
  SHELL_SURFACE_INSET_SHADOW,
  SHELL_SURFACE_SOFT_SHADOW,
} from "@/lib/shellLayout";
import { cn } from "@/lib/utils";

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
  onStopFile,
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
      onStopFile={onStopFile}
    />
  );

  if (fileSession?.state === "error") {
    const errorTitle = fileSession.fileName
      ? `Could not analyze ${fileSession.fileName}`
      : "Could not analyze file";

    return (
      <section
        className={cn(
          "flex w-full min-w-0 flex-wrap items-center gap-x-4 gap-y-2 border-[color:color-mix(in_srgb,var(--ui-signal-bad)_30%,var(--border))] bg-[color:color-mix(in_srgb,var(--ui-signal-bad)_7%,var(--card))] py-2 text-sm text-popover-foreground",
          SHELL_SURFACE_BASE,
          SHELL_SURFACE_INSET_SHADOW
        )}
      >
        {historyMenu}
        <div className="min-w-[14rem] flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--ui-signal-bad)]">
            File analysis error
          </p>
          <p className="mt-0.5 truncate text-sm font-semibold text-foreground">{errorTitle}</p>
        </div>
        <p className="min-w-[12rem] flex-1 truncate text-xs text-foreground">{fileSession.error}</p>
      </section>
    );
  }

  const summary = fileSession?.summary ?? {};
  const fileName = fileSession?.fileName || "No file";
  const isComplete = fileSession?.state === "complete";

  return (
    <section
      className={cn(
        "flex w-full min-w-0 flex-wrap items-center gap-x-4 gap-y-2 border-border bg-card/55 py-2 text-sm text-popover-foreground",
        SHELL_SURFACE_BASE,
        SHELL_SURFACE_SOFT_SHADOW
      )}
    >
      {historyMenu}
      <div className="min-w-[14rem] flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{fileName}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {formatSessionMetadataLine(fileSession)}
        </p>
      </div>
      {isComplete ? (
        <dl className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs">
          <MetricChip label="Integrated" value={formatMetric(summary.integratedLufs, "LUFS")} />
          <MetricChip label="LRA" value={formatMetric(summary.lra, "LU")} />
          <MetricChip label="True Peak Max" value={formatMetric(summary.truePeakMaxDbtp, "dBTP")} />
        </dl>
      ) : null}
      {isComplete && fileSession?.historyTruncated ? (
        <p className="min-w-0 text-xs text-[color:var(--ui-signal-warn)]">
          Delivery metrics cover the whole file. Scrub history is limited to the last{" "}
          {formatClock(fileSession.historyCoveredMs ?? 0)}.
        </p>
      ) : null}
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
