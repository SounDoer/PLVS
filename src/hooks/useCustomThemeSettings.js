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
import { useBlockingEditor } from "./BlockingEditorsContext.jsx";

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

  // A blocking editor: its draft is published as a live preview, and a preset apply or a dock
  // entry would close the panel and take the unsaved theme with it.
  useBlockingEditor("theme", editor.isEditing);

  const customThemeOptions = listCustomThemeDocumentsOrdered().map((theme) => ({
    id: theme.id,
    label: theme.name,
    theme,
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
    editCustomTheme(themeSettings.resolvedThemeId);
  }

  function editCustomTheme(id) {
    if (!isCustomThemeId(id)) return;
    setSettingsOpen(false);
    const theme = listCustomThemeDocuments()[id];
    if (theme) editor.beginEdit(theme);
  }

  function customizeBuiltinTheme(id) {
    const theme = BUILTIN_THEMES_V2[id];
    if (!theme) return;
    setSettingsOpen(false);
    editor.beginCreate(`${theme.name} Custom`, theme);
  }

  function duplicateCustomTheme(id) {
    const theme = listCustomThemeDocuments()[id];
    if (!theme) return;
    setSettingsOpen(false);
    editor.beginCreate(`${theme.name} Copy`, theme);
  }

  function deleteCustomTheme(id) {
    const deleted = listCustomThemeDocuments()[id];
    removeCustomTheme(id);
    themeSettings.setCustomThemes(listCustomThemes());
    if (themeSettings.themeId === id) {
      selectThemeId(deleted?.colorScheme === "light" ? "plvs-light" : "plvs-dark");
    }
  }

  return {
    editor,
    editorPos,
    moveEditor,
    customThemeOptions,
    createCustomTheme,
    editActiveCustomTheme,
    editCustomTheme,
    customizeBuiltinTheme,
    duplicateCustomTheme,
    deleteCustomTheme,
    activeIsCustom: isCustomThemeId(themeSettings.resolvedThemeId),
  };
}
