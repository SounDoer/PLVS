import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyThemeToDocument,
  readPersistedShellThemeFields,
  readSystemPrefersDark,
  resolveThemeId,
} from "../uiPreferences";
import { listCustomThemes } from "../theme/customThemesRepo.js";
import { getTheme, isKnownThemeId } from "../theme/themeRegistry.js";
import { settingsStore, themesStore } from "../persistence/index.js";

export function useThemeSettings() {
  const [appearance, setAppearanceState] = useState(
    () => readPersistedShellThemeFields().appearance
  );
  const [themeId, setThemeIdState] = useState(() => readPersistedShellThemeFields().themeId);
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => readSystemPrefersDark());
  const [customThemes, setCustomThemes] = useState(() => listCustomThemes());
  const appearanceRef = useRef(appearance);
  const themeIdRef = useRef(themeId);
  const systemPrefersDarkRef = useRef(systemPrefersDark);
  const customThemesRef = useRef(customThemes);

  const resolvedThemeId = useMemo(
    () => resolveThemeId({ appearance, themeId }, systemPrefersDark, customThemes),
    [appearance, themeId, systemPrefersDark, customThemes]
  );
  const resolvedTheme = useMemo(
    () => getTheme(resolvedThemeId, customThemes),
    [resolvedThemeId, customThemes]
  );

  function setAppearance(nextAppearance) {
    const next = nextAppearance === "fixed" ? "fixed" : "system";
    appearanceRef.current = next;
    setAppearanceState(next);
    if (next === "system") {
      themeIdRef.current = null;
      setThemeIdState(null);
    }
  }

  function setThemeId(nextThemeId) {
    const next = nextThemeId == null || nextThemeId === "" ? null : String(nextThemeId);
    themeIdRef.current = next;
    setThemeIdState(next);
  }

  const setCustomThemesFromController = useCallback((documents) => {
    const next = Object.fromEntries(documents.map((theme) => [theme.id, theme]));
    customThemesRef.current = next;
    setCustomThemes(next);
  }, []);

  const readAppearanceForControl = useCallback(() => {
    const mode = appearanceRef.current;
    const selectedThemeId = mode === "fixed" ? themeIdRef.current : null;
    return {
      mode,
      selectedThemeId,
      resolvedThemeId: resolveThemeId(
        { appearance: mode, themeId: selectedThemeId },
        systemPrefersDarkRef.current,
        customThemesRef.current
      ),
    };
  }, []);

  const applyAppearanceForControl = useCallback((next) => {
    appearanceRef.current = next.mode;
    themeIdRef.current = next.mode === "fixed" ? next.selectedThemeId : null;
    setAppearanceState(appearanceRef.current);
    setThemeIdState(themeIdRef.current);
  }, []);

  const resolvedSystemThemeIdForControl = useCallback(
    () => (systemPrefersDarkRef.current ? "plvs-dark" : "plvs-light"),
    []
  );

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
    const onChange = () => {
      systemPrefersDarkRef.current = mq.matches;
      setSystemPrefersDark(mq.matches);
    };
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
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
        appearanceRef.current = next.appearance;
        themeIdRef.current = next.themeId;
        setAppearanceState(next.appearance);
        setThemeIdState(next.themeId);
      }),
    []
  );

  useEffect(
    () =>
      themesStore.subscribe(() => {
        const next = listCustomThemes();
        customThemesRef.current = next;
        setCustomThemes(next);
      }),
    []
  );

  return {
    appearance,
    setAppearance,
    themeId,
    setThemeId,
    resolvedThemeId,
    resolvedTheme,
    setAppearanceMode,
    setFixedThemeIdFromPicker,
    fixedThemeSelectValue,
    customThemes,
    setCustomThemes,
    setCustomThemesFromController,
    readAppearanceForControl,
    applyAppearanceForControl,
    resolvedSystemThemeIdForControl,
  };
}
