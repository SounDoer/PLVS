import {
  DEFAULT_PANEL_PRESENTATION,
  normalizePanelPresentation,
} from "../lib/panelPresentation.js";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAppSettings } from "../settings/SettingsContext.jsx";
import { useDock } from "../dock/DockContext.jsx";
import { isTauri } from "../ipc/env.js";
import { isMacOS } from "../lib/platform.js";
import { DEFAULT_FOCUS_VIEW } from "../lib/focusView.js";
import { useAlwaysOnTop } from "./useAlwaysOnTop.js";
import { setWindowDecorations, useFocusViewWindow } from "./useFocusViewWindow.js";
import {
  syncSurfaceOpacityWindowShadow,
  useSurfaceOpacityWindowShadow,
} from "./useSurfaceOpacityWindowShadow.js";
import { setGlassEffect, useGlassEffect } from "./useGlassEffect.js";
import { useViewsChromeReveal } from "./useViewsChromeReveal.js";
import { settingsStore } from "../persistence/index.js";
import {
  DEFAULT_GLASS_ENABLED,
  DEFAULT_SURFACE_OPACITY,
  normalizeSettingsFocusView,
  normalizeSurfaceOpacity,
} from "../settings/defaults.js";

/**
 * @typedef {{
 *   view: {
 *     panelPresentation?: import("../lib/panelPresentation.js").PanelPresentation,
 *     pinned: boolean,
 *     focusView: import("../lib/focusView.js").FocusView,
 *     surfaceOpacity: number,
 *     dockSurfaceOpacity: number,
 *     glassEnabled: boolean,
 *   },
 *   applyViewState: (next: any, options?: { changed?: string[] }) => Promise<void>,
 *   canResetWindowView: boolean,
 *   resetWindowView: () => Promise<void>,
 *   setPinned: (value: boolean) => void,
 *   setAutoHideControls: (value: boolean) => void,
 *   setPanelPresentation: (value: import("../lib/panelPresentation.js").PanelPresentation) => void,
 *   setCompactPanels: (value: boolean) => void,
 *   setBorderless: (value: boolean) => void,
 *   setSurfaceOpacity: (value: number) => void,
 *   setDockSurfaceOpacity: (value: number) => void,
 *   setGlassEnabled: (value: boolean) => void,
 *   focusViewActive: boolean,
 *   frameless: boolean,
 *   reveal: ReturnType<typeof useViewsChromeReveal>,
 * }} WindowChrome
 */
const WindowChromeContext = createContext(/** @type {WindowChrome | null} */ (null));

const WINDOW_VIEW_DEFAULTS = {
  pinned: false,
  focusView: DEFAULT_FOCUS_VIEW,
  panelPresentation: DEFAULT_PANEL_PRESENTATION,
  surfaceOpacity: DEFAULT_SURFACE_OPACITY,
  glassEnabled: DEFAULT_GLASS_ENABLED,
};

function windowViewResetChanges(view) {
  const defaults = WINDOW_VIEW_DEFAULTS;
  // Hide Panel Headers is written through panel presentation, which also updates its legacy value.
  return [
    ["view.pinned", view.pinned, defaults.pinned],
    [
      "view.focusView.autoHideControls",
      view.focusView.autoHideControls,
      defaults.focusView.autoHideControls,
    ],
    ["view.focusView.borderless", view.focusView.borderless, defaults.focusView.borderless],
    [
      "view.panelPresentation.workspace.hidePanelHeaders",
      view.panelPresentation.workspace.hidePanelHeaders,
      defaults.panelPresentation.workspace.hidePanelHeaders,
    ],
    [
      "view.panelPresentation.workspace.hideAxesAndLabels",
      view.panelPresentation.workspace.hideAxesAndLabels,
      defaults.panelPresentation.workspace.hideAxesAndLabels,
    ],
    ["view.surfaceOpacity", view.surfaceOpacity, defaults.surfaceOpacity],
    ...(isMacOS() ? [["view.glassEnabled", view.glassEnabled, defaults.glassEnabled]] : []),
  ]
    .filter(([, value, fallback]) => value !== fallback)
    .map(([path]) => /** @type {string} */ (path));
}

