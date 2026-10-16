import { Download, Check, LoaderCircle, PanelTop } from "lucide-react";
import { IconButton } from "../components/IconButton.jsx";
import { SourceTransportCluster } from "../components/SourceTransportCluster.jsx";
import { DockToolbarToggle } from "./DockToolbarToggle.jsx";

/** @param {{ edge: string, toolbarOpen: boolean, onToolbarToggle?: () => void,
 * onRestore?: () => void, transport?: any, onTransport?: (action: string) => void,
 * update?: { phase: string, label: string } | null, onUpdate?: () => void }} props */
export function DockControlArea({
  edge,
  toolbarOpen,
  onToolbarToggle,
  onRestore,
  transport,
  onTransport,
  update = null,
  onUpdate,
}) {
  const UpdateIcon =
    update?.phase === "ready" ? Check : update?.phase === "downloading" ? LoaderCircle : Download;
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
      <DockToolbarToggle edge={edge} open={toolbarOpen} onToggle={onToolbarToggle} compact />
      <IconButton
        icon={<PanelTop className="size-4" />}
        tip="Return to Normal Window"
        aria-label="return to normal window"
        tipSide="left"
        className="dock-control-button"
        onClick={onRestore}
      />
      {update ? (
        <IconButton
          icon={<UpdateIcon className="size-4" />}
          tip={update.label}
          aria-label={update.label.toLowerCase()}
          tipSide="left"
          className="dock-control-button text-primary"
          onClick={onUpdate}
        />
      ) : null}
    </div>
  );
}
