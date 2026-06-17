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
import { useClearShortcut } from "./useClearShortcut.js";
import { settingsStore } from "../persistence/index.js";

function normalizeReferenceLufs(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n >= -70 && n <= 0 ? n : -23;
}

export function useSettings({ onClearRef } = {}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [appearance, setAppearance] = useState(() => readPersistedShellThemeFields().appearance);
  const [themeId, setThemeId] = useState(() => readPersistedShellThemeFields().themeId);
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => readSystemPrefersDark());
  const [referenceLufs, setReferenceLufs] = useState(() =>
    normalizeReferenceLufs(settingsStore.read().referenceLufs)
  );
  const [closeAction, setCloseActionState] = useState(
    () => settingsStore.read().closeAction ?? "ask"
  );

  const { autostartEnabled, setAutostartEnabled, autostartReady } = useAutostart();
  const clearShortcutState = useClearShortcut(onClearRef);

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
      const { closeAction: _drop, ...rest } = settingsStore.read();
      settingsStore.reset();
      settingsStore.patch(rest);
    } else {
      settingsStore.patch({ closeAction: value });
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

  useEffect(
    () =>
      settingsStore.subscribe(() => {
        const next = readPersistedShellThemeFields();
        setAppearance(next.appearance);
        setThemeId(next.themeId);
      }),
    []
  );

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
    ...clearShortcutState,
  };
}
