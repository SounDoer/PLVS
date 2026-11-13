import { useEffect, useRef, useState } from "react";
import {
  Check,
  CircleAlert,
  Clock,
  Download,
  FileStack,
  Play,
  RefreshCw,
  Square,
  Trash2,
} from "lucide-react";
import { ConfirmDialog } from "./ConfirmDialog.jsx";
import { HoverTip } from "./HoverTip.jsx";
import { MiddleTruncatedText } from "./MiddleTruncatedText.jsx";
import { useDropdownNavigation } from "../uiNavigation/useDropdownNavigation.js";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.jsx";
import { POPOVER_TITLE_CLASS } from "./ui/surfaceStyles.js";
import { getSuccessfulFileSession } from "../lib/fileAnalysisSessionRegistry.js";
import { ManagementIconAction } from "./ManagementRow.jsx";
import { MenuRow, RowAction } from "./ui/row.jsx";
import { Button } from "./ui/button.jsx";
import { IconAction } from "./ui/icon-action.jsx";
import { cn } from "../lib/utils.js";
import { formatFileEntryName } from "../lib/fileAnalysisDisplay.js";

const actionSize = "size-[length:var(--ui-icon-management-action)]";
const fileActionsClass =
  "grid shrink-0 grid-cols-[auto_repeat(3,var(--ui-icon-management-action))] items-center justify-items-center gap-1 pr-2";
const fileNameClass =
  "block min-w-0 text-[length:var(--ui-fs-control)] font-medium text-foreground";

function FileRowName({ name, error = null }) {
  return (
    <span className="min-w-0 flex-1">
      <span className={fileNameClass}>
        <MiddleTruncatedText text={name} />
      </span>
      {error ? (
        <span className="block break-words text-[length:var(--ui-fs-caption)] text-muted-foreground">
          {error}
        </span>
      ) : null}
    </span>
  );
}

function FileStatusIcon({ label, icon: Icon }) {
  return (
    <HoverTip tip={label} className="flex shrink-0 items-center py-1 text-muted-foreground">
      <Icon role="img" aria-label={label} tabIndex={0} className={actionSize} />
    </HoverTip>
  );
}

function ReportMenu({ session, onExportReport, onCopyReport }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  const navigation = useDropdownNavigation("file-report:" + session.id);
  useEffect(() => () => clearTimeout(timer.current), []);
  const choose = (action) => {
    navigation.rootProps.onOpenChange(false);
    action();
  };
  const copy = async () => {
    if (!(await onCopyReport?.(session))) return;
    clearTimeout(timer.current);
    setCopied(true);
    timer.current = setTimeout(() => setCopied(false), 1500);
  };
  const Icon = copied ? Check : Download;
  return (
    <Popover {...navigation.rootProps}>
      <PopoverTrigger asChild>
        <IconAction
          {...navigation.triggerProps}
          aria-label={"export report for " + session.fileName}
          title={copied ? "Copied" : "Export Report"}
          className="py-1"
        >
          <Icon className={actionSize} aria-hidden="true" />
        </IconAction>
      </PopoverTrigger>
      <PopoverContent align="end" side="right" className="w-max p-1" aria-label="Export Report">
        <MenuRow
          className="px-2"
          onClick={() => choose(() => onExportReport?.("markdown", session))}
        >
          Export Markdown…
        </MenuRow>
        <MenuRow className="px-2" onClick={() => choose(() => onExportReport?.("json", session))}>
          Export JSON…
        </MenuRow>
        <MenuRow className="px-2" onClick={() => choose(copy)}>
          Copy as Markdown
        </MenuRow>
      </PopoverContent>
    </Popover>
  );
}

