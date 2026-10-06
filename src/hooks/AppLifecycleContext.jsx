import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAppSettings } from "../settings/SettingsContext.jsx";
import { useDock } from "../dock/DockContext.jsx";
import { useMeterDisplayState, useMeterRuntime } from "../runtime/MeterRuntimeContext.jsx";
import { useSource } from "../runtime/SourceContext.jsx";
import { useSourceActions } from "../runtime/SourceActionsContext.jsx";
import { useRuntimeCoordination } from "../runtime/coordination.js";
import { useUiNavigationEnvironment } from "../uiNavigation/UiNavigationContext.jsx";
import { hideAppWindow, toggleAppWindow } from "../lib/windowVisibility.js";
import { isTauri } from "../ipc/env.js";
import { useSceneGuard } from "./SceneGuardContext.jsx";
import { useWindowChrome } from "./WindowChromeContext.jsx";
import { usePresetLibrary } from "./PresetsContext.jsx";
import { useCrashReportSetting } from "./useCrashReportSetting.js";
import { useCrashReporting } from "./useCrashReporting.js";
import { useUpdateCheck } from "./useUpdateCheck.js";
import { useApplyUpdate } from "./useApplyUpdate.js";
import { useCloseConfirm } from "./useCloseConfirm.js";
import { useInstanceIdentity } from "./useInstanceIdentity.js";
import { useTray } from "./useTray.js";
import { useAppKeyboardShortcuts } from "./useAppKeyboardShortcuts.js";

/**
 * @typedef {{
 *   crashReportSetting: ReturnType<typeof useCrashReportSetting>,
 *   crashReporting: ReturnType<typeof useCrashReporting>,
 *   windowVisible: boolean,
 *   onShowWindow: () => Promise<void>,
 *   updateBusy: boolean,
 *   updateControls: Pick<ReturnType<typeof useUpdateCheck>, "updateInfo" | "refreshUpdateCheck"> &
 *     ReturnType<typeof useApplyUpdate>,
 *   closeConfirm: {
 *     dialogOpen: boolean,
 *     closeError: any,
 *     closing: boolean,
 *     handleConfirm: (...args: any[]) => any,
 *     handleRetry: (...args: any[]) => any,
 *     handleCancel: (...args: any[]) => any,
 *   },
 * }} AppLifecycle
 */
const AppLifecycleContext = createContext(/** @type {AppLifecycle | null} */ (null));

/**
 * The application around the meter: whether the window is shown, the tray, updates, the close
 * dialog, crash reports, and the global shortcuts. Mounts inside every domain those need.
 */
