import { Settings2 } from "lucide-react";

import { PanelSettingsContent } from "./PanelSettingsContent.jsx";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PANEL_HEADER_ACTION_BUTTON } from "@/lib/shellLayout";
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
  onSpectrumMaxHoldToggle,
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
    const showPeak = activeTab === "spectrum" && typeof onSpectrumMaxHoldToggle === "function";
    const showDisplayControls =
      activeTab === "spectrum" && hasPanelControls && typeof onPanelControlsChange === "function";
    const showSpectrogramRange =
      activeTab === "spectrogram" &&
      hasPanelControls &&
      typeof onPanelControlsChange === "function";
    return showView || showChannel || showPeak || showDisplayControls || showSpectrogramRange;
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
        <button type="button" aria-label="Panel settings" className={PANEL_HEADER_ACTION_BUTTON}>
          <Settings2 size={12} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-auto rounded-lg border-border/70 bg-popover/95 p-1 shadow-sm"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <PanelSettingsContent {...props} />
      </PopoverContent>
    </Popover>
  );
}
