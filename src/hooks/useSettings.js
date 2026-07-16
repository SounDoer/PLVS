import { useState } from "react";
import { useThemeSettings } from "./useThemeSettings.js";
import { useCustomThemeSettings } from "./useCustomThemeSettings.js";
import { useAutostart } from "./useAutostart.js";
import { useClearShortcut } from "./useClearShortcut.js";
import { useCloseActionSetting } from "./useCloseActionSetting.js";
import { useHistoryRetentionSetting } from "./useHistoryRetentionSetting.js";
import { useInterfaceSizeSetting } from "./useInterfaceSizeSetting.js";
import { useMeterSettings } from "./useMeterSettings.js";
import { useViewSettings } from "./useViewSettings.js";

export function useSettings({ onClearRef } = {}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { autostartEnabled, setAutostartEnabled, autostartReady } = useAutostart();
  const clearShortcutState = useClearShortcut(onClearRef);
  const themeSettings = useThemeSettings();
  const customThemeSettings = useCustomThemeSettings({ themeSettings, setSettingsOpen });
  const closeActionSetting = useCloseActionSetting();
  const historyRetentionSetting = useHistoryRetentionSetting();
  const interfaceSizeSetting = useInterfaceSizeSetting();
  const meterSettings = useMeterSettings();
  const viewSettings = useViewSettings();

  return {
    settingsOpen,
    setSettingsOpen,
    appearance: themeSettings.appearance,
    setAppearance: themeSettings.setAppearance,
    themeId: themeSettings.themeId,
    setThemeId: themeSettings.setThemeId,
    resolvedThemeId: themeSettings.resolvedThemeId,
    themeSelectOptions: themeSettings.themeSelectOptions,
    setAppearanceMode: themeSettings.setAppearanceMode,
    setFixedThemeIdFromPicker: themeSettings.setFixedThemeIdFromPicker,
    fixedThemeSelectValue: themeSettings.fixedThemeSelectValue,
    ...meterSettings,
    ...closeActionSetting,
    ...historyRetentionSetting,
    ...interfaceSizeSetting,
    ...viewSettings,
    autostartEnabled,
    setAutostartEnabled,
    autostartReady,
    ...customThemeSettings,
    ...clearShortcutState,
  };
}
