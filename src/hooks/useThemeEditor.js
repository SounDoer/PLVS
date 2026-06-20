import { useCallback, useRef, useState } from "react";
import { applyThemeToDocument } from "../uiPreferences";
import { makeCustomThemeFromBase } from "../theme/customTheme.js";
import {
  listCustomThemes,
  upsertCustomTheme,
  removeCustomTheme,
} from "../theme/customThemesRepo.js";

/**
 * @param {{
 *   activeTheme: object,
 *   customThemes: Record<string, object>,
 *   prevSelection: { appearance: string, themeId: string|null },
 *   setThemeId: (id: string) => void,
 *   setAppearance: (a: string) => void,
 *   apply?: (id: string, customThemes: Record<string, object>) => void,
 *   makeId?: () => string,
 * }} opts
 */
export function useThemeEditor(opts) {
  const apply = opts.apply ?? applyThemeToDocument;
  const [draft, setDraft] = useState(/** @type {object|null} */ (null));
  const [dirty, setDirty] = useState(false);
  const draftRef = useRef(/** @type {object|null} */ (null));
  const wasNewRef = useRef(false);
  const prevRef = useRef(opts.prevSelection);

  const applyDraft = useCallback(
    (next) => apply(next.id, { ...listCustomThemes(), [next.id]: next }),
    [apply]
  );

  // Keep state and ref in sync so save/cancel can read the latest draft without a state-updater.
  const setDraftBoth = useCallback((next) => {
    draftRef.current = next;
    setDraft(next);
  }, []);

  const beginEdit = useCallback(
    (theme) => {
      wasNewRef.current = false;
      prevRef.current = { appearance: "fixed", themeId: theme.id };
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
      prevRef.current = opts.prevSelection;
      const d = makeCustomThemeFromBase(opts.activeTheme, name, opts.makeId);
      upsertCustomTheme(d);
      opts.setAppearance("fixed");
      opts.setThemeId(d.id);
      setDraftBoth(d);
      setDirty(false);
      applyDraft(d);
    },
    [opts, applyDraft, setDraftBoth]
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

  const updateSeed = useCallback(
    (key, value) =>
      edit((d) =>
        key === "good" || key === "warn" || key === "bad"
          ? { ...d, seeds: { ...d.seeds, signal: { ...d.seeds.signal, [key]: value } } }
          : { ...d, seeds: { ...d.seeds, [key]: value } }
      ),
    [edit]
  );

  const updateShell = useCallback(
    (key, value) => edit((d) => ({ ...d, semantic: { ...d.semantic, [key]: value } })),
    [edit]
  );

  const save = useCallback(() => {
    const d = draftRef.current;
    if (d) upsertCustomTheme(d);
    setDraftBoth(null);
    setDirty(false);
  }, [setDraftBoth]);

  const cancel = useCallback(() => {
    const d = draftRef.current;
    if (d && wasNewRef.current) removeCustomTheme(d.id);
    const prev = prevRef.current;
    opts.setAppearance(prev.appearance);
    opts.setThemeId(prev.themeId);
    apply(prev.appearance === "fixed" ? prev.themeId : "plvs-dark", listCustomThemes());
    setDraftBoth(null);
    setDirty(false);
  }, [opts, apply, setDraftBoth]);

  return {
    isEditing: draft != null,
    draft,
    dirty,
    beginCreate,
    beginEdit,
    setName,
    updateSeed,
    updateShell,
    save,
    cancel,
  };
}
