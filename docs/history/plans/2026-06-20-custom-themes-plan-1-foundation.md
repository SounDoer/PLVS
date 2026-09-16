# Custom Themes — Plan 1: Foundation (model, store, registry, engine wiring)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the theme engine able to store, resolve, and apply user `CustomTheme` objects (persisted in a new `themesStore`), so a custom id selected under `appearance: "fixed"` renders correctly and a deleted/unknown id falls back to `plvs-dark` — all headless, no editor UI yet.

**Architecture:** A `CustomTheme` is a full standalone snapshot shaped like a builtin theme, so it feeds the existing `buildThemeTokens` + shell + colormap path with no special-casing. A small registry (`getTheme`/`isKnownThemeId`) resolves any id (builtin or custom) to its object; `resolveThemeId` and `applyThemeToDocument` take a `customThemes` map; the three apply sites (`main.jsx` boot, `useSettings`, `SpectrogramPanel` colormap) load custom themes from the repo and pass them through.

**Tech Stack:** JavaScript (ESM), React 19, Vitest.

**Spec:** `docs/working/superpowers/specs/2026-06-20-custom-themes-design.md` (§4 model, §5 persistence/resolution).

**Roadmap:** Plan 1 of 2. Plan 2 adds the floating editor, color control, draft semantics, and the Settings create/edit/delete UI. After Plan 1, custom themes can exist and render (seedable via the store) but there is no UI to make or edit them yet.

---

### Task 1: `themesStore` persistence domain

**Files:**
- Modify: `src/persistence/index.js`

- [ ] **Step 1: Add the store and wire export/reset**

In `src/persistence/index.js`, add after the `presetsStore` declaration:

```javascript
export const themesStore = createDomainStore({ name: "plvs:themes", backend });
```

Add `themes: themesStore.export()` to the object returned by `exportAll()`, and
`themesStore.reset();` to `resetAll()`.

- [ ] **Step 2: Verify nothing else broke**

Run: `npx vitest run src/persistence`
Expected: PASS (existing persistence tests unaffected).

- [ ] **Step 3: Commit**

```bash
git add src/persistence/index.js
git commit -m "feat(persistence): add themesStore domain for custom themes"
```

---

### Task 2: `CustomTheme` model helpers

**Files:**
- Create: `src/theme/customTheme.js`
- Test: `src/theme/customTheme.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, it, expect } from "vitest";
import {
  CUSTOM_THEME_ID_PREFIX,
  isCustomThemeId,
  makeCustomThemeFromBase,
  normalizeCustomTheme,
} from "./customTheme.js";
import { BUILTIN_THEMES } from "./builtinThemes.js";

describe("isCustomThemeId", () => {
  it("is true only for the custom prefix", () => {
    expect(isCustomThemeId("custom-abc")).toBe(true);
    expect(isCustomThemeId("plvs-dark")).toBe(false);
    expect(isCustomThemeId(null)).toBe(false);
  });
});

describe("makeCustomThemeFromBase", () => {
  it("snapshots seeds/semantic/colormap/colorScheme from the base with a new id and name", () => {
    const base = BUILTIN_THEMES["plvs-dark"];
    const t = makeCustomThemeFromBase(base, "Sunset", () => "custom-fixed");
    expect(t.id).toBe("custom-fixed");
    expect(t.name).toBe("Sunset");
    expect(t.colorScheme).toBe("dark");
    expect(t.seeds.accent).toBe(base.seeds.accent);
    expect(t.seeds).not.toBe(base.seeds); // deep copy
    expect(t.semantic).toEqual(base.semantic);
    expect(t.semantic).not.toBe(base.semantic);
    expect(t.colormap).toEqual(base.colormap);
  });
});

describe("normalizeCustomTheme", () => {
  it("returns the theme for a valid object", () => {
    const base = BUILTIN_THEMES["plvs-light"];
    const t = makeCustomThemeFromBase(base, "Mine", () => "custom-1");
    expect(normalizeCustomTheme(t)).toEqual(t);
  });
  it("returns null for invalid input", () => {
    expect(normalizeCustomTheme(null)).toBeNull();
    expect(normalizeCustomTheme({ id: "plvs-dark" })).toBeNull(); // not a custom id
    expect(normalizeCustomTheme({ id: "custom-x" })).toBeNull(); // missing fields
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run src/theme/customTheme.test.js` (module not found).