export function AppLifecycleProvider({ children }) {
  const { setSettingsOpen, clearShortcut, focusView, resolvedTheme } = useAppSettings();
  const { docked, suspendDockMode, resumeDockMode, exitDockRestoringAttributes } = useDock();
  const { reveal } = useWindowChrome();
  const toggleFocusControls = reveal.toggleControls;
  const { activeBlockingEditors } = useSceneGuard();
  const presets = usePresetLibrary();
  const meterRuntime = useMeterRuntime();
  const {
    running,
    analyzingFileId,
    stopFileAnalysis,
    stopLiveForControl,
    startLiveForControl,
    switchSource,
  } = meterRuntime;
  const { showClock } = useMeterDisplayState();
  const {
    audioOutputs,
    audioInputs,
    captureApplications,
    safeAudioDeviceId,
    defaultOutputLabel,
    onSelectCaptureDevice,
    sourceDisplayName,
  } = useSource();
  const { clearAll, onStartClick } = useSourceActions();

  // Crash-report discovery must outlive the normal-window overlays. A saved Dock posture replaces
  // those overlays with the strip at boot; keeping discovery here lets App restore the main window
  // before presenting the report instead of silently waiting for the user to exit Dock manually.
  const crashReportSetting = useCrashReportSetting();
  const crashReporting = useCrashReporting({ promptEnabled: crashReportSetting.enabled });
  const [windowVisible, setWindowVisible] = useState(true);
  useUiNavigationEnvironment({
    windowForm: docked ? "dock" : "normal",
    windowVisible,
  });

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    getCurrentWindow()
      .isVisible()
      .then((visible) => {
        if (!cancelled) setWindowVisible(visible);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const onHideWindow = useCallback(async () => {
    if (!isTauri()) return;
    const window = getCurrentWindow();
    await hideAppWindow({
      docked,
      window,
      suspendDock: suspendDockMode,
    });
    setWindowVisible(await window.isVisible());
  }, [docked, suspendDockMode]);

  const onShowWindow = useCallback(async () => {
    if (!isTauri()) return;
    const window = getCurrentWindow();
    if (await window.isVisible()) {
      setWindowVisible(true);
      return;
    }
    await toggleAppWindow({
      docked,
      window,
      suspendDock: suspendDockMode,
      resumeDock: resumeDockMode,
    });
    setWindowVisible(await window.isVisible());
  }, [docked, resumeDockMode, suspendDockMode]);

  const { updateInfo, refreshUpdateCheck } = useUpdateCheck();
  const { installStatus, downloadProgress, install, restartToApply, resetInstall } =
    useApplyUpdate();
  const updateBusy = installStatus === "installing" || installStatus === "restarting";

  const {
    dialogOpen: closeDialogOpen,
    closeError,
    closing,
    handleConfirm: handleCloseConfirm,
    handleRetry: handleCloseRetry,
    handleCancel: handleCloseCancel,
    requestCloseAction,
  } = useCloseConfirm({ onHideWindow, onShowWindow, closeBlocked: updateBusy });

  const onToggleWindow = useCallback(async () => {
    if (!isTauri()) return;
    const window = getCurrentWindow();
    if (await window.isVisible()) {
      await requestCloseAction("tray");
      return;
    }
    await toggleAppWindow({
      docked,
      window,
      suspendDock: suspendDockMode,
      resumeDock: resumeDockMode,
    });
    setWindowVisible(await window.isVisible());
  }, [docked, requestCloseAction, resumeDockMode, suspendDockMode]);

  useEffect(() => {
    if (!docked || !crashReporting.pendingReport) return;
    void exitDockRestoringAttributes();
  }, [crashReporting.pendingReport, docked, exitDockRestoringAttributes]);

  useInstanceIdentity({ sourceLabel: sourceDisplayName, running });
  const stopRuntimeForCoordination = useCallback(async () => {
    if (meterRuntime.liveLifecycle === "running") await stopLiveForControl();
    if (analyzingFileId) await stopFileAnalysis(analyzingFileId);
  }, [analyzingFileId, meterRuntime.liveLifecycle, stopFileAnalysis, stopLiveForControl]);
  const startRuntimeAfterCoordination = useCallback(async () => {
    switchSource("live");
    await startLiveForControl();
  }, [startLiveForControl, switchSource]);
  useRuntimeCoordination({
    blockingEditors: activeBlockingEditors,
    running: meterRuntime.liveLifecycle === "running",
    stop: stopRuntimeForCoordination,
    start: startRuntimeAfterCoordination,
    show: onShowWindow,
  });

  useTray({
    running,
    windowVisible,
    onStartClick,
    onToggleWindow,
    onQuit: () => requestCloseAction("quit"),
    colorScheme: resolvedTheme.colorScheme,
    updateBusy,
    audioOutputs,
    audioInputs,
    captureApplications,
    safeAudioDeviceId,
    defaultOutputLabel,
    sourceBusy:
      ["starting", "stopping"].includes(meterRuntime.liveLifecycle) ||
      meterRuntime.liveDeviceTransition !== null,
    onSelectSource: onSelectCaptureDevice,
    presets,
  });

  useAppKeyboardShortcuts({
    clearAll,
    running,
    showClock,
    // Settings dialog is normal-form only; ignore the shortcut while docked so
    // exiting dock doesn't pop a dialog opened invisibly from the strip.
    setSettingsOpen: docked ? () => {} : setSettingsOpen,
    clearShortcut,
    autoHideControls: focusView.autoHideControls,
    toggleFocusControls,
  });

  return (
    <AppLifecycleContext.Provider
      value={{
        crashReportSetting,
        crashReporting,
        windowVisible,
        onShowWindow,
        updateBusy,
        updateControls: {
          updateInfo,
          refreshUpdateCheck,
          installStatus,
          downloadProgress,
          install,
          restartToApply,
          resetInstall,
        },
        closeConfirm: {
          dialogOpen: closeDialogOpen,
          closeError,
          closing,
          handleConfirm: handleCloseConfirm,
          handleRetry: handleCloseRetry,
          handleCancel: handleCloseCancel,
        },
      }}
    >
      {children}
    </AppLifecycleContext.Provider>
  );
}

export function useAppLifecycle() {
  const lifecycle = useContext(AppLifecycleContext);
  if (!lifecycle) throw new Error("useAppLifecycle must be used inside AppLifecycleProvider");
  return lifecycle;
}
