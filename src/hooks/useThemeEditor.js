import { useCallback, useEffect, useRef, useState } from "react";
import { makeCustomThemeV2FromBase } from "../theme/customTheme.js";
import { upsertCustomTheme } from "../theme/customThemesRepo.js";
import { themeRuntime } from "../theme/themeRuntime.js";
import { applyPalettePreset } from "../theme/palettePresets.js";
import { normalizeThemeName, normalizeThemeV2 } from "../theme/themeSchema.js";

const noop = () => {};

/**
 * @param {{
 *   activeTheme: object,
 *   setThemeId: (id: string) => void,
 *   setAppearance: (a: string) => void,
 *   publish?: (theme: object) => void,
 *   makeId?: () => string,
 * }} opts
 */
export function useThemeEditor(opts) {
  const {
    activeTheme,
    setThemeId,
    setAppearance,
    publish: publishOverride,
    makeId,
    onChange,
  } = opts;
  const publish = publishOverride ?? themeRuntime.publishAuthoring;
  const notify = onChange ?? noop;
  const [draft, setDraft] = useState(/** @type {object|null} */ (null));
  const [dirty, setDirty] = useState(false);
  const draftRef = useRef(/** @type {object|null} */ (null));
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

  useEffect(() => cancelScheduledPublication, [cancelScheduledPublication]);

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

  const syncDirty = useCallback((next) => {
    setDirty(JSON.stringify(next) !== JSON.stringify(baselineRef.current));
  }, []);

  const beginEdit = useCallback(
    (theme) => {
      wasNewRef.current = false;
      restoreThemeRef.current = theme;
      const d = structuredClone(theme);
      setDraftBoth(d);
      resetHistory(d);
      setDirty(false);
      applyDraft(d);
    },
    [applyDraft, resetHistory, setDraftBoth]
  );

  const beginCreate = useCallback(
    (name, baseTheme = activeTheme) => {
      wasNewRef.current = true;
      restoreThemeRef.current = activeTheme;
      const d = makeCustomThemeV2FromBase(baseTheme, name, makeId);
      setDraftBoth(d);
      resetHistory(d);
      setDirty(false);
      applyDraft(d);
    },
    [activeTheme, applyDraft, makeId, resetHistory, setDraftBoth]
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
    (kind, presetId) => {
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

  const save = useCallback(() => {
    cancelScheduledPublication();
    const d = draftRef.current;
    if (d) {
      upsertCustomTheme(d);
      if (wasNewRef.current) {
        setAppearance("fixed");
        setThemeId(d.id);
      }
    }
    setDraftBoth(null);
    setDirty(false);
    notify();
  }, [cancelScheduledPublication, notify, setAppearance, setDraftBoth, setThemeId]);

  const cancel = useCallback(() => {
    cancelScheduledPublication();
    publish(restoreThemeRef.current);
    setDraftBoth(null);
    setDirty(false);
  }, [cancelScheduledPublication, publish, setDraftBoth]);

  return {
    isEditing: draft != null,
    draft,
    dirty,
    canSave: normalizeThemeV2(draft) != null,
    canUndo: historyAvailability.undo,
    canRedo: historyAvailability.redo,
    beginCreate,
    beginEdit,
    setName,
    updateCore,
    updatePaletteColor,
    updateIntensityStop,
    updateIntensityStops,
    applyPreset,
    updateOverride,
    undo,
    redo,
    save,
    cancel,
  };
}
