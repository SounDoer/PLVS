import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LAYER_INDICATOR } from "../components/ui/layers.js";
import { useAppSettings } from "../settings/SettingsContext.jsx";
import { useDock } from "../dock/DockContext.jsx";
import { useMeterRuntime } from "../runtime/MeterRuntimeContext.jsx";
import { useSource } from "../runtime/SourceContext.jsx";
import { useSourceActions } from "../runtime/SourceActionsContext.jsx";
import { useRuntimeCoordination } from "../runtime/coordination.js";
import { useUiNavigationEnvironment } from "../uiNavigation/UiNavigationContext.jsx";
import { useDevelopmentEventFixtureAdapter } from "../dev/DevelopmentEventFixturesContext.jsx";
import { DEVELOPMENT_CRASH_REPORT } from "../dev/developmentEventFixtureData.js";
import { hideAppWindow, showAppWindow, toggleAppWindow } from "../lib/windowVisibility.js";
import { isTauri } from "../ipc/env.js";
import { useResolvedTheme } from "../theme/useResolvedTheme.js";
import { useSceneGuard } from "./SceneGuardContext.jsx";
import { useWindowChrome } from "./WindowChromeContext.jsx";
import { usePresetLibrary } from "./PresetsContext.jsx";
import { useCrashReportSetting } from "./useCrashReportSetting.js";
import { useCrashReporting } from "./useCrashReporting.js";
import { useUpdateController } from "./useUpdateController.js";
import { useCloseConfirm } from "./useCloseConfirm.js";
import { useInstanceIdentity } from "./useInstanceIdentity.js";
import { useTray } from "./useTray.js";
import { useTrayActions } from "./useTrayActions.js";
import { useAppKeyboardShortcuts } from "./useAppKeyboardShortcuts.js";

const LOCATE_DURATION_MS = 1200;

