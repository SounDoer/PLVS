import { useFrameData } from "../../workspace/AudioDataContext.jsx";

const MIN_DB = -60;
const CLIP_DB = -0.1;

function widthPct(db) {
  if (!Number.isFinite(db)) return 0;
  return Math.max(0, Math.min(1, (db - MIN_DB) / -MIN_DB)) * 100;
}

/** Per-channel horizontal peak bars + true-peak max readout. */
export function DockLevel() {
  const { displayAudio, hasTpMaxValue } = useFrameData();
  const peaks = Array.isArray(displayAudio?.peakDb) ? displayAudio.peakDb : [];
  const channels = peaks.length > 0 ? peaks : [-Infinity, -Infinity];
  return (
    <div className="flex h-full min-w-0 items-center gap-2 px-2">
      <div className="flex min-w-24 flex-1 flex-col justify-center gap-[3px]">
        {channels.map((db, i) => (
          <div
            key={i}
            data-testid="dock-level-bar"
            className="h-[4px] w-full overflow-hidden rounded-sm bg-muted/40"
          >
            <div
              className="h-full rounded-sm"
              style={{
                width: `${widthPct(db)}%`,
                background:
                  db >= CLIP_DB
                    ? "var(--ui-signal-bad)"
                    : "linear-gradient(to right, var(--ui-signal-good), var(--ui-signal-warn))",
              }}
            />
          </div>
        ))}
      </div>
      <span className="shrink-0 font-[family-name:var(--ui-font-mono)] text-[10px] tabular-nums text-muted-foreground">
        {hasTpMaxValue && Number.isFinite(displayAudio?.tpMax)
          ? displayAudio.tpMax.toFixed(1)
          : "-"}
        <span className="ml-0.5 text-[8px] uppercase">tp</span>
      </span>
    </div>
  );
}
