import { useState } from "react";
import {
  listCustomThemes,
  listCustomThemesOrdered,
  removeCustomTheme,
} from "../theme/customThemesRepo.js";
import { getTheme } from "../theme/themeRegistry.js";
import { isCustomThemeId } from "../theme/customTheme.js";
import { settingsStore } from "../persistence/index.js";
import { normalizeThemeEditorPos } from "../settings/defaults.js";
import { useThemeEditor } from "./useThemeEditor.js";

export function useCustomThemeSettings({ themeSettings, setSettingsOpen }) {
  const [editorPos, setEditorPos] = useState(() =>
    normalizeThemeEditorPos(settingsStore.read().themeEditorPos)
  );

  function moveEditor(pos) {
    const next = normalizeThemeEditorPos(pos);
    setEditorPos(next);
    settingsStore.patch({ themeEditorPos: next });
  }

  const editor = useThemeEditor({
    activeTheme: getTheme(themeSettings.resolvedThemeId, themeSettings.customThemes),
    customThemes: themeSettings.customThemes,
    prevSelection: { appearance: themeSettings.appearance, themeId: themeSettings.themeId },
    setThemeId: themeSettings.setThemeId,
    setAppearance: themeSettings.setAppearance,
    // pluginStore.subscribe is a no-op, so refresh the list explicitly after editor mutations.
    onChange: () => themeSettings.setCustomThemes(listCustomThemes()),
  });

  const customThemeOptions = listCustomThemesOrdered().map((t) => ({ id: t.id, label: t.name }));

  function selectThemeId(id) {
    themeSettings.setAppearance("fixed");
    themeSettings.setThemeId(id);
  }

  function createCustomTheme() {
    setSettingsOpen(false);
    editor.beginCreate("Custom");
  }

  function editActiveCustomTheme() {
    if (!isCustomThemeId(themeSettings.resolvedThemeId)) return;
    setSettingsOpen(false);
    editor.beginEdit(getTheme(themeSettings.resolvedThemeId, themeSettings.customThemes));
  }

  function deleteCustomTheme(id) {
    removeCustomTheme(id);
    themeSettings.setCustomThemes(listCustomThemes());
    if (themeSettings.themeId === id) selectThemeId("plvs-dark");
  }

  return {
    editor,
    editorPos,
    moveEditor,
    customThemeOptions,
    createCustomTheme,
    editActiveCustomTheme,
    deleteCustomTheme,
    activeIsCustom: isCustomThemeId(themeSettings.resolvedThemeId),
  };
}