- [ ] **Step 3: Implement `src/theme/customTheme.js`**

```javascript
export const CUSTOM_THEME_ID_PREFIX = "custom-";

/** @param {unknown} id */
export function isCustomThemeId(id) {
  return typeof id === "string" && id.startsWith(CUSTOM_THEME_ID_PREFIX);
}

const defaultMakeId = () => `${CUSTOM_THEME_ID_PREFIX}${crypto.randomUUID()}`;

/**
 * Snapshot a builtin or custom theme into a new editable CustomTheme.
 * @param {{colorScheme:string, seeds:object, semantic:object, colormap:unknown}} base
 * @param {string} name
 * @param {() => string} [makeId]
 */
export function makeCustomThemeFromBase(base, name, makeId = defaultMakeId) {
  return {
    id: makeId(),
    name: String(name),
    colorScheme: base.colorScheme === "light" ? "light" : "dark",
    seeds: {
      accent: base.seeds.accent,
      accentSecondary: base.seeds.accentSecondary,
      signal: {
        good: base.seeds.signal.good,
        warn: base.seeds.signal.warn,
        bad: base.seeds.signal.bad,
      },
    },
    semantic: { ...base.semantic },
    colormap: structuredClone(base.colormap),
  };
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.length > 0;
}

/**
 * Validate a persisted custom theme; return it (as-is) or null if malformed.
 * @param {unknown} raw
 */
export function normalizeCustomTheme(raw) {
  if (!raw || typeof raw !== "object") return null;
  const t = /** @type {any} */ (raw);
  if (!isCustomThemeId(t.id) || !isNonEmptyString(t.name)) return null;
  if (t.colorScheme !== "dark" && t.colorScheme !== "light") return null;
  const s = t.seeds;
  if (!s || typeof s !== "object") return null;
  if (!isNonEmptyString(s.accent) || !isNonEmptyString(s.accentSecondary)) return null;
  if (!s.signal || !isNonEmptyString(s.signal.good) || !isNonEmptyString(s.signal.warn) || !isNonEmptyString(s.signal.bad))
    return null;
  if (!t.semantic || typeof t.semantic !== "object") return null;
  if (!Array.isArray(t.colormap)) return null;
  return t;
}
```

- [ ] **Step 4: Run, expect PASS** — `npx vitest run src/theme/customTheme.test.js`.

- [ ] **Step 5: Commit**

```bash
git add src/theme/customTheme.js src/theme/customTheme.test.js
git commit -m "feat(theme): add CustomTheme model helpers"
```

---

### Task 3: `customThemesRepo` (CRUD over `themesStore`)

**Files:**
- Create: `src/theme/customThemesRepo.js`
- Test: `src/theme/customThemesRepo.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, it, expect, beforeEach } from "vitest";
import { themesStore } from "../persistence/index.js";
import { makeCustomThemeFromBase } from "./customTheme.js";
import { BUILTIN_THEMES } from "./builtinThemes.js";
import {
  listCustomThemes,
  listCustomThemesOrdered,
  upsertCustomTheme,
  removeCustomTheme,
} from "./customThemesRepo.js";

function mk(id, name = "T") {
  return makeCustomThemeFromBase(BUILTIN_THEMES["plvs-dark"], name, () => id);
}

beforeEach(() => themesStore.reset());

describe("customThemesRepo", () => {
  it("upserts and lists themes", () => {
    upsertCustomTheme(mk("custom-a", "A"));
    upsertCustomTheme(mk("custom-b", "B"));
    expect(Object.keys(listCustomThemes())).toEqual(["custom-a", "custom-b"]);
    expect(listCustomThemesOrdered().map((t) => t.id)).toEqual(["custom-a", "custom-b"]);
  });
  it("updates in place without reordering", () => {
    upsertCustomTheme(mk("custom-a", "A"));
    upsertCustomTheme(mk("custom-b", "B"));
    upsertCustomTheme(mk("custom-a", "A2"));
    expect(listCustomThemesOrdered().map((t) => t.name)).toEqual(["A2", "B"]);
  });
  it("removes a theme from map and order", () => {
    upsertCustomTheme(mk("custom-a"));
    upsertCustomTheme(mk("custom-b"));
    removeCustomTheme("custom-a");
    expect(listCustomThemesOrdered().map((t) => t.id)).toEqual(["custom-b"]);
  });
  it("drops malformed persisted entries from listings", () => {
    themesStore.patch({ themes: { "custom-x": { id: "custom-x" } }, order: ["custom-x"] });
    expect(listCustomThemes()).toEqual({});
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run src/theme/customThemesRepo.test.js`.

