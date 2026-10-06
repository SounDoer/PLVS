import { useCallback, useEffect, useRef, useState } from "react";
import { makeCustomThemeV2FromBase } from "../theme/customTheme.js";
import { BUILTIN_THEMES_V2 } from "../theme/builtinThemesV2.js";
import { themeRuntime } from "../theme/themeRuntime.js";
import { applyPalettePreset } from "../theme/palettePresets.js";
import { normalizeThemeDocumentShape, normalizeThemeName } from "../theme/themeSchema.js";

const noop = () => {};
/**
 * @param {{
 *   activeTheme: object,
 *   onSave: (theme: object, options: {isNew: boolean, stale?: boolean}) => boolean|void,
 *   publish?: (theme: object) => void,
 *   makeId?: () => string,
 *   onChange?: (...args: any[]) => void,
 *   onFinish?: (...args: any[]) => void,
 * }} opts
 */
export function useThemeEditor(opts) {
  const { activeTheme, onSave, publish: publishOverride, makeId, onChange, onFinish = noop } = opts;
  const publish = publishOverride ?? themeRuntime.publishAuthoring;
  const notify = onChange ?? noop;
  const [draft, setDraft] = useState(/** @type {object|null} */ (null));
  const [dirty, setDirty] = useState(false);
  const [stale, setStale] = useState(false);
  const [authoring, setAuthoring] = useState(null);
  const [page, setPageState] = useState("core");
  const [discardOpen, setDiscardOpen] = useState(false);
  const draftRef = useRef(/** @type {object|null} */ (null));
  const dirtyRef = useRef(false);
  const wasNewRef = useRef(false);
  const restoreThemeRef = useRef(activeTheme);
  const baselineRef = useRef(/** @type {object|null} */ (null));
  const historyRef = useRef({ past: [], future: [], lastKey: null, lastAt: 0 });
  const pendingPublicationRef = useRef(null);
  const publicationFrameRef = useRef(null);
  const [historyAvailability, setHistoryAvailability] = useState({ undo: false, redo: false });

  const applyDraft = useCallback((next) => publish(next), [publish]);

  const cancelScheduledPublication = useCallback(() => {
    if (publicationFrameRef.current != null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(publicationFrameRef.current);
    }
    publicationFrameRef.current = null;
    pendingPublicationRef.current = null;
  }, []);

  const scheduleDraftPublication = useCallback(
    (next) => {
      if (typeof requestAnimationFrame !== "function") {
        applyDraft(next);
        return;
      }
      pendingPublicationRef.current = next;
      if (publicationFrameRef.current != null) return;
      publicationFrameRef.current = requestAnimationFrame(() => {
        publicationFrameRef.current = null;
        const pending = pendingPublicationRef.current;
        pendingPublicationRef.current = null;
        if (pending) applyDraft(pending);
      });
    },
    [applyDraft]
  );

  useEffect(
    () => () => {
      cancelScheduledPublication();
      if (draftRef.current) onFinish();
    },
    [cancelScheduledPublication, onFinish]
  );

  // Keep state and ref in sync so save/cancel can read the latest draft without a state-updater.
  const setDraftBoth = useCallback((next) => {
    draftRef.current = next;
    setDraft(next);
  }, []);

  const resetHistory = useCallback((baseline) => {
    baselineRef.current = structuredClone(baseline);
    historyRef.current = { past: [], future: [], lastKey: null, lastAt: 0 };
    setHistoryAvailability({ undo: false, redo: false });
  }, []);

  const setDirtyBoth = useCallback((next) => {
    dirtyRef.current = next;
    setDirty(next);
  }, []);

  const syncDirty = useCallback(
    (next) => {
      setDirtyBoth(JSON.stringify(next) !== JSON.stringify(baselineRef.current));
    },
    [setDirtyBoth]
  );

  const setPage = useCallback((next) => {
    if (["core", "palettes", "advanced"].includes(next)) setPageState(next);
  }, []);

  const beginEdit = useCallback(
    (theme, origin = { mode: "edit", sourceId: theme?.id ?? null }) => {
      wasNewRef.current = false;
      restoreThemeRef.current = theme;
      const d = structuredClone(theme);
      setDraftBoth(d);
      resetHistory(d);
      setDirtyBoth(false);
      setStale(false);
      setAuthoring({ ...origin, draftId: d.id });
      setPageState("core");
      setDiscardOpen(false);
      applyDraft(d);
    },
    [applyDraft, resetHistory, setDirtyBoth, setDraftBoth]
  );

  const beginCreate = useCallback(
    (
      /** @type {string} */ name,
      baseTheme = activeTheme,
      /** @type {{ mode: string, sourceId: string|null }} */ origin = {
        mode: "create",
        sourceId: null,
      }
    ) => {
      wasNewRef.current = true;
      restoreThemeRef.current = activeTheme;
      const d = makeCustomThemeV2FromBase(baseTheme, name, makeId);
      setDraftBoth(d);
      resetHistory(d);
      setDirtyBoth(false);
      setStale(false);
      setAuthoring({ ...origin, draftId: d.id });
      setPageState("core");
      setDiscardOpen(false);
      applyDraft(d);
    },
    [activeTheme, applyDraft, makeId, resetHistory, setDirtyBoth, setDraftBoth]
  );

  // Pure mutate of the current draft, then sync + apply + mark dirty (no side-effects in setState).
  const edit = useCallback(
    (mutate, actionKey) => {
      const d = draftRef.current;
      if (!d) return;
      const next = mutate(d);
      const history = historyRef.current;
      const now = Date.now();
      if (history.lastKey !== actionKey || now - history.lastAt > 500) {
        history.past.push(structuredClone(d));
      }
      history.future = [];
      history.lastKey = actionKey;
      history.lastAt = now;
      setDraftBoth(next);
      syncDirty(next);
      scheduleDraftPublication(next);
      setHistoryAvailability({ undo: history.past.length > 0, redo: false });
    },
    [scheduleDraftPublication, setDraftBoth, syncDirty]
  );

  const setName = useCallback(
    (name) => {
      const normalized = normalizeThemeName(name);
      if (normalized) edit((draft) => ({ ...draft, name: normalized }), "name");
    },
    [edit]
  );

  const updateCore = useCallback(
    (key, value) =>
      edit((draft) => ({ ...draft, core: { ...draft.core, [key]: value } }), `core:${key}`),
    [edit]
  );

  const resetCore = useCallback(
    () =>
      edit((draft) => {
        const builtin = BUILTIN_THEMES_V2[`plvs-${draft.colorScheme}`];
        return { ...draft, core: structuredClone(builtin.core) };
      }, "core:reset"),
    [edit]
  );

  const updateColorScheme = useCallback(
    (/** @type {string} */ colorScheme) => {
      if (colorScheme !== "dark" && colorScheme !== "light") return;
      edit((draft) => ({ ...draft, colorScheme }), "colorScheme");
    },
    [edit]
  );

  const updatePaletteColor = useCallback(
    (palette, key, value) =>
      edit(
        (draft) => ({
          ...draft,
          palettes: {
            ...draft.palettes,
            [palette]: { ...draft.palettes[palette], presetId: null, [key]: value },
          },
        }),
        `palette:${palette}:${key}`
      ),
    [edit]
  );

  const updateIntensityStop = useCallback(
    (index, value) =>
      edit(
        (draft) => ({
          ...draft,
          palettes: {
            ...draft.palettes,
            intensity: {
              ...draft.palettes.intensity,
              presetId: null,
              stops: draft.palettes.intensity.stops.map((stop, stopIndex) =>
                stopIndex === index ? { ...stop, color: value } : stop
              ),
            },
          },
        }),
        `intensity-stop:${index}`
      ),
    [edit]
  );

  const updateIntensityStops = useCallback(
    (stops) =>
      edit(
        (draft) => ({
          ...draft,
          palettes: {
            ...draft.palettes,
            intensity: { presetId: null, stops: stops.map((stop) => ({ ...stop })) },
          },
        }),
        "intensity-stops"
      ),
    [edit]
  );

  const applyPreset = useCallback(
    (/** @type {string} */ kind, /** @type {string} */ presetId) => {
      const palette = applyPalettePreset(kind, presetId);
      if (!palette) return;
      edit(
        (draft) => ({
          ...draft,
          palettes: { ...draft.palettes, [kind]: palette },
        }),
        `preset:${kind}`
      );
    },
    [edit]
  );

  const updateOverride = useCallback(
    (roleId, override) =>
      edit((draft) => {
        const overrides = { ...draft.overrides };
        if (override == null) delete overrides[roleId];
        else overrides[roleId] = override;
        return { ...draft, overrides };
      }, `override:${roleId}`),
    [edit]
  );

  const resetOverrides = useCallback(
    (roleIds) =>
      edit(
        (draft) => {
          const overrides = { ...draft.overrides };
          for (const roleId of roleIds) delete overrides[roleId];
          return { ...draft, overrides };
        },
        `override-section:${[...roleIds].sort().join(",")}`
      ),
    [edit]
  );

  const moveHistory = useCallback(
    (from, to) => {
      const history = historyRef.current;
      const next = history[from].pop();
      const current = draftRef.current;
      if (!next || !current) return;
      history[to].push(structuredClone(current));
      history.lastKey = null;
      cancelScheduledPublication();
      setDraftBoth(next);
      syncDirty(next);
      applyDraft(next);
      setHistoryAvailability({
        undo: history.past.length > 0,
        redo: history.future.length > 0,
      });
    },
    [applyDraft, cancelScheduledPublication, setDraftBoth, syncDirty]
  );

  const undo = useCallback(() => moveHistory("past", "future"), [moveHistory]);
  const redo = useCallback(() => moveHistory("future", "past"), [moveHistory]);

  const syncSource = useCallback((source) => {
    if (!draftRef.current || wasNewRef.current) return;
    setStale(JSON.stringify(source) !== JSON.stringify(baselineRef.current));
  }, []);

  const save = useCallback(() => {
    cancelScheduledPublication();
    const d = draftRef.current;
    if (d && onSave?.(d, { isNew: wasNewRef.current, stale }) === false) return;
    setDraftBoth(null);
    setDirtyBoth(false);
    setStale(false);
    setAuthoring(null);
    setDiscardOpen(false);
    if (d) notify();
    onFinish();
  }, [cancelScheduledPublication, notify, onSave, onFinish, setDirtyBoth, setDraftBoth, stale]);

  const cancel = useCallback(() => {
    cancelScheduledPublication();
    publish(restoreThemeRef.current);
    setDraftBoth(null);
    setDirtyBoth(false);
    setStale(false);
    setAuthoring(null);
    setDiscardOpen(false);
    onFinish();
  }, [cancelScheduledPublication, publish, onFinish, setDirtyBoth, setDraftBoth]);

  const requestDismiss = useCallback(() => {
    if (!draftRef.current) return;
    if (dirtyRef.current) setDiscardOpen(true);
    else cancel();
  }, [cancel]);

  const keepEditing = useCallback(() => setDiscardOpen(false), []);
  const confirmDiscard = useCallback(() => cancel(), [cancel]);

  return {
    isEditing: draft != null,
    draft,
    dirty,
    stale,
    authoring,
    page,
    setPage,
    discardOpen,
    canSave: normalizeThemeDocumentShape(draft) != null,
    canUndo: historyAvailability.undo,
    canRedo: historyAvailability.redo,
    beginCreate,
    beginEdit,
    setName,
    updateColorScheme,
    updateCore,
    resetCore,
    updatePaletteColor,
    updateIntensityStop,
    updateIntensityStops,
    applyPreset,
    updateOverride,
    resetOverrides,
    undo,
    redo,
    syncSource,
    save,
    cancel,
    requestDismiss,
    keepEditing,
    confirmDiscard,
    isEditingNow: () => draftRef.current != null,
  };
}
