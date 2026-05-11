import { useEffect, useMemo, useState } from "react";
import {
  UI_PREFERENCES,
  applyLayoutToDocument,
  applyThemeToDocument,
  readPersistedShellThemeFields,
  readSystemPrefersDark,
  resolveThemeId,
} from "../uiPreferences";
import { getBuiltinTheme } from "../theme/builtinThemes.js";
import { getDefaultLoudnessReferenceProfileId, normalizeLoudnessReferenceProfileId } from "../loudnessReferenceProfiles";

export function useSettings() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [appearance, setAppearance] = useState(() => readPersistedShellThemeFields(UI_PREFERENCES).appearance);
  const [themeId, setThemeId] = useState(() => readPersistedShellThemeFields(UI_PREFERENCES).themeId);
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => readSystemPrefersDark());
  const [referenceProfileId, setReferenceProfileId] = useState(() => {
    try {
      const raw = localStorage.getItem(UI_PREFERENCES.layoutPersistKey);
      if (!raw) return getDefaultLoudnessReferenceProfileId();
      const s = JSON.parse(raw);
      return normalizeLoudnessReferenceProfileId(s.referenceProfileId);
    } catch (_) {}
    return getDefaultLoudnessReferenceProfileId();
  });

  const resolvedThemeId = useMemo(
    () => resolveThemeId({ appearance, themeId }, systemPrefersDark),
    [appearance, themeId, systemPrefersDark]
  );
  const resolvedTheme = useMemo(() => getBuiltinTheme(resolvedThemeId), [resolvedThemeId]);
  const uiThemeSelection = useMemo(() => {
    if (appearance === "system") return "system";
    if (themeId === "audiometer-light") return "light";
    return "dark";
  }, [appearance, themeId]);

  function setUiThemeSelection(value) {
    if (value === "system") {
      setAppearance("system");
      setThemeId(null);
      return;
    }
    setAppearance("fixed");
    setThemeId(value === "light" ? "audiometer-light" : "audiometer-dark");
  }

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemPrefersDark(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    applyLayoutToDocument(UI_PREFERENCES, { colorScheme: resolvedTheme.colorScheme });
    applyThemeToDocument(resolvedThemeId);
  }, [resolvedThemeId, resolvedTheme.colorScheme]);

  useEffect(() => {
    const key = UI_PREFERENCES.layoutPersistKey;
    const onStorage = (e) => {
      if (e.key !== key && e.key !== null) return;
      const next = readPersistedShellThemeFields(UI_PREFERENCES);
      setAppearance(next.appearance);
      setThemeId(next.themeId);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return {
    settingsOpen,
    setSettingsOpen,
    appearance,
    setAppearance,
    themeId,
    setThemeId,
    /** Resolved builtin theme id (follows OS when `appearance === "system"`). */
    resolvedThemeId,
    /** Settings UI value for the theme `<Select>`. */
    uiThemeSelection,
    setUiThemeSelection,
    referenceProfileId,
    setReferenceProfileId,
  };
}