- [ ] **Step 3: Implement `src/theme/customThemesRepo.js`**

```javascript
import { themesStore } from "../persistence/index.js";
import { normalizeCustomTheme } from "./customTheme.js";

function readState() {
  const raw = themesStore.read();
  const themes = raw && typeof raw.themes === "object" && raw.themes ? raw.themes : {};
  const order = Array.isArray(raw && raw.order) ? raw.order : [];
  return { themes, order };
}

/** @returns {Record<string, object>} valid custom themes keyed by id */
export function listCustomThemes() {
  const { themes } = readState();
  /** @type {Record<string, object>} */
  const out = {};
  for (const [id, t] of Object.entries(themes)) {
    const n = normalizeCustomTheme(t);
    if (n) out[id] = n;
  }
  return out;
}

/** @returns {object[]} valid custom themes in display order */
export function listCustomThemesOrdered() {
  const { order } = readState();
  const valid = listCustomThemes();
  const seen = new Set();
  const ordered = [];
  for (const id of order) {
    if (valid[id] && !seen.has(id)) {
      ordered.push(valid[id]);
      seen.add(id);
    }
  }
  for (const [id, t] of Object.entries(valid)) {
    if (!seen.has(id)) ordered.push(t);
  }
  return ordered;
}

export function upsertCustomTheme(theme) {
  const n = normalizeCustomTheme(theme);
  if (!n) return;
  const { themes, order } = readState();
  themesStore.patch({
    themes: { ...themes, [n.id]: n },
    order: order.includes(n.id) ? order : [...order, n.id],
  });
}

export function removeCustomTheme(id) {
  const { themes, order } = readState();
  const { [id]: _drop, ...rest } = themes;
  themesStore.patch({ themes: rest, order: order.filter((x) => x !== id) });
}
```

- [ ] **Step 4: Run, expect PASS.** — `npx vitest run src/theme/customThemesRepo.test.js`.

- [ ] **Step 5: Commit**

```bash
git add src/theme/customThemesRepo.js src/theme/customThemesRepo.test.js
git commit -m "feat(theme): add customThemesRepo CRUD over themesStore"
```

---

### Task 4: `themeRegistry` (`getTheme` / `isKnownThemeId`)

**Files:**
- Create: `src/theme/themeRegistry.js`
- Test: `src/theme/themeRegistry.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
import { describe, it, expect } from "vitest";
import { BUILTIN_THEMES } from "./builtinThemes.js";
import { makeCustomThemeFromBase } from "./customTheme.js";
import { getTheme, isKnownThemeId } from "./themeRegistry.js";

const custom = makeCustomThemeFromBase(BUILTIN_THEMES["plvs-dark"], "C", () => "custom-1");
const customs = { "custom-1": custom };

describe("themeRegistry", () => {
  it("resolves builtins and customs", () => {
    expect(getTheme("plvs-light", customs)).toBe(BUILTIN_THEMES["plvs-light"]);
    expect(getTheme("custom-1", customs)).toBe(custom);
  });
  it("falls back to plvs-dark for unknown", () => {
    expect(getTheme("nope", customs)).toBe(BUILTIN_THEMES["plvs-dark"]);
    expect(getTheme("custom-1", {})).toBe(BUILTIN_THEMES["plvs-dark"]);
  });
  it("isKnownThemeId reflects builtins and customs", () => {
    expect(isKnownThemeId("plvs-dark", customs)).toBe(true);
    expect(isKnownThemeId("custom-1", customs)).toBe(true);
    expect(isKnownThemeId("custom-1", {})).toBe(false);
    expect(isKnownThemeId("nope", customs)).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement `src/theme/themeRegistry.js`**

```javascript
import { BUILTIN_THEMES, DEFAULT_THEME_ID } from "./builtinThemes.js";

