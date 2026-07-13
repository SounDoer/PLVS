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

export function DockHeader({ state, onAction, onPointer }) {
  const isWindows = /Win/i.test(navigator.platform || navigator.userAgent || "");
  if (!state) return null;
  return (
    <div
      data-testid="dock-header"
      onPointerEnter={() => onPointer(true)}
      onPointerLeave={() => onPointer(false)}
      className="flex h-[44px] w-screen select-none items-center gap-2 border-y border-border/60 bg-background/90 px-2 text-foreground backdrop-blur-sm"
    >
      <SourceTransportCluster
        state={state.sourceTransportState}
        sourceMode="live"
        sourceLocked
        onSourceModeChange={() => {}}
        onPrimaryAction={() => onAction("source-primary")}
      />
      {state.notice ? (
        <span
          title={state.notice.text}
          className="min-w-0 flex-1 truncate text-[length:var(--ui-fs-status)] text-muted-foreground"
        >
          {state.notice.text}
        </span>
      ) : (
        <div className="flex-1" />
      )}
      <IconButton
        icon={<Trash2 className="size-3.5" />}
        tip="Clear"
        disabled={state.clearDisabled}
        onClick={() => onAction("clear")}
      />
      <IconButton
        icon={<LayoutGrid className="size-3.5" />}
        tip="Edit modules"
        onClick={() => onAction("open-editor", { view: "modules" })}
      />
      <IconButton
        icon={<Bookmark className="size-3.5" />}
        tip="Presets"
        onClick={() => onAction("open-editor", { view: "presets" })}
      />
      {isWindows ? (
        <IconButton
          icon={<PanelTop className="size-3.5" />}
          tip={state.reserveSpace ? "Stop reserving screen space" : "Reserve screen space"}
          aria-pressed={state.reserveSpace}
          onClick={() => onAction("set-reserve-space", { enabled: !state.reserveSpace })}
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
        onClick={() => onAction("set-edge", { edge: state.edge === "top" ? "bottom" : "top" })}
      />
      <IconButton
        icon={<PictureInPicture2 className="size-3.5" />}
        tip="Restore window"
        onClick={() => onAction("restore-window")}
      />
    </div>
  );
}