/**
 * @typedef {{
 *   crashReportSetting: ReturnType<typeof useCrashReportSetting>,
 *   crashReporting: ReturnType<typeof useCrashReporting>,
 *   windowVisible: boolean,
 *   onShowWindow: () => Promise<void>,
 *   onLocateWindow: () => Promise<void>,
 *   trayControl: ReturnType<typeof useTray>,
 *   updateBusy: boolean,
 *   updateControls: ReturnType<typeof useUpdateController>,
 *   requestCloseAction: (action: string, dontAskAgain?: boolean) => Promise<boolean>,
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
  const {
    setSettingsOpen,
    setSettingsSectionRequest,
    keyboardShortcuts,
    shortcutCapturing,
    focusView,
    interfaceSize,
    updatePreferences,
  } = useAppSettings();
  const resolvedTheme = useResolvedTheme();
  const { docked, suspendDockMode, resumeDockMode, exitDockRestoringAttributes } = useDock();
  const { reveal } = useWindowChrome();
  const toggleFocusControls = reveal.toggleControls;
  const { activeBlockingEditors } = useSceneGuard();
  const presets = usePresetLibrary();
  const meterRuntime = useMeterRuntime();
  const {
    running,
    fileTaskBusy,
    stopFileAnalysis,
    stopLiveForCoordination,
    startLiveForControl,
    switchSource,
  } = meterRuntime;
  const {
    audioOutputs,
    audioInputs,
    captureApplications,
    sourceMixes,
    safeAudioDeviceId,
    defaultOutputLabel,
    onSelectCaptureDevice,
    sourceDisplayName,
  } = useSource();
  const { onStartClick, fileImport, fileQueue, canClear, dispatchShortcut } = useSourceActions();

  // Crash-report discovery must outlive the normal-window overlays. A saved Dock posture replaces
  // those overlays with the strip at boot; keeping discovery here lets App restore the main window
  // before presenting the report instead of silently waiting for the user to exit Dock manually.
  const crashReportSetting = useCrashReportSetting();
  const crashReporting = useCrashReporting({ promptEnabled: crashReportSetting.enabled });
  useDevelopmentEventFixtureAdapter("crash-report.pending", {
    establish: (fixtureId) =>
      crashReporting.developmentFixture.establish(fixtureId, DEVELOPMENT_CRASH_REPORT),
    reset: crashReporting.developmentFixture.reset,
    matches: crashReporting.developmentFixture.matches,
    surface: { kind: "crashReport", target: { phase: "decision" } },
  });
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

  const updateControls = useUpdateController({
    preferences: updatePreferences,
    startupEligible:
      !running &&
      meterRuntime.liveLifecycle !== "stopping" &&
      !fileTaskBusy &&
      activeBlockingEditors.length === 0,
  });
  const { installStatus } = updateControls;
  const updateBusy = installStatus === "installing" || installStatus === "restarting";

  const sourceBusy =
    ["starting", "stopping"].includes(meterRuntime.liveLifecycle) ||
    meterRuntime.liveDeviceTransition !== null;
  const trayMixes = sourceMixes?.supported
    ? sourceMixes.list.map(({ id, name }) => ({ id, label: name }))
    : [];
  const publishInstanceState = useInstanceIdentity({
    sourceLabel: sourceDisplayName,
    running,
    trayState: {
      audioOutputs: audioOutputs.map(({ id, label }) => ({ id, label })),
      audioInputs: audioInputs.map(({ id, label }) => ({ id, label })),
      captureApplications: captureApplications.map(({ id, label }) => ({ id, label })),
      sourceMixes: trayMixes,
      safeAudioDeviceId,
      defaultOutputLabel,
      sourceBusy,
      presetList: presets.list.map(({ id, name }) => ({ id, name })),
      presetActiveId: presets.activeId,
      presetDirty: presets.dirty,
      presetsBlocked: presets.blocked,
      updateBusy,
    },
  });

  const syncWindowVisibility = useCallback(
    async (/** @type {ReturnType<typeof getCurrentWindow>} */ window) => {
      setWindowVisible(await window.isVisible());
      await publishInstanceState();
    },
    [publishInstanceState]
  );

  const onHideWindow = useCallback(async () => {
    if (!isTauri()) return;
    const window = getCurrentWindow();
    await hideAppWindow({
      docked,
      window,
      suspendDock: suspendDockMode,
    });
    await syncWindowVisibility(window);
  }, [docked, suspendDockMode, syncWindowVisibility]);

  const onShowWindow = useCallback(async () => {
    if (!isTauri()) return;
    const window = getCurrentWindow();
    await showAppWindow({ docked, window, resumeDock: resumeDockMode });
    await syncWindowVisibility(window);
  }, [docked, resumeDockMode, syncWindowVisibility]);

  const [locatePulse, setLocatePulse] = useState(0);
  const locateTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(locateTimer.current), []);
  const onLocateWindow = useCallback(async () => {
    await onShowWindow();
    window.clearTimeout(locateTimer.current);
    // A new key restarts the animation when Locate is selected again during the cue.
    setLocatePulse((pulse) => pulse + 1);
    locateTimer.current = window.setTimeout(() => setLocatePulse(0), LOCATE_DURATION_MS);
  }, [onShowWindow]);

  const closeConfirm = useCloseConfirm({ onHideWindow, onShowWindow, closeBlocked: updateBusy });
  const {
    dialogOpen: closeDialogOpen,
    closeError,
    closing,
    handleConfirm: handleCloseConfirm,
    handleRetry: handleCloseRetry,
    handleCancel: handleCloseCancel,
    requestCloseAction,
  } = closeConfirm;
  useDevelopmentEventFixtureAdapter("close-confirmation.requested", {
    establish: closeConfirm.developmentFixture.establish,
    reset: closeConfirm.developmentFixture.reset,
    matches: closeConfirm.developmentFixture.matches,
    surface: { kind: "closeConfirmation", target: { phase: "decision" } },
  });

  const onToggleWindow = useCallback(async () => {
    if (!isTauri()) return;
    const window = getCurrentWindow();
    if (await window.isVisible()) {
      return requestCloseAction("tray");
    }
    await toggleAppWindow({
      docked,
      window,
      suspendDock: suspendDockMode,
      resumeDock: resumeDockMode,
    });
    await syncWindowVisibility(window);
  }, [docked, requestCloseAction, resumeDockMode, suspendDockMode, syncWindowVisibility]);

  useEffect(() => {
    if (!docked || !crashReporting.pendingReport) return;
    void exitDockRestoringAttributes();
  }, [crashReporting.pendingReport, docked, exitDockRestoringAttributes]);

  const stopRuntimeForCoordination = useCallback(async () => {
    await stopLiveForCoordination();
    if (fileImport?.importBusy) await fileImport.cancel();
    if (fileQueue?.active) await fileQueue.cancelBatch();
    await stopFileAnalysis();
  }, [fileImport, fileQueue, stopFileAnalysis, stopLiveForCoordination]);
  const startRuntimeAfterCoordination = useCallback(async () => {
    switchSource("live");
    await startLiveForControl();
  }, [startLiveForControl, switchSource]);
  const trayActions = useTrayActions({
    docked,
    onShowWindow,
    exitDockRestoringAttributes,
    setSettingsOpen,
    focusUpdateSettings: () => setSettingsSectionRequest({ section: "about" }),
    updates: updateControls,
    updateBusy,
  });
  useRuntimeCoordination({
    blockingEditors: activeBlockingEditors,
    running: meterRuntime.liveLifecycle === "running",
    measurementBusy:
      running ||
      meterRuntime.liveLifecycle === "stopping" ||
      fileTaskBusy ||
      Boolean(fileImport?.importBusy || fileQueue?.active),
    stop: stopRuntimeForCoordination,
    start: startRuntimeAfterCoordination,
    show: onShowWindow,
    busy: updateBusy,
    actions: {
      locate: onLocateWindow,
      hide: () => requestCloseAction("tray"),
      settings: trayActions.onOpenSettings,
      selectSource: onSelectCaptureDevice,
      applyPreset: presets.apply,
      clearActiveSource: () => dispatchShortcut?.("clear") ?? false,
    },
  });
  const trayControl = useTray({
    ...trayActions,
    running,
    windowVisible,
    onStartClick,
    onToggleWindow,
    onLocateWindow,
    onQuit: () => requestCloseAction("quit"),
    colorScheme: resolvedTheme.colorScheme,
    resolvedTheme,
    interfaceSize,
    updateBusy,
    audioOutputs,
    audioInputs,
    captureApplications,
    sourceMixes: trayMixes,
    safeAudioDeviceId,
    defaultOutputLabel,
    sourceBusy,
    onSelectSource: onSelectCaptureDevice,
    presets,
  });

  useAppKeyboardShortcuts({
    dispatchShortcutAction: dispatchShortcut,
    canClear,
    keyboardShortcuts,
    shortcutCapturing,
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
        onLocateWindow,
        trayControl,
        updateBusy,
        updateControls,
        requestCloseAction,
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
      {locatePulse > 0 && (
        <div
          key={locatePulse}
          aria-hidden="true"
          className={`workbench-locate pointer-events-none fixed inset-0 ${LAYER_INDICATOR}`}
          data-docked={docked ? "" : undefined}
          style={{ animationDuration: `${LOCATE_DURATION_MS}ms` }}
        />
      )}
    </AppLifecycleContext.Provider>
  );
}

export function useAppLifecycle() {
  const lifecycle = useContext(AppLifecycleContext);
  if (!lifecycle) throw new Error("useAppLifecycle must be used inside AppLifecycleProvider");
  return lifecycle;
}
