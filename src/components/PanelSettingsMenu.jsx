import { Settings2 } from "lucide-react";

import { PanelSettingsContent } from "./PanelSettingsContent.jsx";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { normalizePanelControls } from "@/lib/panelControls.js";
import { spectrumViewApplies } from "@/math/spectrumChannelViewOptions.js";

function getSelectedOption(options, valueKey) {
  const matchedOption = options.find((opt) => opt.key === valueKey);
  return {
    matchedOption,
    selectedOption: matchedOption ?? options[0],
  };
}

function spectrumKeyFromSelection(sel) {
  if (!sel) return "";
  return sel.type === "pair" ? `p-${sel.x}-${sel.y}` : `s-${sel.ch}`;
}

function hasPanelSettings({
  activeTab,
  channelCount = 0,
  spectrumOptions = [],
  spectrumValueKey = "",
  onSpectrumViewChange,
  onSpectrumPeakHoldToggle,
  vectorscopeOptions = [],
  panelControls,
  onPanelControlsChange,
}) {
  if (activeTab === "levelMeter" || activeTab === "stats" || activeTab === "loudness") {
    return panelControls != null && typeof onPanelControlsChange === "function";
  }

  if (activeTab === "spectrum" || activeTab === "spectrogram") {
    const hasPanelControls = panelControls != null;
    const normalizedPanelControls = normalizePanelControls(panelControls);
    const effectiveSpectrumValueKey =
      (hasPanelControls ? spectrumKeyFromSelection(normalizedPanelControls.spectrumChannel) : "") ||
      spectrumValueKey;
    const { selectedOption } = getSelectedOption(spectrumOptions, effectiveSpectrumValueKey);
    const sel = selectedOption?.sel ?? null;
    const showView =
      activeTab === "spectrum" &&
      spectrumViewApplies(sel) &&
      typeof onSpectrumViewChange === "function";
    const showChannel = channelCount > 2 && spectrumOptions.length > 0;
    const showPeak = activeTab === "spectrum" && typeof onSpectrumPeakHoldToggle === "function";
    return showView || showChannel || showPeak;
  }

  return (
    activeTab === "vectorscope" &&
    Number.isFinite(channelCount) &&
    channelCount > 2 &&
    vectorscopeOptions.length > 0
  );
}

export function PanelSettingsMenu(props) {
  if (!hasPanelSettings(props)) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Panel settings"
          className="rounded p-0.5 text-muted-foreground opacity-50 hover:opacity-100 focus-visible:outline-none"
        >
          <Settings2 size={12} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-auto p-2">
        <PanelSettingsContent {...props} />
      </PopoverContent>
    </Popover>
  );
}
