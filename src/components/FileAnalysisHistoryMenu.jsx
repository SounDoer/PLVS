import { FileStack, RefreshCw, Square, Trash2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatCompactSessionMetadata, formatDeliveryTriple } from "@/lib/fileAnalysisDisplay";
import { cn } from "@/lib/utils";
import { formatClock } from "../hooks/useSessionTimer.js";

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
        <button
          type="button"
          aria-label={countLabel}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-[color:color-mix(in_srgb,var(--border)_70%,transparent)] bg-[color:color-mix(in_srgb,color-mix(in_srgb,var(--background)_35%,transparent)_var(--panel-opacity-header),transparent)] px-2.5 text-[length:var(--ui-fs-control)] font-medium text-foreground shadow-sm transition-colors hover:bg-[color:color-mix(in_srgb,color-mix(in_srgb,var(--muted)_55%,transparent)_var(--panel-opacity-header),transparent)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <FileStack className="size-3.5" aria-hidden="true" />
          <span className="tabular-nums">{count}</span>
          {analyzingPct != null ? (
            <span
              aria-hidden="true"
              className="text-[length:var(--ui-fs-caption)] tabular-nums text-muted-foreground"
            >
              {`${analyzingPct}%`}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-80 max-w-[92vw] p-1">
        <div className="flex items-center justify-between gap-2 px-2 py-1">
          <p className="text-[length:var(--ui-fs-caption)] font-semibold tracking-wide text-muted-foreground">
            File History
          </p>
          <button
            type="button"
            onClick={() => onClearAllFiles?.()}
            className="rounded px-1.5 py-1 text-[length:var(--ui-fs-caption)] font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
                className="group flex items-center gap-1 rounded text-[length:var(--ui-fs-control)] transition-colors hover:bg-muted/50 focus-within:bg-muted/50"
              >
                <button
                  type="button"
                  onClick={() => onSelectFile?.(session.id)}
                  aria-label={`Show file ${session.fileName}`}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-1.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <span
                    aria-label={isActive ? `Active file ${session.fileName}` : undefined}
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      isActive ? "bg-primary" : "bg-muted-foreground/20"
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
                            ? "text-[color:var(--ui-signal-bad)]"
                            : "text-muted-foreground"
                        )}
                      >
                        {detail}
                      </span>
                    ) : null}
                  </span>
                </button>
                <span className="flex shrink-0 items-center gap-0.5 pr-1">
                  {isAnalyzing ? (
                    <button
                      type="button"
                      onClick={() => onStopFile?.(session.id)}
                      aria-label={`Stop analyzing ${session.fileName}`}
                      className="rounded p-1 text-[color:var(--ui-signal-bad)] transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <Square className="size-3.5" />
                    </button>
                  ) : (
                    <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                      <button
                        type="button"
                        onClick={() => onReanalyzeFile?.(session.id)}
                        aria-label={`Reanalyze ${session.fileName}`}
                        className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        <RefreshCw className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemoveFile?.(session.id)}
                        aria-label={`Remove ${session.fileName}`}
                        className="rounded p-1 text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
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
