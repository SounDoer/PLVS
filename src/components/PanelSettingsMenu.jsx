import { Settings2 } from "lucide-react";
import { useCallback, useState } from "react";

import { PanelSettingsContent } from "./PanelSettingsContent.jsx";
import { PanelSettingsHeader } from "./PanelSettingsHeader.jsx";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PANEL_HEADER_ACTION_BUTTON } from "@/lib/shellLayout";
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
 * Every tab renders from panel controls, so there are settings to show exactly when there are
 * controls and a way to change them.
 * @param {{
 *   panelControls?: Partial<import("@/workspace/types.js").PanelControls>,
 *   onPanelControlsChange?: (...args: any[]) => any,
 * }} options
 */
function hasPanelSettings({ panelControls, onPanelControlsChange }) {
  return panelControls != null && typeof onPanelControlsChange === "function";
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
