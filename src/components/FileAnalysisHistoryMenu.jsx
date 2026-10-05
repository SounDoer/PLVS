import { FileStack, RefreshCw, Square, Trash2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { POPOVER_TITLE_CLASS } from "@/components/ui/surfaceStyles.js";
import { formatCompactSessionMetadata, formatDeliveryTriple } from "@/lib/fileAnalysisDisplay";
import { cn } from "@/lib/utils";
import { formatClock } from "../hooks/useSessionTimer.js";
import { IconAction } from "@/components/ui/icon-action";
import { RowAction } from "@/components/ui/row";
import { Button } from "@/components/ui/button";

function statusLabel(session) {
  if (session?.state === "ready") return "Ready";
  if (session?.state === "analyzing") {
    const pct = Number.isFinite(session.progress) ? Math.round(session.progress * 100) : 0;
    return `${Math.max(0, Math.min(100, pct))}%`;
  }
  if (session?.state === "complete") {
    const durationMs = session.summary?.durationMs ?? session.metadata?.durationMs;
    return Number.isFinite(durationMs) ? formatClock(durationMs) : "Done";
  }
  if (session?.state === "error") return "Error";
  return "File";
}

function detailLabel(session) {
  if (session?.state === "complete") {
    return formatDeliveryTriple(session.summary) ?? formatCompactSessionMetadata(session);
  }
  if (session?.state === "error") return session.error || "Analysis failed";
  return formatCompactSessionMetadata(session);
}

export function FileAnalysisHistoryMenu({
  fileSessions = [],
  activeFileId = null,
  analyzingFileId = null,
  onSelectFile,
  onReanalyzeFile,
  onRemoveFile,
  onClearAllFiles,
  onStopFile,
}) {
  const count = fileSessions.length;
  if (count === 0) return null;

  const countLabel = `${count} ${count === 1 ? "file" : "files"}`;
  const analyzingSession = analyzingFileId
    ? fileSessions.find((session) => session.id === analyzingFileId)
    : null;
  const analyzingPct =
    analyzingSession && Number.isFinite(analyzingSession.progress)
      ? Math.max(0, Math.min(100, Math.round(analyzingSession.progress * 100)))
      : null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          aria-label={countLabel}
          className="border border-border px-2.5 data-[state=open]:bg-[color:var(--ui-secondary-hover)]"
        >
          <FileStack className="size-[1.15em]" aria-hidden="true" />
          <span className="tabular-nums">{count}</span>
          {analyzingPct != null ? (
            <span
              aria-hidden="true"
              className="text-[length:var(--ui-fs-caption)] tabular-nums text-muted-foreground"
            >
              {`${analyzingPct}%`}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-80 max-w-[92vw] p-1">
        <div className="flex items-center justify-between gap-2 px-2 py-1">
          <p className={POPOVER_TITLE_CLASS}>File History</p>
          <button
            type="button"
            onClick={() => onClearAllFiles?.()}
            className="rounded-xs px-1.5 py-1 text-[length:var(--ui-fs-caption)] font-medium text-muted-foreground transition-colors hover:bg-ui-hover hover:text-destructive"
            aria-label="Clear all file history"
          >
            Clear all
          </button>
        </div>
        <div className="grid gap-0.5">
          {fileSessions.map((session) => {
            const isActive = session.id === activeFileId;
            const isAnalyzing = session.id === analyzingFileId;
            const detail = detailLabel(session);
            return (
              <div
                key={session.id}
                className="group flex items-center gap-1 rounded-xs text-[length:var(--ui-fs-control)] transition-colors hover:bg-ui-hover focus-within:bg-ui-hover"
              >
                <RowAction
                  onClick={() => onSelectFile?.(session.id)}
                  aria-label={`Show file ${session.fileName}`}
                  className="px-1.5 py-1.5"
                >
                  <span
                    aria-label={isActive ? `Active file ${session.fileName}` : undefined}
                    className={cn(
                      "size-1.5 shrink-0 rounded-full border",
                      isActive
                        ? "border-primary bg-primary"
                        : "border-muted-foreground bg-transparent"
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-foreground">
                      {session.fileName}
                    </span>
                    <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[length:var(--ui-fs-caption)] text-muted-foreground">
                      <span>{statusLabel(session)}</span>
                    </span>
                    {detail ? (
                      <span
                        className={cn(
                          "mt-0.5 block truncate text-[length:var(--ui-fs-caption)] tabular-nums",
                          session.state === "error"
                            ? "text-[color:var(--ui-feedback-danger)]"
                            : "text-muted-foreground"
                        )}
                      >
                        {detail}
                      </span>
                    ) : null}
                  </span>
                </RowAction>
                <span className="flex shrink-0 items-center gap-0.5 pr-1">
                  {isAnalyzing ? (
                    <IconAction
                      onClick={() => onStopFile?.(session.id)}
                      aria-label={`Stop analyzing ${session.fileName}`}
                      className="p-1 text-[color:var(--ui-activity-live)] hover:bg-ui-hover hover:text-[color:var(--ui-activity-live)]"
                    >
                      <Square className="size-[length:var(--ui-icon-management-action)]" />
                    </IconAction>
                  ) : (
                    <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                      <IconAction
                        onClick={() => onReanalyzeFile?.(session.id)}
                        aria-label={`Reanalyze ${session.fileName}`}
                        className="p-1"
                      >
                        <RefreshCw className="size-[length:var(--ui-icon-management-action)]" />
                      </IconAction>
                      <IconAction
                        onClick={() => onRemoveFile?.(session.id)}
                        aria-label={`Remove ${session.fileName}`}
                        className="p-1 hover:text-destructive"
                      >
                        <Trash2 className="size-[length:var(--ui-icon-management-action)]" />
                      </IconAction>
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