function mergeChangedFields(current, next, changed, prefix) {
  return Object.fromEntries(
    Object.keys(current).map((key) => [
      key,
      changed.includes(`${prefix}.${key}`) ? next[key] : current[key],
    ])
  );
}

function storedFocusView(settings) {
  return {
    ...normalizeSettingsFocusView(settings.focusView),
    compactPanels: normalizePanelPresentation(settings.panelPresentation, settings.focusView)
      .workspace.hidePanelHeaders,
  };
}

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
    panelPresentation: storedPanelPresentation,
    setPanelPresentation: setPanelPresentationStored,
    surfaceOpacity,
    setSurfaceOpacity: setSurfaceOpacityStored,
    dockSurfaceOpacity,
    setDockSurfaceOpacity: setDockSurfaceOpacityStored,
    glassEnabled,
    setGlassEnabled: setGlassEnabledStored,
    resolvedTheme,
  } = useAppSettings();
  const { docked } = useDock();
  const panelPresentation = normalizePanelPresentation(storedPanelPresentation, focusView);

  // Suspended while docked: a preset apply may flip the stored pin to false
  // while the strip must stay topmost; when docked flips false the effect
  // re-asserts the user's value.
  useAlwaysOnTop(pinned, { suspended: docked });
  // Suspended while docked: Rust owns strip chrome (no decorations/shadow);
  // when docked flips false the effect re-runs and re-asserts the user's values.
  useFocusViewWindow(focusView.autoHideControls, focusView.borderless, { suspended: docked });
  useSurfaceOpacityWindowShadow(surfaceOpacity);

  const runViewUpdate = useCallback(
    async (next, { changed = [] } = {}) => {
      // Use the settings owner's last write even if React has yet to render it.
      const stored = settingsStore.read();
      const currentFocus = storedFocusView(stored);
      const nextFocus = mergeChangedFields(currentFocus, next.focusView, changed, "view.focusView");
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
            rollback.push(() => win.setAlwaysOnTop(stored.windowPinned === true));
          }
          if (
            changed.includes("view.focusView.autoHideControls") ||
            changed.includes("view.focusView.borderless")
          ) {
            await setWindowDecorations(
              !(nextFocus.autoHideControls || nextFocus.borderless),
              (previous) => {
                rollback.push(() =>
                  setWindowDecorations(
                    previous ?? !(currentFocus.autoHideControls || currentFocus.borderless)
                  )
                );
              }
            );
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
        setFocusView(
          mergeChangedFields(
            storedFocusView(settingsStore.read()),
            next.focusView,
            changed,
            "view.focusView"
          )
        );
      }
      if (changed.some((path) => path.startsWith("view.panelPresentation."))) {
        const presentation = normalizePanelPresentation(settingsStore.read().panelPresentation);
        setPanelPresentationStored(
          Object.fromEntries(
            Object.keys(presentation).map((surface) => [
              surface,
              mergeChangedFields(
                presentation[surface],
                next.panelPresentation[surface],
                changed,
                `view.panelPresentation.${surface}`
              ),
            ])
          )
        );
      }
      if (changed.includes("view.surfaceOpacity")) {
        setSurfaceOpacityStored(next.surfaceOpacity);
      }
      if (changed.includes("view.dockSurfaceOpacity")) {
        setDockSurfaceOpacityStored(next.dockSurfaceOpacity);
      }
      if (changed.includes("view.glassEnabled")) setGlassEnabledStored(next.glassEnabled);
    },
    [
      docked,
      glassEnabled,
      resolvedTheme.colorScheme,
      surfaceOpacity,
      setFocusView,
      setPanelPresentationStored,
      setGlassEnabledStored,
      setSurfaceOpacityStored,
      setDockSurfaceOpacityStored,
      setPinnedStored,
    ]
  );
  const viewUpdate = useRef(runViewUpdate);
  useLayoutEffect(() => {
    viewUpdate.current = runViewUpdate;
  }, [runViewUpdate]);
  const pendingViewUpdate = useRef(/** @type {Promise<void> | null} */ (null));
  const queueViewUpdate = useCallback((run) => {
    const pending = pendingViewUpdate.current;
    const result = pending ? pending.then(run, run) : run();
    pendingViewUpdate.current = result;
    const release = () => {
      if (pendingViewUpdate.current === result) pendingViewUpdate.current = null;
    };
    void result.then(release, release);
    return result;
  }, []);
  const applyViewState = useCallback(
    (next, options) => queueViewUpdate(() => viewUpdate.current(next, options)),
    [queueViewUpdate]
  );
  const resetWindowView = useCallback(
    () =>
      queueViewUpdate(async () => {
        const stored = settingsStore.read();
        const changed = windowViewResetChanges({
          pinned: stored.windowPinned === true,
          focusView: storedFocusView(stored),
          panelPresentation: normalizePanelPresentation(stored.panelPresentation, stored.focusView),
          surfaceOpacity: normalizeSurfaceOpacity(
            settingsStore.readPendingField("surfaceOpacity") ?? stored.surfaceOpacity
          ),
          glassEnabled: stored.glassEnabled === true,
        });
        if (changed.length) await viewUpdate.current(WINDOW_VIEW_DEFAULTS, { changed });
      }),
    [queueViewUpdate]
  );
  const setPanelPresentation = (raw) => {
    const next = normalizePanelPresentation(raw);
    const changed = Object.entries(panelPresentation).flatMap(([surface, values]) =>
      Object.keys(values)
        .filter((key) => next[surface][key] !== values[key])
        .map((key) => `view.panelPresentation.${surface}.${key}`)
    );
    void applyViewState({ panelPresentation: next }, { changed }).catch(() => {});
  };
  const setPinned = useCallback(
    (/** @type {boolean} */ value) =>
      void applyViewState({ pinned: value === true }, { changed: ["view.pinned"] }).catch(() => {}),
    [applyViewState]
  );
  const setFocusField = useCallback(
    (field, /** @type {boolean} */ value) =>
      void applyViewState(
        { focusView: { [field]: value === true } },
        { changed: [`view.focusView.${field}`] }
      ).catch(() => {}),
    [applyViewState]
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
  // No native effect, so no other view value is needed: applyViewState reads only the changed path.
  const setDockSurfaceOpacity = useCallback(
    (value) =>
      void applyViewState(
        { dockSurfaceOpacity: value },
        { changed: ["view.dockSurfaceOpacity"] }
      ).catch(() => {}),
    [applyViewState]
  );
  const setGlassEnabled = useCallback(
    (/** @type {boolean} */ value) =>
      void applyViewState(
        { glassEnabled: value === true },
        { changed: ["view.glassEnabled"] }
      ).catch(() => {}),
    [applyViewState]
  );

  useGlassEffect(glassEnabled, resolvedTheme.colorScheme === "dark");

  useEffect(() => {
    const s = document.documentElement.style;
    s.setProperty("--surface-opacity", `${surfaceOpacity}%`);
  }, [surfaceOpacity]);

  useEffect(() => {
    document.documentElement.style.setProperty("--dock-surface-opacity", `${dockSurfaceOpacity}%`);
  }, [dockSurfaceOpacity]);

  useEffect(() => {
    document.documentElement.toggleAttribute("data-docked", docked);
  }, [docked]);

  const focusViewActive =
    pinned ||
    focusView.autoHideControls ||
    panelPresentation.workspace.hidePanelHeaders ||
    panelPresentation.workspace.hideAxesAndLabels ||
    focusView.borderless ||
    surfaceOpacity < 100;
  const frameless = focusView.autoHideControls || focusView.borderless;
  const reveal = useViewsChromeReveal({
    autoHideControls: focusView.autoHideControls,
    frameless,
  });
  const view = {
    pinned,
    focusView,
    surfaceOpacity,
    dockSurfaceOpacity,
    glassEnabled,
    panelPresentation,
  };

  return (
    <WindowChromeContext.Provider
      value={{
        view,
        setPanelPresentation,
        applyViewState,
        canResetWindowView: windowViewResetChanges(view).length > 0,
        resetWindowView,
        setPinned,
        setAutoHideControls,
        setCompactPanels,
        setBorderless,
        setSurfaceOpacity: setSurfaceOpacityStored,
        setDockSurfaceOpacity,
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
