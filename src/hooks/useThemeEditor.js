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
  const wasNewRef = useRef(false);
  const prevRef = useRef(opts.prevSelection);

  const applyDraft = useCallback(
    (next) => apply(next.id, { ...listCustomThemes(), [next.id]: next }),
    [apply]
  );

  const beginEdit = useCallback(
    (theme) => {
      wasNewRef.current = false;
      prevRef.current = { appearance: "fixed", themeId: theme.id };
      const d = structuredClone(theme);
      setDraft(d);
      applyDraft(d);
    },
    [applyDraft]
  );

  const beginCreate = useCallback(
    (name) => {
      wasNewRef.current = true;
      prevRef.current = opts.prevSelection;
      const d = makeCustomThemeFromBase(opts.activeTheme, name, opts.makeId);
      upsertCustomTheme(d);
      opts.setAppearance("fixed");
      opts.setThemeId(d.id);
      setDraft(d);
      applyDraft(d);
    },
    [opts, applyDraft]
  );

  const setName = useCallback((name) => {
    setDraft((d) => (d ? { ...d, name: String(name) } : d));
  }, []);

  const updateSeed = useCallback(
    (key, value) => {
      setDraft((d) => {
        if (!d) return d;
        const next =
          key === "good" || key === "warn" || key === "bad"
            ? { ...d, seeds: { ...d.seeds, signal: { ...d.seeds.signal, [key]: value } } }
            : { ...d, seeds: { ...d.seeds, [key]: value } };
        applyDraft(next);
        return next;
      });
    },
    [applyDraft]
  );

  const updateShell = useCallback(
    (key, value) => {
      setDraft((d) => {
        if (!d) return d;
        const next = { ...d, semantic: { ...d.semantic, [key]: value } };
        applyDraft(next);
        return next;
      });
    },
    [applyDraft]
  );

  const save = useCallback(() => {
    setDraft((d) => {
      if (d) upsertCustomTheme(d);
      return null;
    });
  }, []);

  const cancel = useCallback(() => {
    setDraft((d) => {
      if (d && wasNewRef.current) removeCustomTheme(d.id);
      const prev = prevRef.current;
      opts.setAppearance(prev.appearance);
      opts.setThemeId(prev.themeId);
      apply(prev.appearance === "fixed" ? prev.themeId : "plvs-dark", listCustomThemes());
      return null;
    });
  }, [opts, apply]);

  return {
    isEditing: draft != null,
    draft,
    beginCreate,
    beginEdit,
    setName,
    updateSeed,
    updateShell,
    save,
    cancel,
  };
}