export function FileAnalysisHistoryMenu({
  fileQueue = null,
  fileSessions = [],
  activeFileId = null,
  analyzingFileId = null,
  fileTaskBusy = false,
  onSelectFile,
  onReanalyzeFile,
  onRemoveFile,
  onClearAllFiles,
  onStopFile,
  onExportReport = null,
  onCopyReport = null,
  onExportStatistics = null,
}) {
  const navigation = useDropdownNavigation("file-history:files");
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmCancelBatch, setConfirmCancelBatch] = useState(false);
  const pending = fileQueue?.items ?? [];
  const pendingBySession = new Map(
    pending.filter((item) => item.retryId).map((item) => [item.retryId, item])
  );
  const retryLabel = fileQueue?.active || analyzingFileId ? "Add to Queue" : "Retry";
  const queuedCount = pending.filter(
    ({ state }) => state === "queued" || state === "probed"
  ).length;
  const trackCount = pending.filter(({ state }) => state === "track").length;
  const queueStatus = [
    (analyzingFileId || fileQueue?.probing) && "1 Analyzing",
    queuedCount > 0 && `${queuedCount} Queued`,
    trackCount > 0 && `${trackCount} Awaiting Track Selection`,
  ]
    .filter(Boolean)
    .join(" · ");
  if (!fileSessions.length && !pending.length) return null;
  const close = () => navigation.rootProps.onOpenChange(false);
  return (
    <>
      <Popover {...navigation.rootProps}>
        <HoverTip
          tip={navigation.rootProps.open ? "" : "Files"}
          showOnFocus={false}
          className="shrink-0"
        >
          <PopoverTrigger asChild>
            <Button variant="quiet" size="icon" {...navigation.triggerProps} aria-label="files">
              <FileStack className="size-[length:var(--ui-icon-shell-action)]" aria-hidden="true" />
            </Button>
          </PopoverTrigger>
        </HoverTip>
        <PopoverContent
          align="start"
          className="flex max-h-[var(--radix-popover-content-available-height)] w-[var(--ui-surface-compact-w)] flex-col overflow-hidden p-1"
          aria-label="Files"
        >
          <header className="shrink-0 px-2 py-1">
            <p className={POPOVER_TITLE_CLASS}>Files</p>
            {(fileQueue?.active || trackCount > 0) && queueStatus ? (
              <p className="text-[length:var(--ui-fs-caption)] text-muted-foreground">
                {queueStatus}
              </p>
            ) : null}
          </header>
          <div className="min-h-0 max-h-[50dvh] overflow-auto overscroll-contain">
            {fileSessions.map((session) => {
              const active = session.id === activeFileId;
              const running = session.id === analyzingFileId;
              const successful = Boolean(getSuccessfulFileSession(session));
              const fromBatch = fileQueue?.sessionIds.has(session.id);
              const failed = session.state === "error";
              const canceled = session.state === "canceled" || session.runOutcome === "stopped";
              const pendingRetry = pendingBySession.get(session.id);
              const name = formatFileEntryName(session, fileSessions);
              const verb = successful ? "Reanalyze" : "Analyze";
              const progress =
                Number.isFinite((session.attempt?.metadata ?? session.metadata)?.durationMs) &&
                session.state === "analyzing"
                  ? Math.round(Math.min(1, Math.max(0, session.progress ?? 0)) * 100) + "%"
                  : "Working…";
              return (
                <div
                  key={session.id}
                  className="group flex min-h-[var(--ui-row-h)] min-w-0 items-center gap-1 rounded-xs hover:bg-ui-hover focus-within:bg-ui-hover"
                >
                  <RowAction
                    aria-label={"show file " + name}
                    aria-current={active ? "true" : undefined}
                    onClick={() => {
                      close();
                      if (!active || running) onSelectFile?.(session.id);
                    }}
                    className="px-2"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "size-1.5 shrink-0 rounded-full border",
                        active ? "border-primary bg-primary" : "border-muted-foreground"
                      )}
                    />
                    <FileRowName
                      name={name}
                      error={
                        pendingRetry
                          ? pendingRetry.error
                          : fromBatch && failed
                            ? session.error
                            : null
                      }
                    />
                  </RowAction>
                  <div className={fileActionsClass}>
                    <div className="col-start-1 row-start-1 flex items-center">
                      {!running &&
                      (pendingRetry ? pendingRetry.state === "error" : fromBatch && failed) ? (
                        <FileStatusIcon label="Failed" icon={CircleAlert} />
                      ) : null}
                      {running && successful ? (
                        <span className="text-[length:var(--ui-fs-caption)] tabular-nums text-muted-foreground">
                          {progress}
                        </span>
                      ) : null}
                    </div>
                    {successful ? (
                      <div className="col-start-2 row-start-1 flex items-center">
                        <ReportMenu
                          session={session}
                          onExportReport={onExportReport}
                          onCopyReport={onCopyReport}
                        />
                      </div>
                    ) : running ? (
                      <span className="col-span-2 col-start-1 row-start-1 justify-self-end text-[length:var(--ui-fs-caption)] tabular-nums text-muted-foreground">
                        {progress}
                      </span>
                    ) : null}
                    <div
                      className={cn(
                        "col-start-3 row-start-1 flex items-center",
                        pendingRetry?.state === "track" &&
                          !running &&
                          (successful
                            ? "col-start-1 justify-self-end"
                            : "col-start-1 col-span-3 justify-self-end")
                      )}
                    >
                      {running ? (
                        <ManagementIconAction
                          label={(fromBatch ? "stop analysis of " : "cancel analysis of ") + name}
                          tip={fromBatch ? "Stop" : "Cancel"}
                          icon={
                            <Square className={cn(actionSize, "scale-85")} aria-hidden="true" />
                          }
                          onClick={() => onStopFile?.(session.id)}
                        />
                      ) : pendingRetry?.state === "track" ? (
                        <Button
                          variant="quiet"
                          onClick={() => {
                            close();
                            fileQueue.chooseTrack(pendingRetry.id);
                          }}
                        >
                          Choose Track…
                        </Button>
                      ) : pendingRetry &&
                        ["queued", "probed", "working"].includes(pendingRetry.state) ? (
                        <FileStatusIcon label="Queued" icon={Clock} />
                      ) : fromBatch && (failed || canceled || pendingRetry) ? (
                        <ManagementIconAction
                          label={retryLabel.toLowerCase() + " " + name}
                          tip={canceled ? `Canceled · ${retryLabel}` : retryLabel}
                          icon={<RefreshCw className={actionSize} />}
                          onClick={() =>
                            pendingRetry
                              ? fileQueue.retry(pendingRetry.id)
                              : fileQueue.retrySession(session)
                          }
                        />
                      ) : (
                        <ManagementIconAction
                          label={verb.toLowerCase() + " " + name}
                          tip={verb}
                          icon={
                            successful ? (
                              <RefreshCw className={actionSize} />
                            ) : (
                              <Play className={actionSize} />
                            )
                          }
                          disabled={fileTaskBusy || Boolean(analyzingFileId)}
                          onClick={() => onReanalyzeFile?.(session.id)}
                        />
                      )}
                    </div>
                    <div className="col-start-4 row-start-1 flex items-center">
                      <ManagementIconAction
                        label={"remove " + name}
                        tip="Remove"
                        icon={<Trash2 className={actionSize} />}
                        disabled={running}
                        onClick={() => {
                          if (pendingRetry) fileQueue.remove(pendingRetry.id);
                          onRemoveFile?.(session.id);
                        }}
                        className="hover:text-destructive"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
            {pending
              .filter(
                (item) =>
                  !item.retryId || !fileSessions.some((session) => session.id === item.retryId)
              )
              .map((item) => (
                <div
                  key={item.id}
                  className="flex min-h-[var(--ui-row-h)] min-w-0 items-center gap-1 rounded-xs pl-2 hover:bg-ui-hover focus-within:bg-ui-hover"
                >
                  <span aria-hidden="true" className="mr-1 size-1.5 shrink-0" />
                  <FileRowName name={item.fileName} error={item.error} />
                  <div className={fileActionsClass}>
                    {item.state === "track" ? (
                      <Button
                        variant="quiet"
                        className="col-span-3 col-start-1 row-start-1 justify-self-end"
                        onClick={() => {
                          close();
                          fileQueue.chooseTrack(item.id);
                        }}
                      >
                        Choose Track…
                      </Button>
                    ) : null}
                    <div className="col-start-1 row-start-1">
                      {item.state === "error" ? (
                        <FileStatusIcon label="Failed" icon={CircleAlert} />
                      ) : null}
                    </div>
                    <div className="col-start-3 row-start-1 flex items-center">
                      {item.state === "queued" || item.state === "probed" ? (
                        <FileStatusIcon label="Queued" icon={Clock} />
                      ) : null}
                      {item.state === "working" ? (
                        <ManagementIconAction
                          label={"stop " + item.fileName}
                          tip="Stop"
                          icon={<Square className={actionSize} />}
                          onClick={() => fileQueue.stopCurrent()?.catch(() => {})}
                        />
                      ) : null}
                      {["error", "canceled", "paused"].includes(item.state) ? (
                        <ManagementIconAction
                          label={retryLabel.toLowerCase() + " " + item.fileName}
                          tip={item.state === "error" ? retryLabel : `Canceled · ${retryLabel}`}
                          icon={<RefreshCw className={actionSize} />}
                          onClick={() => fileQueue.retry(item.id)}
                        />
                      ) : null}
                    </div>
                    <div className="col-start-4 row-start-1 flex items-center">
                      {item.state !== "working" ? (
                        <ManagementIconAction
                          label={"remove " + item.fileName}
                          tip="Remove"
                          icon={<Trash2 className={actionSize} />}
                          onClick={() => fileQueue.remove(item.id)}
                        />
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
          </div>
          <footer className="flex shrink-0 flex-wrap justify-end gap-1 border-t border-border pt-1">
            {fileQueue?.active || fileQueue?.canResume ? (
              <Button
                variant="ghost"
                onClick={() => {
                  if (!fileQueue.active) {
                    fileQueue.resumeBatch();
                    return;
                  }
                  close();
                  setConfirmCancelBatch(true);
                }}
              >
                {fileQueue.active ? "Cancel Batch…" : "Resume Batch"}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              onClick={() => {
                close();
                setConfirmClear(true);
              }}
            >
              Clear All Files…
            </Button>
            {onExportStatistics && (
              <Button
                variant="ghost"
                disabled={!fileSessions.some(getSuccessfulFileSession)}
                onClick={() => {
                  close();
                  onExportStatistics();
                }}
              >
                Export Statistics…
              </Button>
            )}
          </footer>
        </PopoverContent>
      </Popover>
      <ConfirmDialog
        open={confirmClear}
        onOpenChange={(open) => {
          setConfirmClear(open);
          if (!open) navigation.rootProps.onOpenChange(true);
        }}
        title="Clear All Files?"
        description="All files and analysis results will be removed from the Files list. Audio files on disk will be kept."
        confirmLabel="Clear All Files"
        onConfirm={() => {
          close();
          onClearAllFiles?.();
        }}
      />
      <ConfirmDialog
        open={confirmCancelBatch}
        onOpenChange={(open) => {
          setConfirmCancelBatch(open);
          if (!open) navigation.rootProps.onOpenChange(true);
        }}
        title="Cancel Batch?"
        description="The current batch analysis and queued files will be canceled. Completed results and files waiting for track selection will be kept."
        confirmLabel="Cancel Batch"
        cancelLabel="Keep Analyzing"
        onConfirm={() => fileQueue?.cancelBatch()?.catch(() => {})}
      />
    </>
  );
}
