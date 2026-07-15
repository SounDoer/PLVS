import {
  ArrowDownToLine,
  ArrowUpToLine,
  Bookmark,
  LayoutGrid,
  PanelTop,
  PictureInPicture2,
  Trash2,
} from "lucide-react";
import { IconButton } from "../../components/IconButton.jsx";
import { SourceTransportCluster } from "../../components/SourceTransportCluster.jsx";
import { cn } from "../../lib/utils.js";

export function DockHeader({ state, onAction, onPointer }) {
  const isWindows = /Win/i.test(navigator.platform || navigator.userAgent || "");
  if (!state) return null;
  const toolTipProps = { tipSide: "left", tipAlign: "center" };
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
      onPointerEnter={() => onPointer(true)}
      onPointerLeave={() => onPointer(false)}
      className="flex h-[44px] w-screen select-none items-center justify-center border-y border-border/60 bg-background/90 px-2 text-foreground backdrop-blur-sm"
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
          <span
            title={state.notice.details ?? state.notice.text}
            className={cn(
              "min-w-0 max-w-[40vw] truncate text-[length:var(--ui-fs-status)] font-medium",
              state.notice.kind === "error"
                ? "text-[color:var(--ui-signal-bad)]"
                : "text-muted-foreground"
            )}
          >
            {state.notice.text}
          </span>
        ) : null}
        <IconButton
          icon={<Trash2 className="size-3.5" />}
          tip="Clear"
          {...toolTipProps}
          disabled={state.clearDisabled}
          onClick={() => onAction("clear")}
        />
        <IconButton
          icon={<LayoutGrid className="size-3.5" />}
          tip="Edit modules"
          {...toolTipProps}
          aria-pressed={state.editorView === "modules"}
          className={
            state.editorView === "modules" ? "bg-accent text-accent-foreground" : undefined
          }
          onClick={(event) => toggleEditor("modules", event)}
        />
        {isWindows ? (
          <IconButton
            icon={<PanelTop className="size-3.5" />}
            tip={state.reserveSpace ? "Stop reserving screen space" : "Reserve screen space"}
            {...toolTipProps}
            aria-pressed={state.reserveSpace}
            onClick={() => onAction("toggle-reserve-space")}
            className={state.reserveSpace ? "bg-accent text-accent-foreground" : undefined}
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
          className={
            state.editorView === "presets" ? "bg-accent text-accent-foreground" : undefined
          }
          onClick={(event) => toggleEditor("presets", event)}
        />
      </div>
    </div>
  );
}
