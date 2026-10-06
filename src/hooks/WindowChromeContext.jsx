import { createContext, useCallback, useContext, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAppSettings } from "../settings/SettingsContext.jsx";
import { useDock } from "../dock/DockContext.jsx";
import { isTauri } from "../ipc/env.js";
import { isMacOS } from "../lib/platform.js";
import { useAlwaysOnTop } from "./useAlwaysOnTop.js";
import { setWindowDecorations, useFocusViewWindow } from "./useFocusViewWindow.js";
import {
  syncSurfaceOpacityWindowShadow,
  useSurfaceOpacityWindowShadow,
} from "./useSurfaceOpacityWindowShadow.js";
import { setGlassEffect, useGlassEffect } from "./useGlassEffect.js";
import { useViewsChromeReveal } from "./useViewsChromeReveal.js";

/**
 * @typedef {{
 *   view: {
 *     pinned: boolean,
 *     focusView: import("../lib/focusView.js").FocusView,
 *     surfaceOpacity: number,
 *     glassEnabled: boolean,
 *   },
 *   applyViewState: (next: any, options?: { changed?: string[] }) => Promise<void>,
 *   setPinned: (value: boolean) => void,
 *   setAutoHideControls: (value: boolean) => void,
 *   setCompactPanels: (value: boolean) => void,
 *   setBorderless: (value: boolean) => void,
 *   setSurfaceOpacity: (value: number) => void,
 *   setGlassEnabled: (value: boolean) => void,
 *   focusViewActive: boolean,
 *   frameless: boolean,
 *   reveal: ReturnType<typeof useViewsChromeReveal>,
 * }} WindowChrome
 */
const WindowChromeContext = createContext(/** @type {WindowChrome | null} */ (null));

/**
 * Applies the stored view values to the OS window and owns the functions that change them.
 *
 * Enclosed by the Dock: every native effect here stands down while docked, because Rust owns the
 * strip's chrome and topmost state. The stored values themselves are settings, which is how the
 * Dock can restore them on exit without reading this provider.
 *
 * The native effects stay in this one component, in this order: they act on the same window.
 */
