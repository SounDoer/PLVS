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
import {
  listCustomThemes,
  listCustomThemesOrdered,
  removeCustomTheme,
} from "../theme/customThemesRepo.js";
import { getTheme, isKnownThemeId } from "../theme/themeRegistry.js";
import { isCustomThemeId } from "../theme/customTheme.js";
import { useThemeEditor } from "./useThemeEditor.js";
import { useAutostart } from "./useAutostart.js";
import { useClearShortcut } from "./useClearShortcut.js";
import { normalizeFocusView } from "../lib/focusView.js";
import { presetsStore, settingsStore, themesStore } from "../persistence/index.js";

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
  const [focusView, setFocusViewState] = useState(() =>
    normalizeFocusView(settingsStore.read().focusView)
  );

  const { autostartEnabled, setAutostartEnabled, autostartReady } = useAutostart();
  const clearShortcutState = useClearShortcut(onClearRef);

  const [customThemes, setCustomThemes] = useState(() => listCustomThemes());
  const [editorPos, setEditorPos] = useState(
    () => settingsStore.read().themeEditorPos ?? { x: 80, y: 80 }
  );

  const resolvedThemeId = useMemo(
    () => resolveThemeId({ appearance, themeId }, systemPrefersDark, customThemes),
    [appearance, themeId, systemPrefersDark, customThemes]
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

  function setFocusView(nextFocusView) {
    const next = normalizeFocusView(nextFocusView);
    settingsStore.patch({ focusView: next });
    presetsStore.patch({ activeId: null });
    setFocusViewState(next);
  }

  function setAutoHideControls(value) {
    setFocusView({ ...focusView, autoHideControls: value === true });
  }

  function setCompactPanels(value) {
    setFocusView({ ...focusView, compactPanels: value === true });
  }

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

  useEffect(
    () =>
      settingsStore.subscribe(() => {
        const next = readPersistedShellThemeFields();
        setAppearance(next.appearance);
        setThemeId(next.themeId);
        setFocusViewState(normalizeFocusView(settingsStore.read().focusView));
      }),
    []
  );

  useEffect(() => themesStore.subscribe(() => setCustomThemes(listCustomThemes())), []);

  function moveEditor(pos) {
    setEditorPos(pos);
    settingsStore.patch({ themeEditorPos: pos });
  }

  const editor = useThemeEditor({
    activeTheme: getTheme(resolvedThemeId, customThemes),
    customThemes,
    prevSelection: { appearance, themeId },
    setThemeId,
    setAppearance,
  });

  const customThemeOptions = useMemo(
    () => listCustomThemesOrdered().map((t) => ({ id: t.id, label: t.name })),
    [customThemes]
  );

  function selectThemeId(id) {
    setAppearance("fixed");
    setThemeId(id);
  }
  function createCustomTheme() {
    setSettingsOpen(false);
    editor.beginCreate(`${getTheme(resolvedThemeId, customThemes).label ?? "Theme"} copy`);
  }
  function editActiveCustomTheme() {
    if (!isCustomThemeId(resolvedThemeId)) return;
    setSettingsOpen(false);
    editor.beginEdit(getTheme(resolvedThemeId, customThemes));
  }
  function deleteCustomTheme(id) {
    removeCustomTheme(id);
    setCustomThemes(listCustomThemes());
    if (themeId === id) selectThemeId("plvs-dark");
  }

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
    focusView,
    setFocusView,
    setAutoHideControls,
    setCompactPanels,
    autostartEnabled,
    setAutostartEnabled,
    autostartReady,
    editor,
    editorPos,
    moveEditor,
    customThemeOptions,
    createCustomTheme,
    editActiveCustomTheme,
    deleteCustomTheme,
    activeIsCustom: isCustomThemeId(resolvedThemeId),
    ...clearShortcutState,
  };
}
