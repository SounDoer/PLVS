import { Fragment } from "react";
import { LOUDNESS_DB_MAX, LOUDNESS_DB_MIN, PEAK_DB_MAX, PEAK_DB_MIN } from "../../config/scales.js";
import {
  useLevelMeterPlaybackMax,
  useLevelMeterPlaybackMaxChannels,
} from "../../hooks/useLevelMeterPlaybackMax.js";
import { fmtMetric } from "../../math/formatMath.js";
import { getPeakChannels } from "../../math/peakChannelMath.js";
import { useFrameData } from "../../workspace/AudioDataContext.jsx";
import { DockExpandedMetric } from "./DockExpandedMetric.jsx";

const CLIP_DB = -0.1;
const MODE_META = {
  peak: { field: "peakDb", label: "PK", unit: "dBFS", min: PEAK_DB_MIN, max: PEAK_DB_MAX },
  rms: { field: "rmsDb", label: "RMS", unit: "dBFS", min: PEAK_DB_MIN, max: PEAK_DB_MAX },
  momentary: {
    field: "momentary",
    label: "M",
    unit: "LUFS",
    min: LOUDNESS_DB_MIN,
    max: LOUDNESS_DB_MAX,
  },
  shortTerm: {
    field: "shortTerm",
    label: "ST",
    unit: "LUFS",
    min: LOUDNESS_DB_MIN,
    max: LOUDNESS_DB_MAX,
  },
};

function widthPct(value, min, max) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, (value - min) / (max - min))) * 100;
}