/**
 * @param {unknown} id
 * @param {Record<string, object>} [customThemes]
 */
export function isKnownThemeId(id, customThemes = {}) {
  if (typeof id !== "string") return false;
  return id in BUILTIN_THEMES || id in customThemes;
}

/**
 * @param {unknown} id
 * @param {Record<string, object>} [customThemes]
 * @returns {object} a builtin or custom theme; falls back to plvs-dark
 */
export function getTheme(id, customThemes = {}) {
  if (typeof id === "string") {
    if (id in BUILTIN_THEMES) return BUILTIN_THEMES[id];
    if (id in customThemes) return customThemes[id];
  }
  return BUILTIN_THEMES[DEFAULT_THEME_ID];
}
```

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/theme/themeRegistry.js src/theme/themeRegistry.test.js
git commit -m "feat(theme): add theme registry resolving builtins and customs"
```

---

### Task 5: `resolveThemeId` accepts custom themes

**Files:**
- Modify: `src/preferences/themeResolve.js`
- Test: `src/preferences/themeResolve.test.js`

- [ ] **Step 1: Add failing tests**

Append to `src/preferences/themeResolve.test.js`:

```javascript
import { makeCustomThemeFromBase } from "../theme/customTheme.js";
import { BUILTIN_THEMES } from "../theme/builtinThemes.js";

describe("resolveThemeId with custom themes", () => {
  const custom = makeCustomThemeFromBase(BUILTIN_THEMES["plvs-dark"], "C", () => "custom-1");
  const customs = { "custom-1": custom };

  it("resolves an existing fixed custom id to itself", () => {
    expect(resolveThemeId({ appearance: "fixed", themeId: "custom-1" }, true, customs)).toBe(
      "custom-1"
    );
  });
  it("falls back to plvs-dark for a deleted custom id", () => {
    expect(resolveThemeId({ appearance: "fixed", themeId: "custom-1" }, true, {})).toBe(
      DEFAULT_THEME_ID
    );
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (custom id currently treated as unknown → falls back even when present).

- [ ] **Step 3: Update `resolveThemeId`**

In `src/preferences/themeResolve.js`, import the registry and use it:

```javascript
import { isKnownThemeId } from "../theme/themeRegistry.js";
```

Change the signature and the validity check:

```javascript
export function resolveThemeId(shell, systemPrefersDark, customThemes = {}) {
  const appearance = shell?.appearance === "fixed" ? "fixed" : "system";
  if (appearance === "system") {
    return systemPrefersDark ? DEFAULT_THEME_ID : "plvs-light";
  }
  const rawId = shell?.themeId;
  const id = rawId == null || rawId === "" ? null : String(rawId);
  if (!isKnownThemeId(id, customThemes)) {
    if (import.meta.env.DEV && id != null && id !== "") {
      console.warn(`[PLVS] Unknown themeId "${id}"; falling back to ${DEFAULT_THEME_ID}.`);
    }
    return DEFAULT_THEME_ID;
  }
  return id;
}
```

(Keep the existing `export { DEFAULT_THEME_ID, isThemeId, THEME_IDS }` line and `parsePersistedUiStateJson`/`readPersistedShellThemeFields` unchanged. `readPersistedShellThemeFields` does not resolve, so it needs no custom-themes argument.)

- [ ] **Step 4: Run, expect PASS** — `npx vitest run src/preferences/themeResolve.test.js`.

- [ ] **Step 5: Commit**

```bash
git add src/preferences/themeResolve.js src/preferences/themeResolve.test.js
git commit -m "feat(theme): resolve fixed custom theme ids via the registry"
```

---

### Task 6: `applyThemeToDocument` + spectrogram colormap accept custom themes

**Files:**
- Modify: `src/preferences/applyDocumentTheme.js`
- Modify: `src/components/panels/SpectrogramPanel.jsx`

- [ ] **Step 1: Update `applyThemeToDocument`**

In `src/preferences/applyDocumentTheme.js`, replace the `getBuiltinTheme` import with the registry and
accept a `customThemes` argument:

```javascript
import { getTheme } from "../theme/themeRegistry.js";
// (remove: import { getBuiltinTheme } from "../theme/builtinThemes.js";)

