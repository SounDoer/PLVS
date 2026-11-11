import { useEffect, useRef, useState } from "react";
import { Check, Download, FileStack, Play, RefreshCw, Square, Trash2 } from "lucide-react";
import { HoverTip } from "./HoverTip.jsx";
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
          className="p-1"
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
  if (!fileSessions.length) return null;
  const close = () => navigation.rootProps.onOpenChange(false);
  return (
    <Popover {...navigation.rootProps}>
      <HoverTip tip="Files" className="shrink-0">
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            {...navigation.triggerProps}
            aria-label="files"
            className="data-[state=open]:bg-ui-hover"
          >
            <FileStack className="size-[length:var(--ui-icon-shell-action)]" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
      </HoverTip>
      <PopoverContent
        align="start"
        className="w-[var(--ui-surface-compact-w)] p-1"
        aria-label="Files"
      >
        <header className="flex items-center justify-between gap-1 px-2 py-1">
          <p className={POPOVER_TITLE_CLASS}>Files</p>
          <div className="flex shrink-0 items-center gap-1">
            {onExportStatistics ? (
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
            ) : null}
            <ManagementIconAction
              label="clear all files"
              tip="Clear All"
              icon={<Trash2 className={actionSize} />}
              onClick={() => {
                close();
                onClearAllFiles?.();
              }}
              className="hover:text-destructive"
            />
          </div>
        </header>
        <div className="max-h-[min(50dvh,var(--radix-popover-content-available-height))] overflow-auto overscroll-contain">
          {fileSessions.map((session) => {
            const active = session.id === activeFileId;
            const running = session.id === analyzingFileId;
            const successful = Boolean(getSuccessfulFileSession(session));
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
                    if (!active) onSelectFile?.(session.id);
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
                  <span
                    className="min-w-0 flex-1 truncate font-medium text-foreground"
                    title={name}
                  >
                    {name}
                  </span>
                </RowAction>
                <div className="flex shrink-0 items-center gap-1 pr-1">
                  {running ? (
                    <>
                      <span className="text-[length:var(--ui-fs-caption)] tabular-nums text-muted-foreground">
                        {progress}
                      </span>
                      <ManagementIconAction
                        label={"cancel analysis of " + name}
                        tip="Cancel"
                        icon={<Square className={actionSize} />}
                        onClick={() => onStopFile?.(session.id)}
                      />
                    </>
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
                  {successful ? (
                    <ReportMenu
                      session={session}
                      onExportReport={onExportReport}
                      onCopyReport={onCopyReport}
                    />
                  ) : null}
                  <ManagementIconAction
                    label={"remove " + name}
                    tip="Remove"
                    icon={<Trash2 className={actionSize} />}
                    disabled={running}
                    onClick={() => onRemoveFile?.(session.id)}
                    className="hover:text-destructive"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
