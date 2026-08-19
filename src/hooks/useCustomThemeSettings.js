import { useState } from "react";
import {
  listCustomThemeDocuments,
  listCustomThemeDocumentsOrdered,
  listCustomThemes,
  removeCustomTheme,
} from "../theme/customThemesRepo.js";
import { BUILTIN_THEMES_V2 } from "../theme/builtinThemesV2.js";
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
    activeTheme:
      BUILTIN_THEMES_V2[themeSettings.resolvedThemeId] ??
      listCustomThemeDocuments()[themeSettings.resolvedThemeId] ??
      BUILTIN_THEMES_V2["plvs-dark"],
    setThemeId: themeSettings.setThemeId,
    setAppearance: themeSettings.setAppearance,
    // pluginStore.subscribe is a no-op, so refresh the list explicitly after editor mutations.
    onChange: () => themeSettings.setCustomThemes(listCustomThemes()),
  });

  const customThemeOptions = listCustomThemeDocumentsOrdered().map((theme) => ({
    id: theme.id,
    label: theme.name,
  }));

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
    const theme = listCustomThemeDocuments()[themeSettings.resolvedThemeId];
    if (theme) editor.beginEdit(theme);
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