export function applyThemeToDocument(themeId, customThemes = {}) {
  if (typeof document === "undefined") return;
  const theme = getTheme(themeId, customThemes);
  // ...rest unchanged (dataset.theme = theme.id, color-scheme, buildThemeTokens(theme), geometry)
}
```

(Everything after the lookup is unchanged — `buildThemeTokens(theme)` already works for a custom
theme object.)

- [ ] **Step 2: Point the spectrogram colormap at the registry**

In `src/components/panels/SpectrogramPanel.jsx`, the colormap LUT is built from
`getBuiltinTheme(resolvedThemeId).colormap`. Switch it to the registry with the custom themes loaded
from the repo:

```javascript
import { getTheme } from "../../theme/themeRegistry.js";
import { listCustomThemes } from "../../theme/customThemesRepo.js";
// remove the getBuiltinTheme import if it is now unused

const colormapLut = useMemo(
  () => buildSpectrogramLut(getTheme(resolvedThemeId, listCustomThemes()).colormap),
  [resolvedThemeId]
);
```

(B does not edit colormap, so keying on `resolvedThemeId` is sufficient — the colormap is stable per
theme.)

- [ ] **Step 3: Run the theme + component tests**

Run: `npx vitest run src/preferences src/theme src/components/panels/SpectrogramPanel.test.jsx`
Expected: PASS. If `SpectrogramPanel.test.jsx` mocks `getBuiltinTheme`, update the mock to the
registry's `getTheme` so the "passes the resolved theme colormap" test still drives a dark vs light
colormap.

- [ ] **Step 4: Commit**

```bash
git add src/preferences/applyDocumentTheme.js src/components/panels/SpectrogramPanel.jsx src/components/panels/SpectrogramPanel.test.jsx
git commit -m "feat(theme): apply custom themes through registry in document + spectrogram"
```

---

### Task 7: Boot + `useSettings` load and pass custom themes

**Files:**
- Modify: `src/main.jsx`
- Modify: `src/hooks/useSettings.js`

- [ ] **Step 1: Boot apply (`main.jsx`)**

Load custom themes synchronously at boot and pass them to both resolve and apply:

```javascript
import { listCustomThemes } from "./theme/customThemesRepo.js";

const systemPrefersDark = readSystemPrefersDark();
const shell = readPersistedShellThemeFields(UI_PREFERENCES);
const customThemes = listCustomThemes();
const resolvedThemeId = resolveThemeId(shell, systemPrefersDark, customThemes);
applyLayoutToDocument(UI_PREFERENCES);
applyThemeToDocument(resolvedThemeId, customThemes);
```

- [ ] **Step 2: Hook wiring (`useSettings.js`)**

Add custom-theme state, feed it into resolve + apply, refresh it on store changes, and make the fixed
picker value accept custom ids. Edits:

```javascript
import { listCustomThemes } from "../theme/customThemesRepo.js";
import { isKnownThemeId } from "../theme/themeRegistry.js";
import { presetsStore, settingsStore, themesStore } from "../persistence/index.js";
```

```javascript
  const [customThemes, setCustomThemes] = useState(() => listCustomThemes());

  const resolvedThemeId = useMemo(
    () => resolveThemeId({ appearance, themeId }, systemPrefersDark, customThemes),
    [appearance, themeId, systemPrefersDark, customThemes]
  );
