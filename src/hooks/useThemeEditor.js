import { useCallback, useRef, useState } from "react";
import { makeCustomThemeV2FromBase } from "../theme/customTheme.js";
import { upsertCustomTheme } from "../theme/customThemesRepo.js";
import { themeRuntime } from "../theme/themeRuntime.js";

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

  const applyDraft = useCallback((next) => publish(next), [publish]);

  // Keep state and ref in sync so save/cancel can read the latest draft without a state-updater.
  const setDraftBoth = useCallback((next) => {
    draftRef.current = next;
    setDraft(next);
  }, []);

  const beginEdit = useCallback(
    (theme) => {
      wasNewRef.current = false;
      restoreThemeRef.current = theme;
      const d = structuredClone(theme);
      setDraftBoth(d);
      setDirty(false);
      applyDraft(d);
    },
    [applyDraft, setDraftBoth]
  );

  const beginCreate = useCallback(
    (name) => {
      wasNewRef.current = true;
      restoreThemeRef.current = activeTheme;
      const d = makeCustomThemeV2FromBase(activeTheme, name, makeId);
      setDraftBoth(d);
      setDirty(false);
      applyDraft(d);
    },
    [activeTheme, applyDraft, makeId, setDraftBoth]
  );

  // Pure mutate of the current draft, then sync + apply + mark dirty (no side-effects in setState).
  const edit = useCallback(
    (mutate) => {
      const d = draftRef.current;
      if (!d) return;
      const next = mutate(d);
      setDraftBoth(next);
      setDirty(true);
      applyDraft(next);
    },
    [applyDraft, setDraftBoth]
  );

  const setName = useCallback((name) => edit((d) => ({ ...d, name: String(name) })), [edit]);

  const updateCore = useCallback(
    (key, value) => edit((draft) => ({ ...draft, core: { ...draft.core, [key]: value } })),
    [edit]
  );

  const updatePaletteColor = useCallback(
    (palette, key, value) =>
      edit((draft) => ({
        ...draft,
        palettes: {
          ...draft.palettes,
          [palette]: { ...draft.palettes[palette], presetId: null, [key]: value },
        },
      })),
    [edit]
  );

  const updateIntensityStop = useCallback(
    (index, value) =>
      edit((draft) => ({
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
      })),
    [edit]
  );

  const updateOverride = useCallback(
    (roleId, override) =>
      edit((draft) => {
        const overrides = { ...draft.overrides };
        if (override == null) delete overrides[roleId];
        else overrides[roleId] = override;
        return { ...draft, overrides };
      }),
    [edit]
  );

  const save = useCallback(() => {
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
  }, [notify, setAppearance, setDraftBoth, setThemeId]);

  const cancel = useCallback(() => {
    publish(restoreThemeRef.current);
    setDraftBoth(null);
    setDirty(false);
  }, [publish, setDraftBoth]);

  return {
    isEditing: draft != null,
    draft,
    dirty,
    beginCreate,
    beginEdit,
    setName,
    updateCore,
    updatePaletteColor,
    updateIntensityStop,
    updateOverride,
    save,
    cancel,
  };
}
