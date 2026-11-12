import { useCallback, useEffect, useState } from "react";
import { useThemeSettings } from "./useThemeSettings.js";
import { useCustomThemeSettings } from "./useCustomThemeSettings.js";
import { useAutostart } from "./useAutostart.js";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts.js";
import { useCloseActionSetting } from "./useCloseActionSetting.js";
import { useDialogueVadEngineSetting } from "./useDialogueVadEngineSetting.js";
import { useHistoryRetentionSetting } from "./useHistoryRetentionSetting.js";
import { useInterfaceSizeSetting } from "./useInterfaceSizeSetting.js";
import { useMeterSettings } from "./useMeterSettings.js";
import { useViewSettings } from "./useViewSettings.js";
import { useWindowPinnedSetting } from "./useWindowPinnedSetting.js";
import { useUpdatePreferences } from "./useUpdatePreferences.js";
import { useFileSummaryMetrics } from "./useFileSummaryMetrics.js";
import { settingsStore } from "../persistence/index.js";

const readFileDialogueDetection = () => settingsStore.read().fileDialogueDetection === true;

/** @param {{ shortcutActionRef?: { current: any }, onHistoryRetentionChangeRef?: { current: any } }} [options] */
export function useSettings({ shortcutActionRef, onHistoryRetentionChangeRef } = {}) {
  const [settingsOpen, setOpen] = useState(false);
  const [settingsOpenEpoch, setOpenEpoch] = useState(0);
  const setSettingsOpen = useCallback((open) => {
    setOpen(open);
    if (open === true) setOpenEpoch((value) => value + 1);
  }, []);
  const [settingsSectionRequest, setSettingsSectionRequest] = useState(
    /** @type {{ section: string } | null} */ (null)
  );
  const { autostartEnabled, setAutostartEnabled, setAutostartEnabledForControl, autostartReady } =
    useAutostart();
  const shortcutState = useKeyboardShortcuts(shortcutActionRef);
  const themeSettings = useThemeSettings();
  const customThemeSettings = useCustomThemeSettings({ themeSettings, setSettingsOpen });
  const closeActionSetting = useCloseActionSetting();
  const dialogueVadEngineSetting = useDialogueVadEngineSetting();
  const historyRetentionSetting = useHistoryRetentionSetting({
    onChangeRef: onHistoryRetentionChangeRef,
  });
  const interfaceSizeSetting = useInterfaceSizeSetting();
  const meterSettings = useMeterSettings();
  const viewSettings = useViewSettings();
  const windowPinnedSetting = useWindowPinnedSetting();
  const updatePreferences = useUpdatePreferences();
  const fileSummary = useFileSummaryMetrics();
  const [fileDialogueDetection, setFileDialogueDetectionState] =
    useState(readFileDialogueDetection);
  useEffect(
    () => settingsStore.subscribe(() => setFileDialogueDetectionState(readFileDialogueDetection())),
    []
  );
  const setFileDialogueDetection = (enabled) => {
    settingsStore.patch({ fileDialogueDetection: enabled });
    setFileDialogueDetectionState(enabled);
  };

  return {
    settingsOpen,
    settingsOpenEpoch,
    setSettingsOpen,
    settingsSectionRequest,
    setSettingsSectionRequest,
    appearance: themeSettings.appearance,
    setAppearance: themeSettings.setAppearance,
    themeId: themeSettings.themeId,
    setThemeId: themeSettings.setThemeId,
    resolvedThemeId: themeSettings.resolvedThemeId,
    resolvedTheme: themeSettings.resolvedTheme,
    setAppearanceMode: customThemeSettings.setAppearanceMode,
    setFixedThemeIdFromPicker: customThemeSettings.selectThemeId,
    fixedThemeSelectValue: themeSettings.fixedThemeSelectValue,
    customThemes: themeSettings.customThemes,
    ...meterSettings,
    ...closeActionSetting,
    ...dialogueVadEngineSetting,
    ...historyRetentionSetting,
    ...interfaceSizeSetting,
    ...viewSettings,
    ...windowPinnedSetting,
    ...updatePreferences,
    ...fileSummary,
    fileDialogueDetection,
    setFileDialogueDetection,
    autostartEnabled,
    setAutostartEnabled,
    setAutostartEnabledForControl,
    autostartReady,
    ...customThemeSettings,
    ...shortcutState,
  };
}
