import { Settings2 } from "lucide-react";

import { PanelSettingsContent } from "./PanelSettingsContent.jsx";
import { PanelSettingsHeader } from "./PanelSettingsHeader.jsx";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PANEL_SETTINGS_SURFACE_CLASS } from "@/components/ui/surfaceStyles.js";
import { PANEL_HEADER_ACTION_BUTTON } from "@/lib/shellLayout";
import { cn } from "@/lib/utils";
import { normalizePanelControls } from "@/lib/panelControls.js";
import { spectrumViewApplies } from "@/math/spectrumChannelViewOptions.js";
import { isDefaultPanelControls } from "@/workspace/panelControlInstances.js";

const PANEL_SETTINGS_TITLES = {
  levelMeter: "Level Meter",
  loudness: "Loudness",
  spectrum: "Spectrum",
  spectrogram: "Spectrogram",
  stats: "Stats",
  vectorscope: "Vectorscope",
};

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

export function PanelSettingsMenu({ panelTitle, onPanelControlsReset, ...props }) {
  if (!hasPanelSettings(props)) return null;
  const title = panelTitle ?? PANEL_SETTINGS_TITLES[props.activeTab] ?? "Panel";

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
        className={cn("w-auto p-1", PANEL_SETTINGS_SURFACE_CLASS)}
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <PanelSettingsHeader
          title={title}
          onReset={onPanelControlsReset}
          isDefault={isDefaultPanelControls(props.panelControls)}
        />
        <PanelSettingsContent {...props} />
      </PopoverContent>
    </Popover>
  );
}
