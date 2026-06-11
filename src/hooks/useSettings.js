import { useEffect, useMemo, useState } from "react";
import {
  UI_PREFERENCES,
  applyLayoutToDocument,
  applyThemeToDocument,
  readPersistedShellThemeFields,
  readSystemPrefersDark,
  resolveThemeId,
} from "../uiPreferences";
import { getBuiltinTheme, isThemeId, THEME_SELECT_OPTIONS } from "../theme/builtinThemes.js";
import { useAutostart } from "./useAutostart.js";
import { useGlobalClearShortcut } from "./useGlobalClearShortcut.js";

const CLOSE_ACTION_KEY = "plvs:closeAction";

function normalizeReferenceLufs(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n >= -70 && n <= 0 ? n : -23;
}

export function useSettings({ onClearRef } = {}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [appearance, setAppearance] = useState(
    () => readPersistedShellThemeFields(UI_PREFERENCES).appearance
  );
  const [themeId, setThemeId] = useState(
    () => readPersistedShellThemeFields(UI_PREFERENCES).themeId
  );
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => readSystemPrefersDark());
  const [referenceLufs, setReferenceLufs] = useState(() => {
    try {
      const raw = localStorage.getItem(UI_PREFERENCES.layoutPersistKey);
      if (!raw) return -23;
      const s = JSON.parse(raw);
      return normalizeReferenceLufs(s.referenceLufs);
    } catch (_) {}
    return -23;
  });
  const [closeAction, setCloseActionState] = useState(
    () => localStorage.getItem(CLOSE_ACTION_KEY) ?? "ask"
  );

  const { autostartEnabled, setAutostartEnabled, autostartReady } = useAutostart();
  const globalClear = useGlobalClearShortcut(onClearRef);

  const resolvedThemeId = useMemo(
    () => resolveThemeId({ appearance, themeId }, systemPrefersDark),
    [appearance, themeId, systemPrefersDark]
  );
  const resolvedTheme = useMemo(() => getBuiltinTheme(resolvedThemeId), [resolvedThemeId]);

  /** ADR 0002 §6: switching system → fixed seeds `themeId` from the resolved builtin at that moment. */
  function setAppearanceMode(mode) {
    if (mode === "system") {
      setAppearance("system");
      setThemeId(null);
      return;
    }
    if (appearance === "system") {
      setThemeId(resolveThemeId({ appearance: "system", themeId: null }, systemPrefersDark));
    }
    setAppearance("fixed");
  }

  function setFixedThemeIdFromPicker(id) {
    if (!isThemeId(id)) return;
    setAppearance("fixed");
    setThemeId(id);
  }

  const fixedThemeSelectValue = useMemo(() => {
    if (appearance !== "fixed") return "";
    return isThemeId(themeId) ? themeId : resolvedThemeId;
  }, [appearance, themeId, resolvedThemeId]);

  function setCloseAction(value) {
    if (value === "ask") {
      localStorage.removeItem(CLOSE_ACTION_KEY);
    } else {
      localStorage.setItem(CLOSE_ACTION_KEY, value);
    }
    setCloseActionState(value);
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
    resolvedThemeId,
    themeSelectOptions: THEME_SELECT_OPTIONS,
    setAppearanceMode,
    setFixedThemeIdFromPicker,
    fixedThemeSelectValue,
    referenceLufs,
    setReferenceLufs,
    closeAction,
    setCloseAction,
    autostartEnabled,
    setAutostartEnabled,
    autostartReady,
    ...globalClear,
  };
}
