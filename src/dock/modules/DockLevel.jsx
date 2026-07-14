import { LOUDNESS_DB_MAX, LOUDNESS_DB_MIN, PEAK_DB_MAX, PEAK_DB_MIN } from "../../config/scales.js";
import {
  useLevelMeterPlaybackMax,
  useLevelMeterPlaybackMaxChannels,
} from "../../hooks/useLevelMeterPlaybackMax.js";
import { fmtMetric } from "../../math/formatMath.js";
import { getPeakChannels } from "../../math/peakChannelMath.js";
import { useFrameData } from "../../workspace/AudioDataContext.jsx";

const CLIP_DB = -0.1;
const MODE_META = {
  peak: { field: "peakDb", label: "PK", min: PEAK_DB_MIN, max: PEAK_DB_MAX },
  rms: { field: "rmsDb", label: "RMS", min: PEAK_DB_MIN, max: PEAK_DB_MAX },
  momentary: { field: "momentary", label: "M", min: LOUDNESS_DB_MIN, max: LOUDNESS_DB_MAX },
  shortTerm: { field: "shortTerm", label: "ST", min: LOUDNESS_DB_MIN, max: LOUDNESS_DB_MAX },
};

function widthPct(value, min, max) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, (value - min) / (max - min))) * 100;
}

function maxFinite(values) {
  const finiteValues = values.filter(Number.isFinite);
  return finiteValues.length > 0 ? Math.max(...finiteValues) : -Infinity;
}

function MeterFill({ value, min, max, peakFamily }) {
  return (
    <div
      data-testid="dock-level-bar"
      className="h-[clamp(4px,8vh,10px)] w-full overflow-hidden rounded-sm bg-muted/40"
    >
      <div
        className="h-full rounded-sm"
        style={{
          width: `${widthPct(value, min, max)}%`,
          background:
            peakFamily && value >= CLIP_DB
              ? "var(--ui-signal-bad)"
              : "linear-gradient(to right, var(--ui-signal-good), var(--ui-signal-warn))",
        }}
      />
    </div>
  );
}

function Readout({ value, label, onReset }) {
  const content = (
    <>
      <span className="text-[clamp(10px,10vh,15px)] leading-none text-foreground">
        {fmtMetric(value)}
      </span>
      <span className="text-[8px] uppercase text-muted-foreground">{label}</span>
    </>
  );

  const className =
    "flex shrink-0 items-baseline gap-1 font-[family-name:var(--ui-font-mono)] tabular-nums";
  return onReset ? (
    <button
      type="button"
      className={`${className} rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary`}
      onClick={onReset}
      aria-label="Reset true peak maximum"
      title="Reset TP Max"
    >
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  );
}

/** Compact Peak/RMS/Loudness meter for the Dock strip. */
export function DockLevel({ controls = {} }) {
  const { displayAudio, peakLabelContext, hasTpMaxValue, onResetTpMax } = useFrameData();
  const mode = MODE_META[controls.mode] ? controls.mode : "peak";
  const meta = MODE_META[mode];
  const peakFamily = mode === "peak" || mode === "rms";
  const readout = controls.readout ?? "live";

  const measuredChannels = peakFamily
    ? getPeakChannels(displayAudio, peakLabelContext, meta.field)
    : [];
  const channels =
    peakFamily && measuredChannels.length === 0
      ? [
          { label: "L", valueDb: -Infinity },
          { label: "R", valueDb: -Infinity },
        ]
      : measuredChannels;
  const channelValues = channels.map(({ valueDb }) => valueDb);
  const scalarValue = Number.isFinite(displayAudio?.[meta.field])
    ? displayAudio[meta.field]
    : -Infinity;

  const scalarPlaybackMax = useLevelMeterPlaybackMax({
    enabled: !peakFamily && readout === "playbackMax",
    mode,
    value: scalarValue,
    displayAudio,
  });
  const channelPlaybackMax = useLevelMeterPlaybackMaxChannels({
    enabled: mode === "rms" && readout === "playbackMax",
    mode,
    values: channelValues,
  });

  let readoutValue = peakFamily ? maxFinite(channelValues) : scalarValue;
  let readoutLabel = meta.label;
  let resetReadout;
  if (mode === "peak" && readout === "truePeakMax") {
    readoutValue = hasTpMaxValue ? displayAudio?.tpMax : -Infinity;
    readoutLabel = "TP";
    resetReadout = hasTpMaxValue && typeof onResetTpMax === "function" ? onResetTpMax : undefined;
  } else if (mode === "rms" && readout === "playbackMax") {
    readoutValue = maxFinite(channelPlaybackMax);
    readoutLabel = "MAX";
  } else if (!peakFamily && readout === "playbackMax") {
    readoutValue = scalarPlaybackMax;
    readoutLabel = `${meta.label} MAX`;
  }

  return (
    <div className="@container flex h-full min-w-0 items-center gap-[clamp(6px,3cqw,12px)] px-2">
      <div className="flex min-w-12 flex-1 flex-col justify-center gap-[clamp(3px,4vh,7px)]">
        {peakFamily ? (
          channels.map(({ label, valueDb }, index) => (
            <div key={`${label}-${index}`} className="flex min-w-0 items-center gap-1.5">
              {controls.showLabels !== false ? (
                <span className="w-[3ch] shrink-0 truncate text-right font-[family-name:var(--ui-font-mono)] text-[9px] leading-none text-muted-foreground @max-[155px]:hidden">
                  {label}
                </span>
              ) : null}
              <MeterFill value={valueDb} min={meta.min} max={meta.max} peakFamily />
            </div>
          ))
        ) : (
          <div className="flex min-w-0 items-center gap-1.5">
            {controls.showLabels !== false ? (
              <span className="w-[3ch] shrink-0 text-right font-[family-name:var(--ui-font-mono)] text-[9px] leading-none text-muted-foreground @max-[130px]:hidden">
                {meta.label}
              </span>
            ) : null}
            <MeterFill value={scalarValue} min={meta.min} max={meta.max} peakFamily={false} />
          </div>
        )}
      </div>
      <Readout value={readoutValue} label={readoutLabel} onReset={resetReadout} />
    </div>
  );
}
