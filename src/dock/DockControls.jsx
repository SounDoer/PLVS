import {
  ArrowDownToLine,
  ArrowUpToLine,
  Bookmark,
  LayoutGrid,
  PanelTop,
  PictureInPicture2,
  Trash2,
} from "lucide-react";
import { IconButton } from "../components/IconButton.jsx";
import { SourceTransportCluster } from "../components/SourceTransportCluster.jsx";

/**
 * Hover-revealed control overlay. Settings is intentionally absent (the
 * settings dialog cannot fit in the strip); configure in normal mode.
 */
export function DockControls({
  sourceTransportState,
  onSourceTransportAction,
  onClear,
  clearDisabled,
  dockEdge,
  onDockEdgeChange,
  onExitDock,
  notice,
  onEditModules,
  onEditPresets,
  reserveSpace = false,
  onReserveSpaceChange,
}) {
  const isWindows = /Win/i.test(navigator.platform || navigator.userAgent || "");
  return (
    <div className="absolute inset-0 z-20 flex items-center gap-2 bg-background/80 px-2 backdrop-blur-sm">
      <SourceTransportCluster
        state={sourceTransportState}
        sourceMode="live"
        sourceLocked
        onSourceModeChange={() => {}}
        onPrimaryAction={onSourceTransportAction}
      />
      {notice ? (
        <span
          title={notice.text}
          className="min-w-0 flex-1 truncate text-[length:var(--ui-fs-status)] text-muted-foreground"
        >
          {notice.text}
        </span>
      ) : (
        <div className="flex-1" />
      )}
      <IconButton
        icon={<Trash2 className="size-3.5" />}
        tip="Clear"
        disabled={clearDisabled}
        onClick={onClear}
      />
      <IconButton
        icon={<LayoutGrid className="size-3.5" />}
        tip="Edit modules"
        onClick={onEditModules}
      />
      <IconButton icon={<Bookmark className="size-3.5" />} tip="Presets" onClick={onEditPresets} />
      {isWindows ? (
        <IconButton
          icon={<PanelTop className="size-3.5" />}
          tip={reserveSpace ? "Stop reserving screen space" : "Reserve screen space"}
          aria-pressed={reserveSpace}
          onClick={() => onReserveSpaceChange?.(!reserveSpace)}
          className={reserveSpace ? "bg-accent text-accent-foreground" : undefined}
        />
      ) : null}
      <IconButton
        icon={
          dockEdge === "top" ? (
            <ArrowDownToLine className="size-3.5" />
          ) : (
            <ArrowUpToLine className="size-3.5" />
          )
        }
        tip={dockEdge === "top" ? "Dock to bottom" : "Dock to top"}
        onClick={() => onDockEdgeChange(dockEdge === "top" ? "bottom" : "top")}
      />
      <IconButton
        icon={<PictureInPicture2 className="size-3.5" />}
        tip="Restore window"
        onClick={onExitDock}
      />
    </div>
  );
}
