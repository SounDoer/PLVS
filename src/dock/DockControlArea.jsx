import { Maximize2 } from "lucide-react";
import { IconButton } from "../components/IconButton.jsx";
import { SourceTransportCluster } from "../components/SourceTransportCluster.jsx";
import { DockToolbarToggle } from "./DockToolbarToggle.jsx";

/** @param {{ edge: string, toolbarOpen: boolean, onToolbarToggle?: () => void,
 * onRestore?: () => void, transport?: any, onTransport?: (action: string) => void,
 * update?: { phase: string, label: string } | null }} props */
export function DockControlArea({
  edge,
  toolbarOpen,
  onToolbarToggle,
  onRestore,
  transport,
  onTransport,
  update = null,
}) {
  return (
    <div className="dock-control-area" data-testid="dock-control-area">
      {transport ? (
        <SourceTransportCluster
          state={transport}
          sourceMode="live"
          sourceLocked
          presentation="dock"
          onSourceModeChange={() => {}}
          onPrimaryAction={onTransport ?? (() => {})}
        />
      ) : null}
      <DockToolbarToggle
        edge={edge}
        open={toolbarOpen}
        onToggle={onToolbarToggle}
        update={update}
      />
      <IconButton
        icon={<Maximize2 className="size-3.5" absoluteStrokeWidth strokeWidth={1.75} />}
        tip="Return to Normal Window"
        aria-label="return to normal window"
        tipSide="left"
        className="dock-control-button"
        onClick={onRestore}
      />
    </div>
  );
}
