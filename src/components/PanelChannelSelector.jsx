import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function ChannelTrigger({ label, ariaLabel }) {
  return (
    <SelectTrigger
      aria-label={ariaLabel}
      className="h-6 min-w-0 max-w-[6rem] rounded-md border-border/70 bg-transparent px-2 py-0 text-[11px] text-muted-foreground shadow-none hover:bg-secondary hover:text-foreground focus:ring-0 focus:ring-offset-0"
    >
      <SelectValue>{label}</SelectValue>
    </SelectTrigger>
  );
}

export function PanelChannelSelector({
  activeTab,
  channelCount = 0,
  vectorscopeOptions = [],
  vectorscopeValueKey = "",
  vectorscopeDisplayLabel = "",
  onVectorscopeChange,
  spectrumOptions = [],
  spectrumValueKey = "",
  spectrumDisplayLabel = "",
  onSpectrumChange,
}) {
  if (!Number.isFinite(channelCount) || channelCount <= 2) return null;

  if (activeTab === "vectorscope" && vectorscopeOptions.length > 0) {
    const matchedVectorscopeOption = vectorscopeOptions.find(
      (opt) => opt.key === vectorscopeValueKey
    );
    const selectedVectorscopeOption = matchedVectorscopeOption ?? vectorscopeOptions[0];
    const selectedVectorscopeLabel =
      matchedVectorscopeOption && vectorscopeDisplayLabel
        ? vectorscopeDisplayLabel
        : selectedVectorscopeOption.label;

    return (
      <Select
        value={selectedVectorscopeOption.key}
        onValueChange={(key) => {
          const opt = vectorscopeOptions.find((o) => o.key === key);
          if (opt && typeof onVectorscopeChange === "function") {
            onVectorscopeChange({ x: opt.x, y: opt.y });
          }
        }}
      >
        <ChannelTrigger label={selectedVectorscopeLabel} ariaLabel="vectorscope channel" />
        <SelectContent align="end" sideOffset={6}>
          {vectorscopeOptions.map((opt) => (
            <SelectItem key={opt.key} value={opt.key}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if ((activeTab === "spectrum" || activeTab === "spectrogram") && spectrumOptions.length > 0) {
    const matchedSpectrumOption = spectrumOptions.find((opt) => opt.key === spectrumValueKey);
    const selectedSpectrumOption = matchedSpectrumOption ?? spectrumOptions[0];
    const selectedSpectrumLabel =
      matchedSpectrumOption && spectrumDisplayLabel
        ? spectrumDisplayLabel
        : selectedSpectrumOption.label;

    return (
      <Select
        value={selectedSpectrumOption.key}
        onValueChange={(key) => {
          const opt = spectrumOptions.find((o) => o.key === key);
          if (opt && typeof onSpectrumChange === "function") {
            onSpectrumChange(opt.sel);
          }
        }}
      >
        <ChannelTrigger label={selectedSpectrumLabel} ariaLabel={`${activeTab} channel`} />
        <SelectContent align="end" sideOffset={6}>
          {spectrumOptions.map((opt) => (
            <SelectItem key={opt.key} value={opt.key}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return null;
}