function MeterFill({ value, min, max, peakFamily, style }) {
  return (
    <div
      data-testid="dock-level-bar"
      className="h-full min-h-[var(--ui-dock-bar-min-h)] w-full overflow-hidden rounded-sm bg-muted/40"
      style={style}
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

function ChannelReadout({ value, style }) {
  return (
    <span
      data-testid="dock-level-channel-readout"
      className="justify-self-end whitespace-nowrap text-right font-[family-name:var(--ui-font-mono)] text-[length:var(--ui-dock-fs-value)] font-semibold leading-none tabular-nums text-foreground"
      style={style}
    >
      {fmtMetric(value)}
    </span>
  );
}

function GlobalReadout({ value, onReset, style, expanded, label, unit }) {
  const content = expanded ? (
    <DockExpandedMetric label={label} value={fmtMetric(value)} unit={unit} />
  ) : (
    <span className="text-[length:var(--ui-dock-fs-value)] leading-none text-foreground">
      {fmtMetric(value)}
    </span>
  );
  const className =
    "justify-self-end whitespace-nowrap text-right font-[family-name:var(--ui-font-mono)] font-semibold tabular-nums";
  return onReset ? (
    <button
      type="button"
      className={`${className} rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary`}
      style={style}
      onClick={onReset}
      aria-label="Reset true peak maximum"
      title="Reset TP Max"
    >
      {content}
    </button>
  ) : (
    <div className={className} style={style}>
      {content}
    </div>
  );
}

function ReadoutRegion({
  source,
  sourceTitle,
  values,
  globalValue,
  onReset,
  rowCount,
  showGlobal,
  expanded,
  expandedLabel,
  unit,
}) {
  const rows = Math.max(1, rowCount);
  return (
    <div
      data-testid="dock-level-readout-region"
      className="grid shrink-0 self-stretch"
      style={{ gridTemplateAreas: '"readout"' }}
    >
      <div
        data-testid="dock-level-readout-sizer"
        aria-hidden="true"
        className="invisible flex items-center"
        style={{ gap: "var(--ui-dock-gap-column)", gridArea: "readout" }}
      >
        {source && !expanded ? (
          <span className="whitespace-nowrap font-[family-name:var(--ui-font-sans)] text-[length:var(--ui-dock-fs-caption)] font-medium leading-none">
            {source}
          </span>
        ) : null}
        <span className="block w-[var(--ui-dock-readout-w)] font-[family-name:var(--ui-font-mono)] text-[length:var(--ui-dock-fs-value)]" />
      </div>
      <div
        data-testid="dock-level-readout-content"
        className={`flex min-h-0 justify-self-end ${showGlobal ? "self-center items-baseline" : ""}`}
        style={{ gap: "var(--ui-dock-gap-column)", gridArea: "readout" }}
      >
        {source && !expanded ? (
          <abbr
            data-testid="dock-level-readout-source"
            className={`${showGlobal ? "" : "self-center"} whitespace-nowrap font-[family-name:var(--ui-font-sans)] text-[length:var(--ui-dock-fs-caption)] font-medium leading-none text-muted-foreground no-underline`}
            aria-label={sourceTitle}
            title={sourceTitle}
          >
            {source}
          </abbr>
        ) : null}
        {showGlobal ? (
          <GlobalReadout
            value={globalValue}
            onReset={onReset}
            expanded={expanded}
            label={expandedLabel}
            unit={unit}
          />
        ) : (
          <div
            className="grid h-full min-h-0 w-max items-center"
            style={{
              gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
              rowGap: "var(--ui-dock-gap-row)",
            }}
          >
            {values.map((value, index) => (
              <ChannelReadout key={index} value={value} style={{ gridRow: index + 1 }} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Compact Peak/RMS/Loudness meter for the Dock strip. */
export function DockLevel({ controls = {}, heightMode = "standard" }) {
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

  const channelReadoutValues =
    mode === "rms" && readout === "playbackMax" ? channelPlaybackMax : channelValues;
  let globalValue = scalarValue;
  let resetReadout;
  if (mode === "peak" && readout === "truePeakMax") {
    globalValue = hasTpMaxValue ? displayAudio?.tpMax : -Infinity;
    resetReadout = hasTpMaxValue && typeof onResetTpMax === "function" ? onResetTpMax : undefined;
  } else if (!peakFamily && readout === "playbackMax") {
    globalValue = scalarPlaybackMax;
  }

  const showGlobalReadout = !peakFamily || (mode === "peak" && readout === "truePeakMax");
  const readoutSource =
    mode === "peak" && readout === "truePeakMax"
      ? "TP Max"
      : readout === "playbackMax"
        ? "PB Max"
        : null;
  const readoutSourceTitle =
    mode === "peak" && readout === "truePeakMax"
      ? "True Peak Max"
      : readout === "playbackMax"
        ? "Playback Max"
        : null;
  const showLabels = controls.showLabels !== false;
  const expanded = heightMode === "expanded";
  const expandedReadoutLabel = readoutSource ?? meta.label;
  const readoutUnit = mode === "peak" && readout === "truePeakMax" ? "dBTP" : meta.unit;
  const rows = peakFamily ? Math.max(1, channels.length) : 1;
  const meterColumns = peakFamily && showLabels ? "max-content minmax(0, 1fr)" : "minmax(0, 1fr)";
  const barColumn = peakFamily && showLabels ? 2 : 1;

  return (
    <div
      className="flex h-full min-w-0 items-stretch"
      style={{
        gap: "var(--ui-dock-gap-region)",
        padding: "var(--ui-dock-pad-y) var(--ui-dock-pad-x)",
      }}
    >
      {showLabels ? (
        <span className="self-center font-[family-name:var(--ui-font-sans)] text-[length:var(--ui-dock-fs-label)] font-medium leading-none text-muted-foreground">
          {meta.label}
        </span>
      ) : null}
      <div
        className="flex min-h-0 min-w-12 flex-1 items-stretch"
        style={{ gap: "var(--ui-dock-gap-column)" }}
      >
        <div
          data-testid="dock-level-meter-region"
          className="grid min-h-0 min-w-0 flex-1 items-stretch"
          style={{
            gridTemplateColumns: meterColumns,
            gridTemplateRows: `repeat(${rows}, minmax(var(--ui-dock-bar-min-h), 1fr))`,
            columnGap: peakFamily && showLabels ? "var(--ui-dock-gap-column)" : 0,
            rowGap: peakFamily ? "var(--ui-dock-gap-row)" : 0,
          }}
        >
          {peakFamily ? (
            channels.map(({ label, valueDb }, index) => {
              const row = index + 1;
              return (
                <Fragment key={`${label}-${index}`}>
                  {showLabels ? (
                    <span
                      className="self-center font-[family-name:var(--ui-font-sans)] text-[length:var(--ui-dock-fs-label)] font-medium leading-none text-muted-foreground"
                      style={{ gridColumn: 1, gridRow: row }}
                    >
                      {label}
                    </span>
                  ) : null}
                  <MeterFill
                    value={valueDb}
                    min={meta.min}
                    max={meta.max}
                    peakFamily
                    style={{ gridColumn: barColumn, gridRow: row }}
                  />
                </Fragment>
              );
            })
          ) : (
            <MeterFill value={scalarValue} min={meta.min} max={meta.max} peakFamily={false} />
          )}
        </div>
        <ReadoutRegion
          source={readoutSource}
          sourceTitle={readoutSourceTitle}
          values={channelReadoutValues}
          globalValue={globalValue}
          onReset={resetReadout}
          rowCount={rows}
          showGlobal={showGlobalReadout}
          expanded={expanded && showGlobalReadout}
          expandedLabel={expandedReadoutLabel}
          unit={readoutUnit}
        />
      </div>
    </div>
  );
}
