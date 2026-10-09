import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SceneOperationBlockedError } from "../lib/sceneOperations.js";
import { reportLibraryConflict, settingsStore } from "../persistence/index.js";
import { BUILTIN_THEMES_V2 } from "../theme/builtinThemesV2.js";
import { isCustomThemeId } from "../theme/customTheme.js";
import {
  listCustomThemeDocuments,
  listCustomThemeDocumentsOrdered,
  replaceCustomThemesOrdered,
} from "../theme/customThemesRepo.js";
import {
  planThemeCreate,
  planThemeDelete,
  planThemeDuplicate,
  planThemeFollowSystem,
  planThemeRename,
  planThemeReorder,
  planThemeSelect,
  planThemeUpdate,
} from "../theme/themeLibrary.js";
import { normalizeThemeEditorPos } from "../settings/defaults.js";
import { useBlockingEditor } from "./BlockingEditorsContext.jsx";
import { useThemeEditor } from "./useThemeEditor.js";

const makeThemeId = () => `custom-${crypto.randomUUID()}`;

export function useCustomThemeSettings({ themeSettings, setSettingsOpen, makeId = makeThemeId }) {
  const [editorPos, setEditorPos] = useState(() =>
    normalizeThemeEditorPos(settingsStore.read().themeEditorPos)
  );
  const editorRef = useRef(null);

  function moveEditor(pos) {
    const next = normalizeThemeEditorPos(pos);
    setEditorPos(next);
    settingsStore.patch({ themeEditorPos: next });
  }

  const readState = useCallback(
    () => ({
      appearance: themeSettings.readAppearanceForControl(),
      themes: listCustomThemeDocumentsOrdered(),
    }),
    [themeSettings]
  );

  const commitPlan = useCallback(
    (planned) => {
      if (!planned || planned.issues?.length > 0 || planned.changed?.length === 0) return planned;
      const current = readState();
      if (JSON.stringify(planned.state.themes) !== JSON.stringify(current.themes)) {
        replaceCustomThemesOrdered(planned.state.themes);
        themeSettings.setCustomThemesFromController(planned.state.themes);
      }
      if (JSON.stringify(planned.state.appearance) !== JSON.stringify(current.appearance)) {
        themeSettings.applyAppearanceForControl(planned.state.appearance);
      }
      return planned;
    },
    [readState, themeSettings]
  );

  const assertAllowed = useCallback((/** @type {string} */ operation) => {
    if (editorRef.current?.isEditingNow()) {
      throw new SceneOperationBlockedError(operation, ["theme"]);
    }
  }, []);

  const planSelect = useCallback(
    (/** @type {string} */ id) => planThemeSelect(readState(), id),
    [readState]
  );
  const planFollowSystem = useCallback(
    () => planThemeFollowSystem(readState(), themeSettings.resolvedSystemThemeIdForControl()),
    [readState, themeSettings]
  );
  const planCreate = useCallback(
    (document, options) => planThemeCreate(readState(), document, options),
    [readState]
  );
  const planUpdate = useCallback(
    (/** @type {string} */ id, document) => planThemeUpdate(readState(), id, document),
    [readState]
  );
  const planRename = useCallback(
    (/** @type {string} */ id, /** @type {string} */ name) =>
      planThemeRename(readState(), id, name),
    [readState]
  );
  const planDuplicate = useCallback(
    (/** @type {string} */ id, /** @type {string} */ name, options) =>
      planThemeDuplicate(readState(), id, name, options),
    [readState]
  );
  const planDelete = useCallback(
    (/** @type {string} */ id) => planThemeDelete(readState(), id),
    [readState]
  );
  const planReorder = useCallback((ids) => planThemeReorder(readState(), ids), [readState]);

  const runBlocked = useCallback(
    (operation, plan) => {
      assertAllowed(operation);
      return commitPlan(plan());
    },
    [assertAllowed, commitPlan]
  );

  const control = useMemo(
    () => ({
      readState,
      assertAllowed,
      planSelect,
      planFollowSystem,
      planCreate,
      planUpdate,
      planRename,
      planDuplicate,
      planDelete,
      planReorder,
      commit: commitPlan,
      select: (id) => runBlocked("theme.select", () => planSelect(id)),
      followSystem: () => runBlocked("theme.followSystem", planFollowSystem),
      create: (document, { makeId: createId = makeId } = {}) =>
        runBlocked("theme.create", () => planCreate(document, { makeId: createId })),
      update: (id, document) => runBlocked("theme.update", () => planUpdate(id, document)),
      rename: (id, name) => runBlocked("theme.rename", () => planRename(id, name)),
      duplicate: (id, name, { makeId: duplicateId = makeId } = {}) =>
        runBlocked("theme.duplicate", () => planDuplicate(id, name, { makeId: duplicateId })),
      delete: (id) => runBlocked("theme.delete", () => planDelete(id)),
      reorder: (ids) => commitPlan(planReorder(ids)),
    }),
    [
      readState,
      assertAllowed,
      planSelect,
      planFollowSystem,
      planCreate,
      planUpdate,
      planRename,
      planDuplicate,
      planDelete,
      planReorder,
      commitPlan,
      runBlocked,
      makeId,
    ]
  );

  const saveEditorTheme = useCallback(
    (draft, { isNew, stale, forControl = false, baseline = null }) => {
      if (
        forControl &&
        !isNew &&
        JSON.stringify(listCustomThemeDocuments()[draft.id] ?? null) !== JSON.stringify(baseline)
      ) {
        throw Object.assign(new Error("The Theme source changed."), { code: "draftStale" });
      }
      if (stale && !isNew) {
        reportLibraryConflict("theme", draft);
        return true;
      }
      const { id, ...document } = draft;
      const planned = isNew ? planCreate(document, { makeId: () => id }) : planUpdate(id, document);
      if (planned.issues.length > 0) return false;
      commitPlan(planned);
      return forControl
        ? {
            savedId: id,
            changed: planned.changed.length > 0,
            state: planned.state,
            document: planned.state.themes.find((theme) => theme.id === id),
          }
        : true;
    },
    [commitPlan, planCreate, planUpdate]
  );

  const editor = useThemeEditor({
    publish: themeSettings.setPreviewTheme,
    onFinish: themeSettings.finishThemePreview,
    activeTheme:
      BUILTIN_THEMES_V2[themeSettings.resolvedThemeId] ??
      listCustomThemeDocuments()[themeSettings.resolvedThemeId] ??
      BUILTIN_THEMES_V2["plvs-dark"],
    onSave: saveEditorTheme,
    makeId,
  });
  editorRef.current = editor;

  const latestEditedTheme = editor.draft?.id
    ? (listCustomThemeDocuments()[editor.draft.id] ?? null)
    : null;
  const latestEditedThemeSignature = JSON.stringify(latestEditedTheme);
  const editorIsEditing = editor.isEditing;
  const syncEditorSource = editor.syncSource;
  useEffect(() => {
    if (editorIsEditing) {
      syncEditorSource(
        latestEditedThemeSignature === "null" ? null : JSON.parse(latestEditedThemeSignature)
      );
    }
  }, [editorIsEditing, latestEditedThemeSignature, syncEditorSource]);

  useBlockingEditor("theme", editor.isEditing);

  const customThemeOptions = listCustomThemeDocumentsOrdered().map((theme) => ({
    id: theme.id,
    label: theme.name,
    theme,
  }));

  /**
   * @param {string} mode
   */
  function setAppearanceMode(mode) {
    if (mode === "system") control.followSystem();
    else control.select(themeSettings.resolvedThemeId);
  }

  function selectThemeId(id) {
    control.select(id);
  }

  function createCustomTheme() {
    setSettingsOpen(false);
    editor.beginCreate("Custom", undefined, { mode: "create", sourceId: null });
  }

  function editActiveCustomTheme() {
    editCustomTheme(themeSettings.resolvedThemeId);
  }

  function editCustomTheme(id) {
    if (!isCustomThemeId(id) || editor.isEditingNow()) return;
    setSettingsOpen(false);
    const theme = listCustomThemeDocuments()[id];
    if (theme) editor.beginEdit(theme, { mode: "edit", sourceId: id });
  }

  function customizeBuiltinTheme(id) {
    const theme = BUILTIN_THEMES_V2[id];
    if (!theme || editor.isEditingNow()) return;
    setSettingsOpen(false);
    editor.beginCreate(`${theme.name} Custom`, theme, { mode: "customize", sourceId: id });
  }

  function duplicateCustomTheme(id) {
    const theme = listCustomThemeDocuments()[id];
    if (!theme || editor.isEditingNow()) return;
    setSettingsOpen(false);
    editor.beginCreate(`${theme.name} Copy`, theme, { mode: "duplicate", sourceId: id });
  }

  function deleteCustomTheme(id) {
    if (editor.isEditingNow()) return;
    control.delete(id);
  }

  return {
    editor,
    editorPos,
    moveEditor,
    customThemeOptions,
    setAppearanceMode,
    selectThemeId,
    createCustomTheme,
    editActiveCustomTheme,
    editCustomTheme,
    customizeBuiltinTheme,
    duplicateCustomTheme,
    deleteCustomTheme,
    activeIsCustom: isCustomThemeId(themeSettings.resolvedThemeId),
    themeControl: control,
  };
}
