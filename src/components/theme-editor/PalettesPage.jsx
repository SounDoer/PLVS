import { Plus, Trash2 } from "lucide-react";
import { ColorControl } from "../ColorControl.jsx";
import { IconButton } from "../IconButton.jsx";
import { Label } from "../ui/label.jsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select.jsx";
import { listPalettePresets } from "../../theme/palettePresets.js";
import { EDITOR_SELECT_CONTENT_CLASS, EDITOR_SELECT_TRIGGER_CLASS } from "./selectStyles.js";

const STATUS_COLORS = [
  ["good", "Good"],
  ["warning", "Warning"],
  ["critical", "Critical"],
];

const INTERFACE_COLORS = [["critical", "Critical"]];

const FREQUENCY_COLORS = [
  ["low", "Low"],
  ["mid", "Mid"],
  ["high", "High"],
];

function PalettePresetSelect({ kind, value, onApplyPreset }) {
  return (
    <Select
      value={value ?? "custom"}
      onValueChange={(next) => {
        if (next !== "custom") onApplyPreset(kind, next);
      }}
    >
      <SelectTrigger aria-label={`${kind} palette preset`} className={EDITOR_SELECT_TRIGGER_CLASS}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" className={EDITOR_SELECT_CONTENT_CLASS}>
        {/* Only offered while the palette has drifted off every preset: picking
            "Custom" means nothing, it is just what the trigger has to show. */}
        {value == null ? (
          <SelectItem value="custom" disabled>
            Custom
          </SelectItem>
        ) : null}
        {listPalettePresets(kind).map((preset) => (
          <SelectItem key={preset.id} value={preset.id}>
            {preset.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function PaletteStrip({ colors }) {
  return (
    <div
      aria-hidden="true"
      className="h-3 rounded-sm border border-border"
      style={{ background: `linear-gradient(to right, ${colors.join(", ")})` }}
    />
  );
}

function SimplePalette({ title, description, kind, palette, colors, onColor, onApplyPreset }) {
  const presets = listPalettePresets(kind).length > 0;
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label>{title}</Label>
        {presets ? (
          <PalettePresetSelect kind={kind} value={palette.presetId} onApplyPreset={onApplyPreset} />
        ) : null}
      </div>
      <p className="text-[length:var(--ui-fs-metric-meta)] text-muted-foreground">{description}</p>
      <PaletteStrip colors={colors.map(([key]) => palette[key])} />
      <div className="grid grid-cols-3 gap-2">
        {colors.map(([key, label]) => (
          <ColorControl
            key={key}
            label={label}
            value={palette[key]}
            onChange={(color) => onColor(kind, key, color)}
            allowAlpha={false}
          />
        ))}
      </div>
    </section>
  );
}

function addIntensityStop(stops) {
  let insertionIndex = 1;
  let largestGap = -1;
  for (let index = 1; index < stops.length; index += 1) {
    const gap = stops[index].position - stops[index - 1].position;
    if (gap > largestGap) {
      largestGap = gap;
      insertionIndex = index;
    }
  }
  const before = stops[insertionIndex - 1];
  const after = stops[insertionIndex];
  return [
    ...stops.slice(0, insertionIndex),
    { position: (before.position + after.position) / 2, color: before.color },
    ...stops.slice(insertionIndex),
  ];
}

function IntensityPalette({ palette, onStop, onStops, onApplyPreset }) {
  const gradient = palette.stops
    .map((stop) => `${stop.color} ${Math.round(stop.position * 100)}%`)
    .join(", ");

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label>Intensity</Label>
        <div className="flex items-center gap-1">
          <PalettePresetSelect
            kind="intensity"
            value={palette.presetId}
            onApplyPreset={onApplyPreset}
          />
          <IconButton
            aria-label="Add intensity stop"
            tip="Add Stop"
            icon={<Plus className="size-[length:var(--ui-icon-management-action)]" />}
            onClick={() => onStops(addIntensityStop(palette.stops))}
          />
        </div>
      </div>
      <p className="text-[length:var(--ui-fs-metric-meta)] text-muted-foreground">
        Maps quiet-to-strong Spectrogram energy. Positions between stops blend automatically.
      </p>
      <div
        aria-label="Intensity palette preview"
        className="h-5 rounded-sm border border-border"
        style={{ background: `linear-gradient(to right, ${gradient})` }}
      />
      <div className="flex flex-col gap-2">
        {palette.stops.map((stop, index) => {
          const endpoint = index === 0 || index === palette.stops.length - 1;
          const previous = palette.stops[index - 1]?.position ?? 0;
          const next = palette.stops[index + 1]?.position ?? 1;
          return (
            <div key={`${index}-${stop.position}`} className="flex items-center gap-2">
              <ColorControl
                label={`Stop ${index + 1}`}
                value={stop.color}
                onChange={(color) => onStop(index, color)}
                allowAlpha={false}
              />
              <input
                aria-label={`Stop ${index + 1} position`}
                type="range"
                min={endpoint ? stop.position : previous + 0.01}
                max={endpoint ? stop.position : next - 0.01}
                step="0.01"
                value={stop.position}
                disabled={endpoint}
                onChange={(event) =>
                  onStops(
                    palette.stops.map((item, stopIndex) =>
                      stopIndex === index ? { ...item, position: Number(event.target.value) } : item
                    )
                  )
                }
                className="plvs-range min-w-0 flex-1"
              />
              <span className="w-8 text-right text-[length:var(--ui-fs-metric-meta)] text-muted-foreground">
                {Math.round(stop.position * 100)}%
              </span>
              {!endpoint ? (
                <IconButton
                  aria-label={`Remove stop ${index + 1}`}
                  tip="Remove Stop"
                  icon={<Trash2 className="size-[length:var(--ui-icon-management-action)]" />}
                  onClick={() =>
                    onStops(palette.stops.filter((_, itemIndex) => itemIndex !== index))
                  }
                />
              ) : (
                <span className="w-[length:var(--ui-icon-management-action)]" />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function PalettesPage({ draft, onColor, onStop, onStops, onApplyPreset }) {
  return (
    <div className="flex flex-col gap-5">
      <SimplePalette
        title="Status"
        description="Good, warning, and critical meaning across meters and rules."
        kind="status"
        palette={draft.palettes.status}
        colors={STATUS_COLORS}
        onColor={onColor}
        onApplyPreset={onApplyPreset}
      />
      <SimplePalette
        title="Interface"
        description="Destructive controls. Separate from the meters' critical so one can move without the other."
        kind="interface"
        palette={draft.palettes.interface}
        colors={INTERFACE_COLORS}
        onColor={onColor}
        onApplyPreset={onApplyPreset}
      />
      <IntensityPalette
        palette={draft.palettes.intensity}
        onStop={onStop}
        onStops={onStops}
        onApplyPreset={onApplyPreset}
      />
      <SimplePalette
        title="Frequency"
        description="Low, mid, and high spectral regions. Split frequencies stay in panel settings."
        kind="frequency"
        palette={draft.palettes.frequency}
        colors={FREQUENCY_COLORS}
        onColor={onColor}
        onApplyPreset={onApplyPreset}
      />
    </div>
  );
}
