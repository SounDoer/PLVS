import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Download } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  onCopyReport,
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
        <ExportReportMenu onExportReport={onExportReport} onCopyReport={onCopyReport} />
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

const COPIED_FEEDBACK_MS = 1500;

function ExportReportMenu({ onExportReport, onCopyReport }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef(null);

  useEffect(
    () => () => {
      if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
    },
    []
  );

  const choose = (action) => {
    setOpen(false);
    action();
  };

  // The menu closes on the click, so the confirmation lands on the trigger, for as long as
  // `CopyableTextBlock` shows its own. A failure is reported by the hook's notice instead.
  const copy = async () => {
    if (!(await onCopyReport?.())) return;
    setCopied(true);
    if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
    resetTimerRef.current = window.setTimeout(() => {
      setCopied(false);
      resetTimerRef.current = null;
    }, COPIED_FEEDBACK_MS);
  };

  const Icon = copied ? Check : Download;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-[color:color-mix(in_srgb,var(--border)_70%,transparent)] bg-[color:color-mix(in_srgb,color-mix(in_srgb,var(--background)_35%,transparent)_var(--panel-opacity-header),transparent)] px-2.5 text-[length:var(--ui-fs-control)] font-medium text-foreground shadow-sm transition-colors hover:bg-[color:color-mix(in_srgb,color-mix(in_srgb,var(--muted)_55%,transparent)_var(--panel-opacity-header),transparent)]"
        >
          <Icon className="size-[1.15em]" aria-hidden="true" />
          <span>{copied ? "Copied" : "Export"}</span>
          <ChevronDown className="size-[1em] text-muted-foreground" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-48 p-1">
        <MenuItem onClick={() => choose(() => onExportReport?.("markdown"))}>
          Export Markdown…
        </MenuItem>
        <MenuItem onClick={() => choose(() => onExportReport?.("json"))}>Export JSON…</MenuItem>
        <MenuItem onClick={() => choose(copy)}>Copy as Markdown</MenuItem>
      </PopoverContent>
    </Popover>
  );
}

function MenuItem({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center rounded-xs px-2 py-1.5 text-left text-[length:var(--ui-fs-control)] text-foreground transition-colors hover:bg-muted/50"
    >
      {children}
    </button>
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
