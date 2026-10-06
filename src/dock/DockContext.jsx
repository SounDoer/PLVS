import { createContext, useCallback, useContext } from "react";
import { useDockMode } from "../hooks/useDockMode.js";
import { useSceneGuard } from "../hooks/SceneGuardContext.jsx";
import { useAppSettings } from "../settings/SettingsContext.jsx";
import { useMeterDisplayState } from "../runtime/MeterRuntimeContext.jsx";
import { isTauri } from "../ipc/env.js";
import { errorDetails } from "../lib/errorDetails.js";
import { reportSceneOperationError } from "../lib/sceneOperationNotice.js";
import { useDockLayout } from "./useDockLayout.js";
import { useDockHistoryViewport } from "./useDockHistoryViewport.js";

/**
 * @typedef {ReturnType<typeof useDockMode> & {
 *   docked: boolean,
 *   layout: ReturnType<typeof useDockLayout>,
 *   historyViewport: ReturnType<typeof useDockHistoryViewport>,
 *   exitDockRestoringAttributes: (options?: {
 *     reportError?: boolean, bounds?: any, decorations?: any, alwaysOnTop?: any,
 *   }) => Promise<{ ok: boolean, error: any }>,
 *   onDockChange: (edgeOrNull: string | null) => Promise<void>,
 *   onDockHeightChange: (height: number, options?: { persist?: boolean }) => Promise<void>,
 *   executeDockForControl: (method: string, projected: any) => Promise<any>,
 * }} DockOwner
 */
const DockContext = createContext(/** @type {DockOwner | null} */ (null));

/**
 * The Dock window form: Rust-mirrored mode, strip layout, and the transitions between forms.
 *
 * Encloses the window chrome on purpose. The chrome effects need `docked` to stand down while Rust
 * owns the strip; exit needs the user's stored pin and focus-view values, which are settings and
 * therefore available here, to restore the window.
 */
export function DockProvider({ children }) {
  const { assertSceneOperationAllowed } = useSceneGuard();
  const { focusView, windowPinned: pinned, historyRetentionSec } = useAppSettings();
  const { clearNotice, raiseNotice, setSelectedOffset } = useMeterDisplayState();

  // Dock hooks run first: `docked` suspends the always-on-top and focus-view
  // window overrides below (Rust owns strip chrome + topmost while docked),
  // and preset capture/apply reads dock state. useDockMode depends only on the
  // profile controller above, so hoisting it above useAlwaysOnTop is safe.
  //
  // The dock is a monitoring posture: AppShell renders the settings overlays
  // (and so the profile editor) only when undocked, and the strip has no profile
  // popover, so a draft carried in would keep outranking the persisted selection
  // for DockStats with no way to see, name, save or cancel it. Entry is therefore
  // refused while one is open -- the discard it used to do instead is exactly what
  // the scene guard exists to prevent.
  const {
    dockEnabled,
    dockEdge,
    dockMonitor,
    dockHeight,
    dockPreviewHeight,
    dockSuspended,
    dockTransitioning,
    reserveSpace,
    enterDockMode,
    exitDockMode,
    setReserveSpace,
    toggleReserveSpace,
    resizeDockHeight,
    suspendDockMode,
    resumeDockMode,
  } = useDockMode({ assertSceneOperationAllowed });
  const dockLayout = useDockLayout();
  const docked = isTauri() && dockEnabled;

  // Dock transitions. Exit restores the user's TRUE normal-form attributes
  // (override-not-overwrite): decorations follow focusView, always-on-top follows
  // the pin toggle — dock never persists over stored settings. Every transition
  // UI entry points map IPC rejections to actionable notices so a failed click
  // handler cannot leave an unhandled rejection or stale error copy behind.
  // NOTE: there is no in-flight guard against rapid dock transitions (v1 accepts
  // this; a fast toggle spam could interleave enter/exit IPC calls).
  const exitDockRestoringAttributes = useCallback(
    async (
      /** @type {{ reportError?: boolean, bounds?: any, decorations?: any, alwaysOnTop?: any }} */ {
        reportError = true,
        bounds,
        decorations,
        alwaysOnTop,
      } = {}
    ) => {
      clearNotice();
      try {
        await exitDockMode({
          decorations: decorations ?? !(focusView.autoHideControls || focusView.borderless),
          alwaysOnTop: alwaysOnTop ?? pinned === true,
          bounds,
        });
        return { ok: true, error: null };
      } catch (error) {
        if (reportError) {
          raiseNotice(
            "error",
            "Could not restore the main window. Try again.",
            errorDetails("Restore window failed", error)
          );
        }
        return { ok: false, error };
      }
    },
    [
      clearNotice,
      exitDockMode,
      focusView.autoHideControls,
      focusView.borderless,
      pinned,
      raiseNotice,
    ]
  );

  const onDockChange = useCallback(
    async (edgeOrNull) => {
      clearNotice();
      try {
        if (edgeOrNull) {
          await enterDockMode(edgeOrNull);
          setSelectedOffset(-1);
        } else await exitDockRestoringAttributes();
      } catch (error) {
        reportSceneOperationError(
          raiseNotice,
          error,
          "Could not move Dock. The previous position was kept.",
          "Dock failed"
        );
      }
    },
    [clearNotice, enterDockMode, exitDockRestoringAttributes, raiseNotice, setSelectedOffset]
  );

  const dockHistoryViewport = useDockHistoryViewport({ maxWindowSec: historyRetentionSec });
  const executeDockForControl = useCallback(
    async (/** @type {string} */ method, projected) => {
      if (method === "dock.enter") {
        const effective = await enterDockMode(
          projected.edge,
          projected.reserveSpace,
          projected.monitor,
          projected.height
        );
        setSelectedOffset(-1);
        return effective;
      }
      if (method === "dock.exit") {
        const result = await exitDockRestoringAttributes({ reportError: false });
        if (!result.ok) throw result.error;
        return;
      }
      dockLayout.setPanels(projected);
    },
    [dockLayout, enterDockMode, exitDockRestoringAttributes, setSelectedOffset]
  );
  const onDockHeightChange = useCallback(
    async (height, options) => {
      clearNotice();
      try {
        await resizeDockHeight(height, options);
      } catch (error) {
        raiseNotice(
          "error",
          "Dock height could not be changed. The previous height was kept.",
          errorDetails("Dock resize failed", error)
        );
      }
    },
    [clearNotice, raiseNotice, resizeDockHeight]
  );

  return (
    <DockContext.Provider
      value={{
        dockEnabled,
        dockEdge,
        dockMonitor,
        dockHeight,
        dockPreviewHeight,
        dockSuspended,
        dockTransitioning,
        reserveSpace,
        enterDockMode,
        exitDockMode,
        setReserveSpace,
        toggleReserveSpace,
        resizeDockHeight,
        suspendDockMode,
        resumeDockMode,
        docked,
        layout: dockLayout,
        historyViewport: dockHistoryViewport,
        exitDockRestoringAttributes,
        onDockChange,
        onDockHeightChange,
        executeDockForControl,
      }}
    >
      {children}
    </DockContext.Provider>
  );
}

export function useDock() {
  const dock = useContext(DockContext);
  if (!dock) throw new Error("useDock must be used inside DockProvider");
  return dock;
}
