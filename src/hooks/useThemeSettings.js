import { useEffect, useMemo, useState } from "react";
import {
  UI_PREFERENCES,
  applyLayoutToDocument,
  applyThemeToDocument,
  readPersistedShellThemeFields,
  readSystemPrefersDark,
  resolveThemeId,
} from "../uiPreferences";
import { THEME_SELECT_OPTIONS } from "../theme/builtinThemes.js";
import { listCustomThemes } from "../theme/customThemesRepo.js";
import { isKnownThemeId } from "../theme/themeRegistry.js";
import { settingsStore, themesStore } from "../persistence/index.js";

export function useThemeSettings() {
  const [appearance, setAppearanceState] = useState(
    () => readPersistedShellThemeFields().appearance
  );
  const [themeId, setThemeIdState] = useState(() => readPersistedShellThemeFields().themeId);
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => readSystemPrefersDark());
  const [customThemes, setCustomThemes] = useState(() => listCustomThemes());

  const resolvedThemeId = useMemo(
    () => resolveThemeId({ appearance, themeId }, systemPrefersDark, customThemes),
    [appearance, themeId, systemPrefersDark, customThemes]
  );

  function setAppearance(nextAppearance) {
    const next = nextAppearance === "fixed" ? "fixed" : "system";
    setAppearanceState(next);
    if (next === "system") setThemeIdState(null);
  }

  function setThemeId(nextThemeId) {
    setThemeIdState(nextThemeId == null || nextThemeId === "" ? null : String(nextThemeId));
  }

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
    if (!isKnownThemeId(id, customThemes)) return;
    setAppearance("fixed");
    setThemeId(id);
  }

  const fixedThemeSelectValue = useMemo(() => {
    if (appearance !== "fixed") return "";
    return isKnownThemeId(themeId, customThemes) ? themeId : resolvedThemeId;
  }, [appearance, themeId, resolvedThemeId, customThemes]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemPrefersDark(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    applyLayoutToDocument(UI_PREFERENCES);
    applyThemeToDocument(resolvedThemeId, customThemes);
  }, [resolvedThemeId, customThemes]);

  useEffect(() => {
    settingsStore.patch({
      appearance,
      themeId: appearance === "system" ? null : fixedThemeSelectValue,
    });
  }, [appearance, fixedThemeSelectValue]);

  useEffect(
    () =>
      settingsStore.subscribe(() => {
        const next = readPersistedShellThemeFields();
        setAppearanceState(next.appearance);
        setThemeIdState(next.themeId);
      }),
    []
  );

  useEffect(() => themesStore.subscribe(() => setCustomThemes(listCustomThemes())), []);

  return {
    appearance,
    setAppearance,
    themeId,
    setThemeId,
    resolvedThemeId,
    themeSelectOptions: THEME_SELECT_OPTIONS,
    setAppearanceMode,
    setFixedThemeIdFromPicker,
    fixedThemeSelectValue,
    customThemes,
    setCustomThemes,
  };
}
