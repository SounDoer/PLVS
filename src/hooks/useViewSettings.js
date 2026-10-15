import { normalizePanelPresentation } from "../lib/panelPresentation.js";
import { useEffect, useState } from "react";
import { presetsStore, settingsStore } from "../persistence/index.js";
import {
  normalizeGlassEnabled,
  normalizeSurfaceOpacity,
  normalizeSettingsFocusView,
} from "../settings/defaults.js";

export function useViewSettings() {
  const [panelPresentation, setPanelPresentationState] = useState(() => {
    const settings = settingsStore.read();
    return normalizePanelPresentation(settings.panelPresentation, settings.focusView);
  });
  const [focusView, setFocusViewState] = useState(() =>
    normalizeSettingsFocusView(settingsStore.read().focusView)
  );
  const [surfaceOpacity, setSurfaceOpacityState] = useState(() =>
    normalizeSurfaceOpacity(settingsStore.read().surfaceOpacity)
  );
  const [glassEnabled, setGlassEnabledState] = useState(() =>
    normalizeGlassEnabled(settingsStore.read().glassEnabled)
  );

  function markPresetDirty() {
    presetsStore.patch({ dirty: true });
  }

  function setFocusView(nextFocusView) {
    const next = normalizeSettingsFocusView(nextFocusView);
    const stored = settingsStore.read();
    const presentation = normalizePanelPresentation(stored.panelPresentation, stored.focusView);
    presentation.workspace.hidePanelHeaders = next.compactPanels;
    settingsStore.patch({ focusView: next, panelPresentation: presentation });
    setPanelPresentationState(presentation);
    markPresetDirty();
    setFocusViewState(next);
  }

  function setPanelPresentation(raw) {
    const next = normalizePanelPresentation(raw);
    const focus = normalizeSettingsFocusView(settingsStore.read().focusView);
    focus.compactPanels = next.workspace.hidePanelHeaders;
    settingsStore.patch({ panelPresentation: next, focusView: focus });
    markPresetDirty();
    setPanelPresentationState(next);
    setFocusViewState(focus);
  }

  /**
   * @param {boolean} value
   */
  function setAutoHideControls(value) {
    setFocusView({ ...focusView, autoHideControls: value === true });
  }

  /**
   * @param {boolean} value
   */
  function setCompactPanels(value) {
    setFocusView({ ...focusView, compactPanels: value === true });
  }

  /**
   * @param {boolean} value
   */
  function setBorderless(value) {
    setFocusView({ ...focusView, borderless: value === true });
  }

  function setSurfaceOpacity(value) {
    const next = normalizeSurfaceOpacity(value);
    // Driven by a range input's `onInput`, so this runs on every pixel of a drag.
    settingsStore.patchCoalesced({ surfaceOpacity: next });
    markPresetDirty();
    setSurfaceOpacityState(next);
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
        const next = normalizePanelPresentation(settings.panelPresentation, settings.focusView);
        setPanelPresentationState(next);
        setFocusViewState({
          ...normalizeSettingsFocusView(settings.focusView),
          compactPanels: next.workspace.hidePanelHeaders,
        });
        setSurfaceOpacityState(normalizeSurfaceOpacity(settings.surfaceOpacity));
        setGlassEnabledState(normalizeGlassEnabled(settings.glassEnabled));
      }),
    []
  );

  return {
    focusView: { ...focusView, compactPanels: panelPresentation.workspace.hidePanelHeaders },
    setFocusView,
    panelPresentation,
    setPanelPresentation,
    setAutoHideControls,
    setCompactPanels,
    setBorderless,
    surfaceOpacity,
    setSurfaceOpacity,
    glassEnabled,
    setGlassEnabled,
  };
}
