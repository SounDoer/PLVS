import {
  ArrowDownToLine,
  ArrowUpToLine,
  Bookmark,
  Gauge,
  LayoutGrid,
  PanelTop,
  PanelTopDashed,
  PictureInPicture2,
  Trash2,
} from "lucide-react";
import { IconButton } from "../../components/IconButton.jsx";
import { SourceTransportCluster } from "../../components/SourceTransportCluster.jsx";
import { HoverTip } from "../../components/HoverTip.jsx";
import { cn } from "../../lib/utils.js";

/** @param {{ state: any, onAction: any, onPointer?: any }} props */
export function DockHeader({ state, onAction, onPointer }) {
  const isWindows = /Win/i.test(navigator.platform || navigator.userAgent || "");
  if (!state) return null;
  const toolTipProps = /** @type {const} */ ({ tipSide: "left", tipAlign: "center" });
  const toggleEditor = (view, event) => {
    const actionType = state.editorView === view ? "close-editor" : "open-editor";
    if (actionType === "close-editor") onAction(actionType);
    else {
      const rect = event.currentTarget.getBoundingClientRect();
      onAction(actionType, { view, anchorX: rect.left + rect.width / 2 });
    }
  };
  return (
    <div
      data-testid="dock-header"
      data-visual-capture-surface="dockHeader"
      data-visual-capture-ready="true"
      onPointerEnter={() => onPointer(true)}
      onPointerLeave={() => onPointer(false)}
      className="flex h-[44px] w-screen select-none items-center justify-center border-y border-border bg-background px-2 text-foreground"
    >
      <div
        data-testid="dock-header-controls"
        className="flex min-w-0 max-w-full items-center gap-2"
      >
        <SourceTransportCluster
          state={state.sourceTransportState}
          sourceMode="live"
          sourceLocked
          onSourceModeChange={() => {}}
          onPrimaryAction={(actionKind) => onAction("source-primary", { actionKind })}
        />
        {state.notice ? (
          <HoverTip
            tip={state.notice.details ?? state.notice.text}
            side="left"
            align="center"
            className="min-w-0 max-w-[40vw]"
            tipClassName="w-max max-w-[calc(100vw-1rem)] overflow-hidden text-ellipsis whitespace-nowrap"
          >
            <span
              className={cn(
                "block truncate text-[length:var(--ui-fs-status)] font-medium",
                state.notice.kind === "error"
                  ? "text-[color:var(--ui-feedback-danger)]"
                  : "text-muted-foreground"
              )}
            >
              {state.notice.text}
            </span>
          </HoverTip>
        ) : null}
        <IconButton
          icon={<Trash2 className="size-3.5" />}
          tip="Clear"
          {...toolTipProps}
          disabled={state.clearDisabled}
          onClick={() => onAction("clear")}
        />
        <IconButton
          icon={<Gauge className="size-3.5" />}
          tip="Loudness Profile"
          {...toolTipProps}
          aria-pressed={state.editorView === "loudness-profile"}
          className={cn(
            state.editorView === "loudness-profile" ? "bg-ui-hover text-foreground" : undefined
          )}
          onClick={(event) => toggleEditor("loudness-profile", event)}
        />
        <IconButton
          icon={<LayoutGrid className="size-3.5" />}
          tip="Edit modules"
          {...toolTipProps}
          aria-pressed={state.editorView === "modules"}
          className={state.editorView === "modules" ? "bg-ui-hover text-foreground" : undefined}
          onClick={(event) => toggleEditor("modules", event)}
        />
        {isWindows ? (
          <IconButton
            icon={
              state.reserveSpace ? (
                <PanelTop className="size-3.5" />
              ) : (
                <PanelTopDashed className="size-3.5" />
              )
            }
            tip={state.reserveSpace ? "Stop reserving screen space" : "Reserve screen space"}
            {...toolTipProps}
            aria-pressed={state.reserveSpace}
            onClick={() => onAction("toggle-reserve-space")}
          />
        ) : null}
        <IconButton
          icon={
            state.edge === "top" ? (
              <ArrowDownToLine className="size-3.5" />
            ) : (
              <ArrowUpToLine className="size-3.5" />
            )
          }
          tip={state.edge === "top" ? "Dock to bottom" : "Dock to top"}
          {...toolTipProps}
          onClick={() => onAction("set-edge", { edge: state.edge === "top" ? "bottom" : "top" })}
        />
        <IconButton
          icon={<PictureInPicture2 className="size-3.5" />}
          tip="Restore window"
          {...toolTipProps}
          onClick={() => onAction("restore-window")}
        />
        <IconButton
          icon={<Bookmark className="size-3.5" />}
          tip="Presets"
          {...toolTipProps}
          aria-pressed={state.editorView === "presets"}
          className={cn(state.editorView === "presets" ? "bg-ui-hover text-foreground" : undefined)}
          onClick={(event) => toggleEditor("presets", event)}
        />
      </div>
    </div>
  );
}