```

Update `fixedThemeSelectValue` to accept custom ids:

```javascript
  const fixedThemeSelectValue = useMemo(() => {
    if (appearance !== "fixed") return "";
    return isKnownThemeId(themeId, customThemes) ? themeId : resolvedThemeId;
  }, [appearance, themeId, resolvedThemeId, customThemes]);
```

Update the apply effect to pass customThemes:

```javascript
  useEffect(() => {
    applyLayoutToDocument(UI_PREFERENCES);
    applyThemeToDocument(resolvedThemeId, customThemes);
  }, [resolvedThemeId, customThemes]);
```

Add a subscription that refreshes custom themes when the store changes:

```javascript
  useEffect(() => themesStore.subscribe(() => setCustomThemes(listCustomThemes())), []);
```

(`setFixedThemeIdFromPicker` still guards with `isThemeId`; leave it — Plan 2 will route custom
selection through a new action. This task only makes the engine custom-aware; no new UI yet.)

- [ ] **Step 3: Verify**

Run: `npx vitest run src/hooks src/preferences src/theme`
Expected: PASS. (If `useSettings` has a test that constructs the hook, ensure it still mounts; the new
`themesStore.subscribe` mirrors the existing `settingsStore.subscribe` pattern.)

- [ ] **Step 4: Commit**

```bash
git add src/main.jsx src/hooks/useSettings.js
git commit -m "feat(theme): load and thread custom themes through boot and useSettings"
```

---

### Task 8: Full verification

- [ ] **Step 1: First-paint unchanged**

Run: `npm run theme:generate` then `git status --short`
Expected: no change to `src/generated/theme-fallbacks.css` (first paint is still `plvs-dark`).

- [ ] **Step 2: Full project check**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 3: Headless smoke (seed a custom theme via the store)**

In the app's dev console (or a throwaway test), seed and select a custom theme to confirm end-to-end
resolution/apply, e.g.:

```javascript
import { upsertCustomTheme } from "./src/theme/customThemesRepo.js";
import { makeCustomThemeFromBase } from "./src/theme/customTheme.js";
import { BUILTIN_THEMES } from "./src/theme/builtinThemes.js";
const t = makeCustomThemeFromBase(BUILTIN_THEMES["plvs-dark"], "Smoke", () => "custom-smoke");
upsertCustomTheme({ ...t, seeds: { ...t.seeds, accent: "#22d3ee" } });
// then set settings appearance=fixed, themeId="custom-smoke" and reload
```
Expected: the app renders with the cyan accent. (This is a manual confirmation that Plan 2's UI will
drive; no commit.)

- [ ] **Step 4: Commit any formatting auto-fixes**

```bash
git add -A && git commit -m "chore(theme): formatting after custom-theme foundation" || echo "nothing to commit"
```

---

## Self-Review

- **Spec coverage:** §4 `CustomTheme` model (Task 2); §5.1 `themesStore` + export/reset (Task 1) and
  repo (Task 3); §5.2 registry `getTheme`/`isKnownThemeId` (Task 4), `resolveThemeId(customThemes)`
  (Task 5), `applyThemeToDocument(customThemes)` + spectrogram colormap (Task 6), boot + `useSettings`
  threading (Task 7). Deleted-id fallback verified in Task 5.
- **Out of scope (Plan 2):** floating editor, color control, draft semantics, Settings create/edit/
  delete UI, routing custom selection through the picker. Task 7 deliberately leaves
  `setFixedThemeIdFromPicker` guarded by `isThemeId`.
- **Placeholder scan:** none — full code in every code step.
- **Type consistency:** `customThemes` is a `Record<id, CustomTheme>` map everywhere
  (`listCustomThemes` → registry/resolve/apply). `getTheme`/`isKnownThemeId` signatures match their
  use in Tasks 5–7. `makeCustomThemeFromBase(base, name, makeId)` is used consistently in tests.
