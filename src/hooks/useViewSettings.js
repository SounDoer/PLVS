import { useEffect, useState } from "react";
import { presetsStore, settingsStore } from "../persistence/index.js";
import {
  normalizeGlassEnabled,
  normalizePanelOpacity,
  normalizeSettingsFocusView,
} from "../settings/defaults.js";

export function useViewSettings() {
  const [focusView, setFocusViewState] = useState(() =>
    normalizeSettingsFocusView(settingsStore.read().focusView)
  );
  const [panelOpacity, setPanelOpacityState] = useState(() =>
    normalizePanelOpacity(settingsStore.read().panelOpacity)
  );
  const [glassEnabled, setGlassEnabledState] = useState(() =>
    normalizeGlassEnabled(settingsStore.read().glassEnabled)
  );

  function markPresetDirty() {
    presetsStore.patch({ dirty: true });
  }

  function setFocusView(nextFocusView) {
    const next = normalizeSettingsFocusView(nextFocusView);
    settingsStore.patch({ focusView: next });
    markPresetDirty();
    setFocusViewState(next);
  }

  function setAutoHideControls(value) {
    setFocusView({ ...focusView, autoHideControls: value === true });
  }

  function setCompactPanels(value) {
    setFocusView({ ...focusView, compactPanels: value === true });
  }

  function setBorderless(value) {
    setFocusView({ ...focusView, borderless: value === true });
  }

  function setPanelOpacity(value) {
    const next = normalizePanelOpacity(value);
    settingsStore.patch({ panelOpacity: next });
    markPresetDirty();
    setPanelOpacityState(next);
  }

  function setGlassEnabled(value) {
    const next = normalizeGlassEnabled(value);
    settingsStore.patch({ glassEnabled: next });
    markPresetDirty();
    setGlassEnabledState(next);
  }

  useEffect(
    () =>
      settingsStore.subscribe(() => {
        const settings = settingsStore.read();
        setFocusViewState(normalizeSettingsFocusView(settings.focusView));
        setPanelOpacityState(normalizePanelOpacity(settings.panelOpacity));
        setGlassEnabledState(normalizeGlassEnabled(settings.glassEnabled));
      }),
    []
  );

  return {
    focusView,
    setFocusView,
    setAutoHideControls,
    setCompactPanels,
    setBorderless,
    panelOpacity,
    setPanelOpacity,
    glassEnabled,
    setGlassEnabled,
  };
}
