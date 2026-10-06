import { Settings2 } from "lucide-react";
import { useCallback, useState } from "react";

import { PanelSettingsContent } from "./PanelSettingsContent.jsx";
import { PanelSettingsHeader } from "./PanelSettingsHeader.jsx";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PANEL_HEADER_ACTION_BUTTON } from "@/lib/shellLayout";
import { normalizePanelControls } from "@/lib/panelControls.js";
import { spectrumViewApplies } from "@/math/spectrumChannelViewOptions.js";
import { isDefaultPanelControls } from "@/workspace/panelControlInstances.js";
import { IconAction } from "@/components/ui/icon-action";
import { useUiNavigationTarget, useUiSurface } from "@/uiNavigation/UiNavigationContext.jsx";
import { createUiNavigationError } from "@/uiNavigation/uiNavigationModel.js";

const PANEL_SETTINGS_TITLES = {
  levelMeter: "Level Meter",
  loudness: "Loudness",
  spectrum: "Spectrum",
  spectrogram: "Spectrogram",
  stats: "Stats",
  vectorscope: "Vectorscope",
  waveform: "Waveform",
  "stereo-map": "Stereo Map",
};

/**
 * @param {string} valueKey
 */
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

/**
 * @param {{
 *   activeTab?: string,
 *   channelCount?: number,
 *   spectrumOptions?: any[],
 *   spectrumValueKey?: string,
 *   onSpectrumViewChange?: (...args: any[]) => any,
 *   onSpectrumMaxHoldToggle?: (...args: any[]) => any,
 *   panelControls?: Partial<import("@/workspace/types.js").PanelControls>,
 *   onPanelControlsChange?: (...args: any[]) => any,
 * }} options
 */
function hasPanelSettings({
  activeTab,
  channelCount = 0,
  spectrumOptions = [],
  spectrumValueKey = "",
  onSpectrumViewChange,
  onSpectrumMaxHoldToggle,
  panelControls,
  onPanelControlsChange,
}) {
  if (
    activeTab === "levelMeter" ||
    activeTab === "stats" ||
    activeTab === "loudness" ||
    activeTab === "waveform"
  ) {
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
    (activeTab === "vectorscope" || activeTab === "stereo-map") &&
    panelControls != null &&
    typeof onPanelControlsChange === "function"
  );
}

/** @param {{ panelId?: string, presentation?: string, panelTitle: string, onPanelControlsReset: (...args: any[]) => any, [key: string]: any }} props */
export function PanelSettingsMenu({
  panelId,
  presentation = "normal",
  panelTitle,
  onPanelControlsReset,
  ...props
}) {
  const available = hasPanelSettings(props);
  const [open, setOpen] = useState(false);
  const show = useCallback(() => {
    if (!available || !panelId) {
      throw createUiNavigationError("surfaceUnavailable", {
        kind: "panelSettings",
        panelId,
      });
    }
    setOpen(true);
  }, [available, panelId]);
  useUiNavigationTarget("panelSettings", panelId, { show });
  useUiSurface({
    active: open && available && Boolean(panelId),
    kind: "panelSettings",
    origin: "navigable",
    blocking: false,
    dismissible: true,
    supportedActions: ["close"],
    target: { panelId, presentation },
    onClose: () => setOpen(false),
  });
  if (!available) return null;
  const title = panelTitle ?? PANEL_SETTINGS_TITLES[props.activeTab] ?? "Panel";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconAction aria-label="Panel settings" className={PANEL_HEADER_ACTION_BUTTON}>
          <Settings2 className="size-[length:var(--ui-icon-panel-action)]" />
        </IconAction>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        onEscapeKeyDown={(event) => {
          if (
            /** @type {Element} */ (event.target).closest?.(
              "[data-settings-select-menu], .plvs-input"
            )
          )
            event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (/** @type {Element} */ (event.target).closest?.("[data-settings-select-menu]"))
            event.preventDefault();
        }}
        className="flex max-h-[var(--radix-popover-content-available-height)] w-auto flex-col overflow-hidden p-1"
      >
        <PanelSettingsHeader
          title={title}
          onReset={onPanelControlsReset}
          isDefault={isDefaultPanelControls(props.panelControls)}
        />
        <div
          data-panel-settings-scroll
          className="min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain"
        >
          <PanelSettingsContent {...props} />
        </div>
      </PopoverContent>
    </Popover>
  );
}
