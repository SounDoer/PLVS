import { Download } from "lucide-react";
import { formatClock } from "../hooks/useSessionTimer.js";
import { FileAnalysisHistoryMenu } from "./FileAnalysisHistoryMenu.jsx";
import { formatMetric, formatSessionMetadataLine } from "@/lib/fileAnalysisDisplay";
import { SHELL_SURFACE_BASE, SHELL_SURFACE_SOFT_SHADOW } from "@/lib/shellLayout";
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
  onExportReport,
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

  const summary = fileSession?.summary ?? {};
  const fileName = fileSession?.fileName || "No file";
  const isComplete = fileSession?.state === "complete";

  return (
    <section
      className={cn(
        "flex w-full min-w-0 flex-wrap items-center gap-x-4 gap-y-2 border-[color:color-mix(in_srgb,var(--border)_var(--panel-opacity-header),transparent)] bg-[color:color-mix(in_srgb,var(--card)_var(--panel-opacity-header),transparent)] py-2 text-[length:var(--ui-fs-body)] text-popover-foreground",
        SHELL_SURFACE_BASE,
        SHELL_SURFACE_SOFT_SHADOW
      )}
    >
      {historyMenu}
      <div className="min-w-[14rem] flex-1">
        <p className="truncate text-[length:var(--ui-fs-body)] font-semibold text-foreground">
          {fileName}
        </p>
        <p className="mt-0.5 truncate text-[length:var(--ui-fs-control)] text-muted-foreground">
          {formatSessionMetadataLine(fileSession)}
        </p>
      </div>
      {isComplete ? (
        <dl className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1 text-[length:var(--ui-fs-control)]">
          <MetricPair label="Integrated" value={formatMetric(summary.integratedLufs, "LUFS")} />
          <MetricPair label="LRA" value={formatMetric(summary.lra, "LU")} />
          <MetricPair label="True Peak Max" value={formatMetric(summary.truePeakMaxDbtp, "dBTP")} />
        </dl>
      ) : null}
      {isComplete ? (
        <button
          type="button"
          onClick={() => onExportReport?.()}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-[color:color-mix(in_srgb,var(--border)_70%,transparent)] bg-[color:color-mix(in_srgb,color-mix(in_srgb,var(--background)_35%,transparent)_var(--panel-opacity-header),transparent)] px-2.5 text-[length:var(--ui-fs-control)] font-medium text-foreground shadow-sm transition-colors hover:bg-[color:color-mix(in_srgb,color-mix(in_srgb,var(--muted)_55%,transparent)_var(--panel-opacity-header),transparent)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Download className="size-3.5" aria-hidden="true" />
          <span>Export</span>
        </button>
      ) : null}
      {isComplete && fileSession?.historyTruncated ? (
        <p className="min-w-0 text-[length:var(--ui-fs-control)] text-[color:var(--ui-signal-warn)]">
          Delivery metrics cover the whole file. Scrub history is limited to the last{" "}
          {formatClock(fileSession.historyCoveredMs ?? 0)}.
        </p>
      ) : null}
    </section>
  );
}

function MetricPair({ label, value }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-[length:var(--ui-fs-caption)] uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </dt>
      <dd className="font-semibold tabular-nums text-foreground">{value}</dd>
    </div>
  );
}