export function WindowChromeProvider({ children }) {
  const {
    windowPinned: pinned,
    setWindowPinned: setPinnedStored,
    focusView,
    setFocusView,
    surfaceOpacity,
    setSurfaceOpacity: setSurfaceOpacityStored,
    glassEnabled,
    setGlassEnabled: setGlassEnabledStored,
    resolvedTheme,
  } = useAppSettings();
  const { docked } = useDock();

  // Suspended while docked: a preset apply may flip the stored pin to false
  // while the strip must stay topmost; when docked flips false the effect
  // re-asserts the user's value.
  useAlwaysOnTop(pinned, { suspended: docked });
  // Suspended while docked: Rust owns strip chrome (no decorations/shadow);
  // when docked flips false the effect re-runs and re-asserts the user's values.
  useFocusViewWindow(focusView.autoHideControls, focusView.borderless, { suspended: docked });
  useSurfaceOpacityWindowShadow(surfaceOpacity);

  const applyViewState = useCallback(
    async (next, { changed = [] } = {}) => {
      const rollback = [];
      try {
        if (
          changed.includes("view.surfaceOpacity") &&
          (next.surfaceOpacity === 0) !== (surfaceOpacity === 0)
        ) {
          const applied = await syncSurfaceOpacityWindowShadow(next.surfaceOpacity);
          if (applied) {
            rollback.push(() => syncSurfaceOpacityWindowShadow(surfaceOpacity));
          }
        }
        if (!docked && isTauri()) {
          const win = getCurrentWindow();
          if (changed.includes("view.pinned")) {
            await win.setAlwaysOnTop(next.pinned === true);
            rollback.push(() => win.setAlwaysOnTop(pinned === true));
          }
          if (
            changed.includes("view.focusView.autoHideControls") ||
            changed.includes("view.focusView.borderless")
          ) {
            const applied = await setWindowDecorations(
              !(next.focusView.autoHideControls || next.focusView.borderless)
            );
            if (applied) {
              rollback.push(() =>
                setWindowDecorations(!(focusView.autoHideControls || focusView.borderless))
              );
            }
          }
        }
        if (isMacOS() && changed.includes("view.glassEnabled")) {
          await setGlassEffect(next.glassEnabled, resolvedTheme.colorScheme === "dark");
          rollback.push(() => setGlassEffect(glassEnabled, resolvedTheme.colorScheme === "dark"));
        }
      } catch (error) {
        let rollbackCompleted = true;
        for (const compensate of rollback.reverse()) {
          try {
            await compensate();
          } catch {
            rollbackCompleted = false;
          }
        }
        const failure =
          /** @type {Error & { partial?: boolean, rollback?: string, changed?: any }} */ (
            error instanceof Error ? error : new Error(String(error))
          );
        failure.partial = !rollbackCompleted;
        failure.rollback = rollbackCompleted ? "completed" : "partial";
        failure.changed = [];
        throw failure;
      }

      if (changed.includes("view.pinned")) setPinnedStored(next.pinned);
      if (changed.some((path) => path.startsWith("view.focusView."))) {
        setFocusView(next.focusView);
      }
      if (changed.includes("view.surfaceOpacity")) {
        setSurfaceOpacityStored(next.surfaceOpacity);
      }
      if (changed.includes("view.glassEnabled")) setGlassEnabledStored(next.glassEnabled);
    },
    [
      docked,
      focusView,
      glassEnabled,
      pinned,
      resolvedTheme.colorScheme,
      surfaceOpacity,
      setFocusView,
      setGlassEnabledStored,
      setSurfaceOpacityStored,
      setPinnedStored,
    ]
  );
  const setPinned = useCallback(
    (/** @type {boolean} */ value) =>
      void applyViewState(
        { pinned: value === true, focusView, surfaceOpacity, glassEnabled },
        { changed: ["view.pinned"] }
      ).catch(() => {}),
    [applyViewState, focusView, glassEnabled, surfaceOpacity]
  );
  const setFocusField = useCallback(
    (field, /** @type {boolean} */ value) =>
      void applyViewState(
        {
          pinned,
          focusView: { ...focusView, [field]: value === true },
          surfaceOpacity,
          glassEnabled,
        },
        { changed: [`view.focusView.${field}`] }
      ).catch(() => {}),
    [applyViewState, focusView, glassEnabled, surfaceOpacity, pinned]
  );
  const setAutoHideControls = useCallback(
    (value) => setFocusField("autoHideControls", value),
    [setFocusField]
  );
  const setCompactPanels = useCallback(
    (value) => setFocusField("compactPanels", value),
    [setFocusField]
  );
  const setBorderless = useCallback((value) => setFocusField("borderless", value), [setFocusField]);
  const setSurfaceOpacity = useCallback(
    (value) =>
      void applyViewState(
        { pinned, focusView, surfaceOpacity: value, glassEnabled },
        { changed: ["view.surfaceOpacity"] }
      ).catch(() => {}),
    [applyViewState, focusView, glassEnabled, pinned]
  );
  const setGlassEnabled = useCallback(
    (/** @type {boolean} */ value) =>
      void applyViewState(
        { pinned, focusView, surfaceOpacity, glassEnabled: value === true },
        { changed: ["view.glassEnabled"] }
      ).catch(() => {}),
    [applyViewState, focusView, surfaceOpacity, pinned]
  );

  useGlassEffect(glassEnabled, resolvedTheme.colorScheme === "dark");

  useEffect(() => {
    const s = document.documentElement.style;
    s.setProperty("--surface-opacity", `${surfaceOpacity}%`);
  }, [surfaceOpacity]);

  const focusViewActive =
    pinned ||
    focusView.autoHideControls ||
    focusView.compactPanels ||
    focusView.borderless ||
    surfaceOpacity < 100;
  const frameless = focusView.autoHideControls || focusView.borderless;
  const reveal = useViewsChromeReveal({
    autoHideControls: focusView.autoHideControls,
    frameless,
  });

  return (
    <WindowChromeContext.Provider
      value={{
        view: { pinned, focusView, surfaceOpacity, glassEnabled },
        applyViewState,
        setPinned,
        setAutoHideControls,
        setCompactPanels,
        setBorderless,
        setSurfaceOpacity,
        setGlassEnabled,
        focusViewActive,
        frameless,
        reveal,
      }}
    >
      {children}
    </WindowChromeContext.Provider>
  );
}

export function useWindowChrome() {
  const chrome = useContext(WindowChromeContext);
  if (!chrome) throw new Error("useWindowChrome must be used inside WindowChromeProvider");
  return chrome;
}
