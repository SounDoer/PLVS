/** Timer-only transport module. Capture controls remain in the accessory header. */
export function DockTransport({ controls }) {
  const state = controls?.sourceTransportState;
  if (!state) return null;
  const timer = state.statusLabel === "Ready" ? "00:00" : state.statusLabel;
  return (
    <div className="flex h-full min-w-20 items-center justify-center px-3">
      <span
        data-testid="dock-transport-timer"
        className="font-[family-name:var(--ui-font-mono)] text-sm font-semibold tabular-nums text-foreground"
      >
        {timer}
      </span>
    </div>
  );
}
