import { SourceTransportCluster } from "../../components/SourceTransportCluster.jsx";

/** Always-visible transport pill (opt-in module); dock is live-only. */
export function DockTransport({ controls }) {
  if (!controls?.sourceTransportState) return null;
  return (
    <div className="flex h-full items-center px-2">
      <SourceTransportCluster
        state={controls.sourceTransportState}
        sourceMode="live"
        sourceLocked
        onSourceModeChange={() => {}}
        onPrimaryAction={controls.onSourceTransportAction}
      />
    </div>
  );
}
