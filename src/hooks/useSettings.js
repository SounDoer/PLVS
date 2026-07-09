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
import { useViewSettings } from "./useViewSettings.js";
import { settingsStore, themesStore } from "../persistence/index.js";
import { sanitizeChannelLabelOverrides } from "../math/channelRoles.js";
import {
  DEFAULT_CLOSE_ACTION,
  normalizeCloseAction,
  normalizeReferenceLufs,
  normalizeThemeEditorPos,
} from "../settings/defaults.js";

export function useSettings({ onClearRef } = {}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [appearance, setAppearanceState] = useState(
    () => readPersistedShellThemeFields().appearance
  );
  const [themeId, setThemeIdState] = useState(() => readPersistedShellThemeFields().themeId);
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => readSystemPrefersDark());
  const [referenceLufs, setReferenceLufsState] = useState(() =>
    normalizeReferenceLufs(settingsStore.read().referenceLufs)
  );
  const [closeAction, setCloseActionState] = useState(() =>
    normalizeCloseAction(settingsStore.read().closeAction)
  );
  const [channelLabelOverrides, setChannelLabelOverridesState] = useState(() =>
    sanitizeChannelLabelOverrides(settingsStore.read().channelLabelOverrides)
  );

  const { autostartEnabled, setAutostartEnabled, autostartReady } = useAutostart();
  const clearShortcutState = useClearShortcut(onClearRef);
  const viewSettings = useViewSettings();

  const [customThemes, setCustomThemes] = useState(() => listCustomThemes());
  const [editorPos, setEditorPos] = useState(() =>
    normalizeThemeEditorPos(settingsStore.read().themeEditorPos)
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

  function setAppearance(nextAppearance) {
    const next = nextAppearance === "fixed" ? "fixed" : "system";
    setAppearanceState(next);
    if (next === "system") setThemeIdState(null);
  }

  function setThemeId(nextThemeId) {
    setThemeIdState(nextThemeId == null || nextThemeId === "" ? null : String(nextThemeId));
  }

  function setReferenceLufs(nextReferenceLufs) {
    setReferenceLufsState(normalizeReferenceLufs(nextReferenceLufs));
  }

  function setChannelLabelOverrides(nextOverrides) {
    setChannelLabelOverridesState((prev) =>
      sanitizeChannelLabelOverrides(
        typeof nextOverrides === "function" ? nextOverrides(prev) : nextOverrides
      )
    );
  }

  function setCloseAction(value) {
    const next = normalizeCloseAction(value);
    if (next === DEFAULT_CLOSE_ACTION) {
      const { closeAction: _drop, ...rest } = settingsStore.read();
      settingsStore.reset();
      settingsStore.patch(rest);
    } else {
      settingsStore.patch({ closeAction: next });
    }
    setCloseActionState(next);
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

  useEffect(() => {
    settingsStore.patch({
      referenceLufs,
      appearance,
      themeId: appearance === "system" ? null : fixedThemeSelectValue,
      channelLabelOverrides,
    });
  }, [referenceLufs, appearance, fixedThemeSelectValue, channelLabelOverrides]);

  useEffect(
    () =>
      settingsStore.subscribe(() => {
        const next = readPersistedShellThemeFields();
        setAppearanceState(next.appearance);
        setThemeIdState(next.themeId);
        setReferenceLufsState(normalizeReferenceLufs(settingsStore.read().referenceLufs));
        setChannelLabelOverridesState(
          sanitizeChannelLabelOverrides(settingsStore.read().channelLabelOverrides)
        );
      }),
    []
  );

  useEffect(() => themesStore.subscribe(() => setCustomThemes(listCustomThemes())), []);

  function moveEditor(pos) {
    const next = normalizeThemeEditorPos(pos);
    setEditorPos(next);
    settingsStore.patch({ themeEditorPos: next });
  }

  const editor = useThemeEditor({
    activeTheme: getTheme(resolvedThemeId, customThemes),
    customThemes,
    prevSelection: { appearance, themeId },
    setThemeId,
    setAppearance,
    // pluginStore.subscribe is a no-op, so refresh the list explicitly after editor mutations.
    onChange: () => setCustomThemes(listCustomThemes()),
  });

  const customThemeOptions = listCustomThemesOrdered().map((t) => ({ id: t.id, label: t.name }));

  function selectThemeId(id) {
    setAppearance("fixed");
    setThemeId(id);
  }
  function createCustomTheme() {
    setSettingsOpen(false);
    editor.beginCreate("Custom");
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
    channelLabelOverrides,
    setChannelLabelOverrides,
    closeAction,
    setCloseAction,
    ...viewSettings,
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
