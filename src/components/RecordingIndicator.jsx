import { LAYER_INDICATOR } from "./ui/layers.js";

export function RecordingIndicator({ state }) {
  if (!state || state === "completed" || state === "failed") return null;
  return (
    <div
      role="status"
      aria-label="visual recording active"
      title={state === "stopping" ? "Finalizing Recording" : "Recording"}
      className={`pointer-events-none fixed right-1 top-1 ${LAYER_INDICATOR} h-2 w-2 rounded-full bg-[color:var(--ui-activity-live)] shadow-[0_0_0_2px_color-mix(in_srgb,var(--background)_75%,transparent)]`}
      data-recording-state={state}
    />
  );
}
