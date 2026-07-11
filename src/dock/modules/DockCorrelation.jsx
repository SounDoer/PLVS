import { hasCorrelationSignal } from "../../lib/statsCatalog.js";
import { useFrameData } from "../../workspace/AudioDataContext.jsx";

/** -1..+1 correlation bar with a moving marker; vectorscope's dock form. */
export function DockCorrelation() {
  const { correlation, displayAudio } = useFrameData();
  // The DSP emits correlation = 0.0 during silence, which is finite but
  // meaningless; gate on peakDb like Stats / VectorscopePanel do.
  const finite = hasCorrelationSignal(displayAudio) && Number.isFinite(correlation);
  const clamped = finite ? Math.max(-1, Math.min(1, correlation)) : 0;
  const leftPct = ((clamped + 1) / 2) * 100;
  return (
    <div className="flex h-full min-w-0 items-center gap-2 px-2">
      <span className="shrink-0 text-[8px] font-bold uppercase text-muted-foreground">-1</span>
      <div className="relative h-[4px] w-full min-w-14 flex-1 rounded-sm bg-muted/40">
        <div className="absolute left-1/2 top-[-2px] h-[8px] w-px bg-muted-foreground/40" />
        {finite ? (
          <div
            data-testid="dock-correlation-marker"
            className="absolute top-[-2px] h-[8px] w-[2px] -translate-x-1/2 rounded-sm"
            style={{
              left: `${leftPct}%`,
              // Same tiers as VectorscopePanel's correlationMarkerClass:
              // < 0 bad, < 0.35 warn, otherwise good.
              background:
                clamped < 0
                  ? "var(--ui-signal-bad)"
                  : clamped < 0.35
                    ? "var(--ui-signal-warn)"
                    : "var(--ui-signal-good)",
            }}
          />
        ) : null}
      </div>
      <span className="shrink-0 text-[8px] font-bold uppercase text-muted-foreground">+1</span>
      <span className="w-9 shrink-0 text-right font-[family-name:var(--ui-font-mono)] text-[10px] tabular-nums text-muted-foreground">
        {finite ? `${clamped >= 0 ? "+" : ""}${clamped.toFixed(2)}` : "-"}
      </span>
    </div>
  );
}
