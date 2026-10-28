import { useCallback, useLayoutEffect, useRef } from "react";

/** Tray navigation reuses the existing Settings and update surfaces, including Dock accessories. */
export function useTrayActions({
  docked,
  onShowWindow,
  exitDockRestoringAttributes,
  setSettingsOpen,
  focusUpdateSettings,
  updates,
  updateBusy,
}) {
  const busyRef = useRef(updateBusy);
  useLayoutEffect(() => {
    busyRef.current = updateBusy;
  }, [updateBusy]);
  const onOpenSettings = useCallback(async () => {
    if (busyRef.current) return false;
    await onShowWindow();
    if (busyRef.current) return false;
    if (docked) {
      const result = await exitDockRestoringAttributes();
      if (!result.ok) return false;
    }
    if (busyRef.current) return false;
    setSettingsOpen(true);
    return true;
  }, [docked, onShowWindow, exitDockRestoringAttributes, setSettingsOpen]);

  const onOpenUpdate = useCallback(async () => {
    if (updateBusy || !updates.enabled) return;
    if (updates.updateInfo.hasUpdate) {
      await onShowWindow();
      updates.openDetails();
    } else if (updates.checkStatus !== "checking" && (await onOpenSettings())) {
      // Settings provides visible success/error feedback even when no candidate is returned.
      focusUpdateSettings();
      await updates.refreshUpdateCheck();
    }
  }, [focusUpdateSettings, onOpenSettings, onShowWindow, updateBusy, updates]);

  let text = "Check for Updates…";
  if (updateBusy) {
    text = updates.installStatus === "restarting" ? "Restarting…" : "Installing Update…";
  } else if (updates.ready) {
    text = `Update Ready: v${updates.ready.version}…`;
  } else if (updates.downloading) {
    text = "Downloading Update…";
  } else if (updates.updateInfo.hasUpdate) {
    text = `Update Available: v${updates.updateInfo.latestVersion}…`;
  } else if (updates.checkStatus === "checking") {
    text = "Checking for Updates…";
  } else if (updates.checkStatus === "unavailable") {
    text = "Retry Update Check…";
  }

  return {
    onOpenSettings,
    updateMenu: updates.enabled
      ? {
          text,
          enabled:
            !updateBusy && (updates.updateInfo.hasUpdate || updates.checkStatus !== "checking"),
          action: onOpenUpdate,
        }
      : null,
  };
}
