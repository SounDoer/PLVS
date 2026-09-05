# Per-Item Import / Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user export one or more loudness profiles, layout presets or custom themes to a file, and let another user import that file into their own library without losing anything they already have.

**Architecture:** Three pack file kinds share one envelope (`src/transfer/packShape.js`). Import is merge-only and append-only: nothing local is ever overwritten or deleted, so the write-back reduces to "append these N items" (`src/transfer/libraryAdapters.js`). All conflict rules live in a pure function (`src/transfer/mergeIntoLibrary.js`) that never touches a store. One movable dialog (`src/components/ItemPickerDialog.jsx`) serves both directions: pick items to export, or review a parsed file before importing.

**Tech Stack:** React 19, Vitest, Radix Dialog, `@tauri-apps/plugin-dialog`, the existing `src/persistence/` domain stores.

**Spec:** `docs/superpowers/specs/2026-09-05-item-transfer-design.md`

---

## Background the engineer needs

Read the spec first. Beyond it, four facts about this codebase that will otherwise cost you time:

1. **Where the three libraries live** — loudness profiles are a blob inside `settingsStore` (`{ active, profiles: [] }`), presets are `presetsStore` (`{ list: [], activeId, dirty }`), themes are `themesStore` (`{ themes: {id: doc}, order: [id] }`). They are not symmetric and this change does not make them symmetric; `libraryAdapters.js` absorbs the difference.

2. **Built-in themes are not in `themesStore`.** Only user-authored themes are. So "export a theme" means "export a custom theme", and the picker lists exactly what `listCustomThemesOrdered()` returns.

3. **Never import `workspace/registry.jsx`** — directly or transitively. It evaluates every canvas panel (~2s) and will blow Vitest's 5s per-test timeout somewhere unrelated. `workspace/panelInstances.js` (which exports `hasKnownModulesOnly`) imports only `moduleCatalog.js` and is safe.

4. **Preset snapshots carry numbers that were Rust `f32`.** Test fixtures must use values Float32 holds exactly — `Math.fround(x)`, or powers-of-two divisors like `0.25`, `0.5`, `0.875`. `Math.fround(-0.4)` is `-0.4000000059604645`, and a fixture written `-0.4` will fail against a correct implementation.

Tests live next to their source, named `*.test.js` / `*.test.jsx`. Run a single file with `npx vitest run <path>`. The merge gate is `npm run check`.

---

## File Structure

**Create:**

| File | Responsibility |
| --- | --- |
| `src/transfer/packShape.js` | The three kinds' constants; build a pack; parse and validate one. The only module that knows the file format. |
| `src/transfer/packShape.test.js` | Round-trip and every rejection case. |
| `src/transfer/mergeIntoLibrary.js` | Pure conflict rules: added / skipped / duplicated, name suffixing, preset profile remap. Touches no store. |
| `src/transfer/mergeIntoLibrary.test.js` | The rules, per kind, plus the remap path. |
| `src/transfer/libraryAdapters.js` | Per-kind `list()` and `append()` over the three containers. The only module that knows a container shape. |
| `src/transfer/libraryAdapters.test.js` | Write-back into each container. |
| `src/transfer/usePackTransfer.js` | Hook: file dialogs, read/write, dialog state, status text. |
| `src/transfer/usePackTransfer.test.jsx` | Export and import flows with mocked IPC. |
| `src/components/ItemPickerDialog.jsx` | One movable dialog, two modes. |
| `src/components/ItemPickerDialog.test.jsx` | Both modes, dependency rows, empty state. |

**Modify:**

| File | Change |
| --- | --- |
| `src/ipc/fileDialog.js` | Add `pickPackFile(type)` / `savePackFile(type, defaultPath)`. |
| `src/components/SettingsPanel.jsx` | Three new rows above the existing Configuration row. |
| `src/components/AppSettingsOverlays.jsx` | Wire the hook and render the dialog. |

---

### Task 1: Pack constants and `buildPack`

**Files:**
- Create: `src/transfer/packShape.js`
- Create: `src/transfer/packShape.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/transfer/packShape.test.js`:

```js
import { describe, expect, it } from "vitest";
import { PACK_KINDS, PACK_VERSION, buildPack } from "./packShape.js";

describe("buildPack", () => {
  it("stamps the envelope for a loudness pack", () => {
    const pack = buildPack("loudness", [{ id: "a", name: "A", referenceLufs: -23, rules: [] }], {
      exportedAt: "2026-09-05T00:00:00.000Z",
    });
    expect(pack).toEqual({
      app: "PLVS",
      kind: "loudness-pack",
      version: PACK_VERSION,
      exportedAt: "2026-09-05T00:00:00.000Z",
      items: [{ id: "a", name: "A", referenceLufs: -23, rules: [] }],
    });
  });

  it("drops items the normalizer rejects", () => {
    const pack = buildPack("loudness", [{ name: "no id" }], { exportedAt: "x" });
    expect(pack.items).toEqual([]);
  });

  it("carries referenced profiles on a preset pack and omits unreferenced ones", () => {
    const preset = { id: "p1", name: "P1", loudnessProfileActive: "profile:a", tree: null };
    const profiles = [
      { id: "a", name: "A", referenceLufs: -23, rules: [] },
      { id: "b", name: "B", referenceLufs: -16, rules: [] },
    ];
    const pack = buildPack("presets", [preset], {
      exportedAt: "x",
      loudnessProfiles: profiles,
    });
    expect(pack.loudnessProfiles.map((p) => p.id)).toEqual(["a"]);
  });

  it("omits the loudnessProfiles field on non-preset kinds", () => {
    const pack = buildPack("loudness", [], { exportedAt: "x" });
    expect("loudnessProfiles" in pack).toBe(false);
  });

  it("exposes one descriptor per kind", () => {
    expect(Object.keys(PACK_KINDS).sort()).toEqual(["loudness", "presets", "themes"]);
    expect(PACK_KINDS.themes.extension).toBe("plvstheme");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/transfer/packShape.test.js`
Expected: FAIL — `Failed to resolve import "./packShape.js"`.

- [ ] **Step 3: Write the implementation**

Create `src/transfer/packShape.js`:

```js
/// The pack file format: three kinds, one envelope. The only module that knows what a pack file
/// looks like on disk. Modelled on `src/persistence/profileShape.js`, which does the same job for
/// the whole-configuration `.plvsconfig` file.
///
/// A pack is a *sharing* artefact, not a backup: import merges it into the recipient's library and
/// never overwrites anything, so nothing here needs to describe removal or selection state.

import { normalizeRuleDocument } from "../lib/loudnessProfileNormalize.js";
import { parseSelection } from "../lib/loudnessProfileCatalog.js";
import { normalizeThemeDocument } from "../theme/migrations/migrateV1Theme.js";
// `panelInstances.js` imports `moduleCatalog.js` only. Never reach `workspace/registry.jsx` from
// here -- it evaluates every canvas panel and costs about two seconds per import.
import { hasKnownModulesOnly } from "../workspace/panelInstances.js";

export const PACK_APP = "PLVS";
export const PACK_VERSION = 1;

function normalizePresetEntry(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (typeof raw.id !== "string" || raw.id.length === 0) return null;
  if (typeof raw.name !== "string" || raw.name.trim().length === 0) return null;
  if (!hasKnownModulesOnly(raw)) return null;
  return { ...raw };
}

/// One descriptor per library. `type` is this app's internal name; `kind` is what goes in the file.
export const PACK_KINDS = {
  loudness: {
    type: "loudness",
    kind: "loudness-pack",
    extension: "plvsloudness",
    label: "Loudness Profiles",
    filterName: "PLVS Loudness Profiles",
    defaultBaseName: "plvs-loudness",
    normalizeItem: normalizeRuleDocument,
  },
  presets: {
    type: "presets",
    kind: "preset-pack",
    extension: "plvspreset",
    label: "Presets",
    filterName: "PLVS Presets",
    defaultBaseName: "plvs-presets",
    normalizeItem: normalizePresetEntry,
  },
  themes: {
    type: "themes",
    kind: "theme-pack",
    extension: "plvstheme",
    label: "Theme",
    filterName: "PLVS Themes",
    defaultBaseName: "plvs-themes",
    normalizeItem: normalizeThemeDocument,
  },
};

export function packDescriptor(type) {
  const descriptor = PACK_KINDS[type];
  if (!descriptor) throw new Error(`Unknown pack type: ${type}`);
  return descriptor;
}

/// The profile ids a set of presets refers to. `off` and malformed selections yield nothing.
export function referencedProfileIds(presets) {
  const ids = new Set();
  for (const preset of presets) {
    const { kind, id } = parseSelection(preset?.loudnessProfileActive);
    if (kind === "profile" && id) ids.add(id);
  }
  return ids;
}

export function buildPack(type, items, { exportedAt = new Date().toISOString(), loudnessProfiles = [] } = {}) {
  const descriptor = packDescriptor(type);
  const normalizedItems = (Array.isArray(items) ? items : [])
    .map((item) => descriptor.normalizeItem(item))
    .filter(Boolean);

  const pack = {
    app: PACK_APP,
    kind: descriptor.kind,
    version: PACK_VERSION,
    exportedAt,
    items: normalizedItems,
  };

  if (type === "presets") {
    const wanted = referencedProfileIds(normalizedItems);
    pack.loudnessProfiles = (Array.isArray(loudnessProfiles) ? loudnessProfiles : [])
      .map((profile) => normalizeRuleDocument(profile))
      .filter((profile) => profile && wanted.has(profile.id));
  }

  return pack;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/transfer/packShape.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/transfer/packShape.js src/transfer/packShape.test.js
git commit -m "feat(transfer): define the pack file envelope and builder"
```

---

### Task 2: `parsePack` and its rejections

**Files:**
- Modify: `src/transfer/packShape.js`
- Modify: `src/transfer/packShape.test.js`

- [ ] **Step 1: Write the failing test**

Append to `src/transfer/packShape.test.js`:

```js
import { PackValidationError, parsePack } from "./packShape.js";

describe("parsePack", () => {
  const good = {
    app: "PLVS",
    kind: "theme-pack",
    version: 1,
    exportedAt: "2026-09-05T00:00:00.000Z",
    items: [],
  };

  it("accepts a well-formed pack of the expected type", () => {
    expect(parsePack(good, "themes")).toEqual({ ...good, items: [] });
  });

  it("rejects a non-object", () => {
    expect(() => parsePack("nope", "themes")).toThrow(PackValidationError);
    expect(() => parsePack("nope", "themes")).toThrow(/not a PLVS file/i);
  });

  it("rejects a file from another app", () => {
    expect(() => parsePack({ ...good, app: "OTHER" }, "themes")).toThrow(/not a PLVS file/i);
  });

  it("names the right row when the kind is a known but different pack", () => {
    expect(() => parsePack({ ...good, kind: "preset-pack" }, "themes")).toThrow(
      "This is a Presets file. Import it from the Presets row."
    );
  });

  it("rejects the whole-configuration file with its own message", () => {
    expect(() => parsePack({ ...good, kind: "configuration-profile" }, "themes")).toThrow(
      /whole configuration/i
    );
  });

  it("rejects a newer version", () => {
    expect(() => parsePack({ ...good, version: 99 }, "themes")).toThrow(/newer version/i);
  });

  it("rejects a missing version", () => {
    expect(() => parsePack({ ...good, version: "1" }, "themes")).toThrow(/missing a version/i);
  });

  it("drops items the normalizer rejects rather than failing the file", () => {
    const parsed = parsePack({ ...good, items: [{ nope: true }] }, "themes");
    expect(parsed.items).toEqual([]);
  });

  it("defaults a preset pack's loudnessProfiles to an empty array", () => {
    const parsed = parsePack(
      { app: "PLVS", kind: "preset-pack", version: 1, exportedAt: "x", items: [] },
      "presets"
    );
    expect(parsed.loudnessProfiles).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/transfer/packShape.test.js`
Expected: FAIL — `parsePack is not a function` / `PackValidationError` undefined.

- [ ] **Step 3: Write the implementation**

Append to `src/transfer/packShape.js`:

```js
/// Kind of the whole-configuration file, so a user who picks one gets told what it is instead of
/// "not a PLVS file". Mirrors `PROFILE_KIND` in `src/persistence/profileShape.js`.
const CONFIGURATION_PROFILE_KIND = "configuration-profile";

export class PackValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "PackValidationError";
  }
}

function descriptorForKind(kind) {
  return Object.values(PACK_KINDS).find((entry) => entry.kind === kind) ?? null;
}

export function parsePack(raw, expectedType) {
  const expected = packDescriptor(expectedType);

  if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.app !== PACK_APP) {
    throw new PackValidationError("This is not a PLVS file.");
  }
  if (raw.kind !== expected.kind) {
    if (raw.kind === CONFIGURATION_PROFILE_KIND) {
      throw new PackValidationError(
        "This is a whole configuration file. Import it from the Configuration row."
      );
    }
    const other = descriptorForKind(raw.kind);
    if (other) {
      throw new PackValidationError(
        `This is a ${other.label} file. Import it from the ${other.label} row.`
      );
    }
    throw new PackValidationError("This is not a PLVS file.");
  }
  if (!Number.isInteger(raw.version) || raw.version < 1) {
    throw new PackValidationError("This file is missing a version.");
  }
  if (raw.version > PACK_VERSION) {
    throw new PackValidationError("This file was made by a newer version of PLVS.");
  }

  const items = (Array.isArray(raw.items) ? raw.items : [])
    .map((item) => expected.normalizeItem(item))
    .filter(Boolean);

  const parsed = {
    app: PACK_APP,
    kind: expected.kind,
    version: raw.version,
    exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : "",
    items,
  };

  if (expectedType === "presets") {
    parsed.loudnessProfiles = (Array.isArray(raw.loudnessProfiles) ? raw.loudnessProfiles : [])
      .map((profile) => normalizeRuleDocument(profile))
      .filter(Boolean);
  }

  return parsed;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/transfer/packShape.test.js`
Expected: PASS, 14 tests.

Note the first `parsePack` test asserts `exportedAt` survives; `good.exportedAt` is a string, so `{ ...good, items: [] }` matches the returned object exactly.

- [ ] **Step 5: Commit**

```bash
git add src/transfer/packShape.js src/transfer/packShape.test.js
git commit -m "feat(transfer): parse and validate pack files with specific rejections"
```

---

### Task 3: The merge rules

**Files:**
- Create: `src/transfer/mergeIntoLibrary.js`
- Create: `src/transfer/mergeIntoLibrary.test.js`

The three dispositions from the spec: **added** (id absent), **skipped** (id present, deep-equal), **duplicated** (id present, content differs → fresh id, suffixed name). Name suffixing appends ` (2)` and increments.

- [ ] **Step 1: Write the failing test**

Create `src/transfer/mergeIntoLibrary.test.js`:

```js
import { describe, expect, it } from "vitest";
import { planMerge } from "./mergeIntoLibrary.js";

function counter() {
  let n = 0;
  return () => `new-${++n}`;
}

const A = { id: "a", name: "Alpha", referenceLufs: -23, rules: [] };

describe("planMerge", () => {
  it("adds an item whose id is absent", () => {
    const { additions, plan } = planMerge([], [A], { makeId: counter() });
    expect(additions).toEqual([A]);
    expect(plan).toEqual([{ sourceId: "a", finalId: "a", name: "Alpha", disposition: "added" }]);
  });

  it("skips an identical item", () => {
    const { additions, plan } = planMerge([A], [{ ...A }], { makeId: counter() });
    expect(additions).toEqual([]);
    expect(plan[0].disposition).toBe("skipped");
    expect(plan[0].finalId).toBe("a");
  });

  it("compares by value, not key order", () => {
    const reordered = { rules: [], referenceLufs: -23, name: "Alpha", id: "a" };
    const { plan } = planMerge([A], [reordered], { makeId: counter() });
    expect(plan[0].disposition).toBe("skipped");
  });

  it("duplicates an item whose id matches but whose content differs", () => {
    const changed = { ...A, referenceLufs: -16 };
    const { additions, plan } = planMerge([A], [changed], { makeId: counter() });
    expect(additions).toEqual([{ ...changed, id: "new-1", name: "Alpha (2)" }]);
    expect(plan).toEqual([
      { sourceId: "a", finalId: "new-1", name: "Alpha (2)", disposition: "duplicated" },
    ]);
  });

  it("suffixes a new id's name when it collides with a local name", () => {
    const { additions } = planMerge([A], [{ ...A, id: "b" }], { makeId: counter() });
    expect(additions).toEqual([{ ...A, id: "b", name: "Alpha (2)" }]);
  });

  it("increments the suffix past names already taken", () => {
    const existing = [A, { ...A, id: "a2", name: "Alpha (2)" }];
    const { additions } = planMerge(existing, [{ ...A, id: "b" }], { makeId: counter() });
    expect(additions[0].name).toBe("Alpha (3)");
  });

  it("does not let two incoming items claim the same suffixed name", () => {
    const incoming = [
      { ...A, id: "b" },
      { ...A, id: "c" },
    ];
    const { additions } = planMerge([A], incoming, { makeId: counter() });
    expect(additions.map((item) => item.name)).toEqual(["Alpha (2)", "Alpha (3)"]);
  });

  it("never changes a local entry", () => {
    const existing = [A];
    planMerge(existing, [{ ...A, referenceLufs: -16 }], { makeId: counter() });
    expect(existing).toEqual([{ id: "a", name: "Alpha", referenceLufs: -23, rules: [] }]);
  });

  it("compares nested arrays and Float32-exact numbers", () => {
    const withRules = { ...A, rules: [{ metricId: "truePeak", op: ">", value: -0.5, severity: "fail" }] };
    const same = { ...A, rules: [{ metricId: "truePeak", op: ">", value: -0.5, severity: "fail" }] };
    const different = { ...A, rules: [{ metricId: "truePeak", op: ">", value: -0.25, severity: "fail" }] };
    expect(planMerge([withRules], [same], { makeId: counter() }).plan[0].disposition).toBe("skipped");
    expect(planMerge([withRules], [different], { makeId: counter() }).plan[0].disposition).toBe(
      "duplicated"
    );
  });
});
```

`-0.5` and `-0.25` are exact in Float32 — see the Background section on `f32` fixtures.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/transfer/mergeIntoLibrary.test.js`
Expected: FAIL — `Failed to resolve import "./mergeIntoLibrary.js"`.

- [ ] **Step 3: Write the implementation**

Create `src/transfer/mergeIntoLibrary.js`:

```js
/// The conflict rules for importing a pack, as a pure function: no store, no React, no IO.
///
/// Import is *merge-only* -- nothing local is ever overwritten or deleted -- so the result is
/// simply a list of items to append plus a plan describing what happened to each incoming item.
/// That is also why the review dialog can show the outcome before anything is written: this
/// function produces the whole answer without touching the library.

const defaultMakeId = () => crypto.randomUUID();

/// Value equality over the plain-JSON documents these libraries store. `JSON.stringify` would be
/// shorter and wrong: a preset normalizer spreads the incoming object, so key order follows the
/// file rather than the local entry, and two identical presets would compare as different.
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((value, index) => deepEqual(value, b[index]));
  }
  if (typeof a !== "object") return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => Object.hasOwn(b, key) && deepEqual(a[key], b[key]));
}

/// ` (2)`, incrementing until free. Applies to the incoming item only; a local name never changes.
function freeName(name, taken) {
  if (!taken.has(name)) return name;
  let n = 2;
  while (taken.has(`${name} (${n})`)) n += 1;
  return `${name} (${n})`;
}

/**
 * @param {Array<{id: string, name: string}>} existing normalized items already in the library
 * @param {Array<{id: string, name: string}>} incoming normalized items from the pack
 * @returns {{ additions: object[], plan: Array<{sourceId: string, finalId: string, name: string,
 *   disposition: "added" | "skipped" | "duplicated"}> }}
 */
export function planMerge(existing, incoming, { makeId = defaultMakeId } = {}) {
  const byId = new Map(existing.map((item) => [item.id, item]));
  const takenNames = new Set(existing.map((item) => item.name));
  const additions = [];
  const plan = [];

  for (const item of incoming) {
    const local = byId.get(item.id);

    if (local && deepEqual(local, item)) {
      plan.push({ sourceId: item.id, finalId: item.id, name: item.name, disposition: "skipped" });
      continue;
    }

    const disposition = local ? "duplicated" : "added";
    const finalId = local ? makeId() : item.id;
    const name = freeName(item.name, takenNames);
    const added = { ...item, id: finalId, name };

    takenNames.add(name);
    byId.set(finalId, added);
    additions.push(added);
    plan.push({ sourceId: item.id, finalId, name, disposition });
  }

  return { additions, plan };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/transfer/mergeIntoLibrary.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/transfer/mergeIntoLibrary.js src/transfer/mergeIntoLibrary.test.js
git commit -m "feat(transfer): add the pure merge rules for importing library items"
```

---

### Task 4: The preset two-stage import plan

**Files:**
- Modify: `src/transfer/mergeIntoLibrary.js`
- Modify: `src/transfer/mergeIntoLibrary.test.js`

A preset pack carries the profiles its presets reference. Merge the profiles first, build an id remap from the resulting plan, then rewrite each preset's `loudnessProfileActive` through it. A profile that merged as `duplicated` is in the map, so the preset follows the copy — it should get the rules it was authored against.

- [ ] **Step 1: Write the failing test**

Append to `src/transfer/mergeIntoLibrary.test.js`:

```js
import { planPackImport } from "./mergeIntoLibrary.js";

const P = { id: "pa", name: "Prof A", referenceLufs: -23, rules: [] };

function presetPack(items, loudnessProfiles) {
  return { app: "PLVS", kind: "preset-pack", version: 1, exportedAt: "x", items, loudnessProfiles };
}

describe("planPackImport", () => {
  it("passes a non-preset pack straight through with no profile stage", () => {
    const pack = { app: "PLVS", kind: "theme-pack", version: 1, exportedAt: "x", items: [] };
    const result = planPackImport("themes", pack, { existingItems: [], makeId: counter() });
    expect(result.profileAdditions).toEqual([]);
    expect(result.profilePlan).toEqual([]);
  });

  it("imports a preset with its profile and keeps the reference", () => {
    const preset = { id: "p1", name: "P1", loudnessProfileActive: "profile:pa" };
    const result = planPackImport("presets", presetPack([preset], [P]), {
      existingItems: [],
      existingProfiles: [],
      makeId: counter(),
    });
    expect(result.profileAdditions).toEqual([P]);
    expect(result.itemAdditions[0].loudnessProfileActive).toBe("profile:pa");
  });

  it("points the preset at the copy when the profile was duplicated", () => {
    const localProfile = { ...P, referenceLufs: -16 };
    const preset = { id: "p1", name: "P1", loudnessProfileActive: "profile:pa" };
    const result = planPackImport("presets", presetPack([preset], [P]), {
      existingItems: [],
      existingProfiles: [localProfile],
      makeId: counter(),
    });
    expect(result.profileAdditions[0].id).toBe("new-1");
    expect(result.itemAdditions[0].loudnessProfileActive).toBe("profile:new-1");
  });

  it("keeps the reference when the profile was already in the library", () => {
    const preset = { id: "p1", name: "P1", loudnessProfileActive: "profile:pa" };
    const result = planPackImport("presets", presetPack([preset], [P]), {
      existingItems: [],
      existingProfiles: [P],
      makeId: counter(),
    });
    expect(result.profileAdditions).toEqual([]);
    expect(result.profilePlan[0].disposition).toBe("skipped");
    expect(result.itemAdditions[0].loudnessProfileActive).toBe("profile:pa");
  });

  it("drops a reference the pack did not carry", () => {
    const preset = { id: "p1", name: "P1", loudnessProfileActive: "profile:missing" };
    const result = planPackImport("presets", presetPack([preset], []), {
      existingItems: [],
      existingProfiles: [],
      makeId: counter(),
    });
    expect(result.itemAdditions[0].loudnessProfileActive).toBe("off");
  });

  it("leaves an Off preset alone", () => {
    const preset = { id: "p1", name: "P1", loudnessProfileActive: "off" };
    const result = planPackImport("presets", presetPack([preset], []), {
      existingItems: [],
      existingProfiles: [],
      makeId: counter(),
    });
    expect(result.itemAdditions[0].loudnessProfileActive).toBe("off");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/transfer/mergeIntoLibrary.test.js`
Expected: FAIL — `planPackImport is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/transfer/mergeIntoLibrary.js`:

```js
import { LOUDNESS_PROFILE_OFF, parseSelection, profileSelectionId } from "../lib/loudnessProfileCatalog.js";

/// Rewrites a preset's profile reference through the id map the profile stage produced. A
/// reference the pack did not carry cannot be honoured on this machine, so it degrades to Off --
/// the same thing `normalizePresets` already does for a dangling reference, made explicit here so
/// the review dialog can show it before anything is written.
function remapPresetProfile(preset, idMap) {
  const { kind, id } = parseSelection(preset.loudnessProfileActive);
  if (kind !== "profile") return { ...preset, loudnessProfileActive: LOUDNESS_PROFILE_OFF };
  const finalId = idMap.get(id);
  return {
    ...preset,
    loudnessProfileActive: finalId ? profileSelectionId(finalId) : LOUDNESS_PROFILE_OFF,
  };
}

/**
 * The whole import decision for one pack, without writing anything.
 *
 * @param {"loudness" | "presets" | "themes"} type
 * @param {object} pack a `parsePack` result
 * @param {{existingItems: object[], existingProfiles?: object[], makeId?: () => string}} context
 * @returns {{ profileAdditions: object[], profilePlan: object[], itemAdditions: object[],
 *   itemPlan: object[] }}
 */
export function planPackImport(type, pack, { existingItems, existingProfiles = [], makeId = defaultMakeId } = {}) {
  if (type !== "presets") {
    const { additions, plan } = planMerge(existingItems, pack.items, { makeId });
    return { profileAdditions: [], profilePlan: [], itemAdditions: additions, itemPlan: plan };
  }

  const profiles = planMerge(existingProfiles, pack.loudnessProfiles ?? [], { makeId });
  const idMap = new Map(profiles.plan.map((entry) => [entry.sourceId, entry.finalId]));
  const remapped = pack.items.map((preset) => remapPresetProfile(preset, idMap));
  const items = planMerge(existingItems, remapped, { makeId });

  return {
    profileAdditions: profiles.additions,
    profilePlan: profiles.plan,
    itemAdditions: items.additions,
    itemPlan: items.plan,
  };
}
```

`profileSelectionId`, `parseSelection` and `LOUDNESS_PROFILE_OFF` are all existing exports of
`src/lib/loudnessProfileCatalog.js` — `src/hooks/LoudnessProfileContext.jsx` imports the same three.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/transfer/mergeIntoLibrary.test.js`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add src/transfer/mergeIntoLibrary.js src/transfer/mergeIntoLibrary.test.js
git commit -m "feat(transfer): plan preset imports with their bundled loudness profiles"
```

---

### Task 5: Library adapters

**Files:**
- Create: `src/transfer/libraryAdapters.js`
- Create: `src/transfer/libraryAdapters.test.js`

Because import is append-only, an adapter needs exactly two operations: list what is there, and append new items. Nothing here removes or overwrites.

- [ ] **Step 1: Write the failing test**

Create `src/transfer/libraryAdapters.test.js`:

```js
import { beforeEach, describe, expect, it } from "vitest";
import { presetsStore, settingsStore, themesStore } from "../persistence/index.js";
import { getAdapter } from "./libraryAdapters.js";

// Built from a built-in rather than hand-written: `normalizeThemeDocument` rejects a document that
// is short of a single field, and a built-in is guaranteed to round-trip. `SettingsPanel.test.jsx`
// makes its custom-theme fixture the same way.
import { BUILTIN_THEMES_V2 } from "../theme/builtinThemesV2.js";

const THEME = { ...structuredClone(BUILTIN_THEMES_V2["plvs-dark"]), id: "t1", name: "T1" };

beforeEach(() => {
  settingsStore.reset();
  presetsStore.reset();
  themesStore.reset();
});

describe("loudness adapter", () => {
  it("lists the profiles in the settings blob", () => {
    settingsStore.patch({
      loudnessProfiles: { active: "off", profiles: [{ id: "a", name: "A", referenceLufs: -23, rules: [] }] },
    });
    expect(getAdapter("loudness").list().map((p) => p.id)).toEqual(["a"]);
  });

  it("appends without disturbing the active selection", () => {
    settingsStore.patch({
      loudnessProfiles: { active: "profile:a", profiles: [{ id: "a", name: "A", referenceLufs: -23, rules: [] }] },
    });
    getAdapter("loudness").append([{ id: "b", name: "B", referenceLufs: -16, rules: [] }]);
    const blob = settingsStore.read().loudnessProfiles;
    expect(blob.profiles.map((p) => p.id)).toEqual(["a", "b"]);
    expect(blob.active).toBe("profile:a");
  });
});

describe("presets adapter", () => {
  it("appends to the list without touching activeId or dirty", () => {
    presetsStore.patch({ list: [], activeId: null, dirty: false });
    getAdapter("presets").append([{ id: "p1", name: "P1", loudnessProfileActive: "off" }]);
    const raw = presetsStore.read();
    expect(raw.list.map((p) => p.id)).toEqual(["p1"]);
    expect(raw.activeId).toBe(null);
    expect(raw.dirty).toBe(false);
  });
});

describe("themes adapter", () => {
  it("appends a theme and puts it at the end of the order", () => {
    getAdapter("themes").append([THEME]);
    const raw = themesStore.read();
    expect(Object.keys(raw.themes)).toEqual(["t1"]);
    expect(raw.order).toEqual(["t1"]);
  });
});
```

Put the `BUILTIN_THEMES_V2` import with the others at the top of the file, not mid-body as shown above.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/transfer/libraryAdapters.test.js`
Expected: FAIL — `Failed to resolve import "./libraryAdapters.js"`.

- [ ] **Step 3: Write the implementation**

Create `src/transfer/libraryAdapters.js`:

```js
/// The only module that knows the three libraries' container shapes. They are genuinely different
/// -- a blob inside settings, a list beside a selection pointer, and a map beside an order array --
/// and `mergeIntoLibrary.js` deliberately never sees which is which.
///
/// Import is append-only (see the spec), so two operations are enough. Nothing here removes or
/// overwrites, and nothing here touches a selection: `active`, `activeId`, `dirty` and
/// `settings.themeId` are all left exactly as they were.

import { presetsStore, settingsStore } from "../persistence/index.js";
import { normalizeLoudnessProfiles } from "../lib/loudnessProfileNormalize.js";
import { listCustomThemesOrdered, upsertCustomTheme } from "../theme/customThemesRepo.js";
import { hasKnownModulesOnly } from "../workspace/panelInstances.js";

const adapters = {
  loudness: {
    list() {
      return normalizeLoudnessProfiles(settingsStore.read().loudnessProfiles).profiles;
    },
    append(items) {
      if (items.length === 0) return;
      const current = normalizeLoudnessProfiles(settingsStore.read().loudnessProfiles);
      settingsStore.patch({
        loudnessProfiles: { ...current, profiles: [...current.profiles, ...items] },
      });
    },
  },
  presets: {
    list() {
      const raw = presetsStore.read();
      return (Array.isArray(raw.list) ? raw.list : []).filter(hasKnownModulesOnly);
    },
    append(items) {
      if (items.length === 0) return;
      const raw = presetsStore.read();
      const list = Array.isArray(raw.list) ? raw.list : [];
      presetsStore.patch({ list: [...list, ...items] });
    },
  },
  themes: {
    list() {
      return listCustomThemesOrdered();
    },
    append(items) {
      for (const theme of items) upsertCustomTheme(theme);
    },
  },
};

export function getAdapter(type) {
  const adapter = adapters[type];
  if (!adapter) throw new Error(`Unknown library type: ${type}`);
  return adapter;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/transfer/libraryAdapters.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/transfer/libraryAdapters.js src/transfer/libraryAdapters.test.js
git commit -m "feat(transfer): add append-only adapters over the three libraries"
```

---

### Task 6: File dialog filters

**Files:**
- Modify: `src/ipc/fileDialog.js`

No test: this file is a thin wrapper over `@tauri-apps/plugin-dialog` and has no existing test file. The behaviour is covered where it is used, in Task 7.

- [ ] **Step 1: Add the two functions**

Append to `src/ipc/fileDialog.js`:

```js
/** @returns {Promise<string | null>} Absolute path, or null if the user cancelled. */
export async function pickPackFile(descriptor) {
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: descriptor.filterName, extensions: [descriptor.extension] }],
  });
  return typeof selected === "string" ? selected : null;
}

/** @returns {Promise<string | null>} Absolute path, or null if the user cancelled. */
export async function savePackFile(descriptor, defaultPath) {
  const selected = await save({
    defaultPath,
    filters: [{ name: descriptor.filterName, extensions: [descriptor.extension] }],
  });
  return typeof selected === "string" ? selected : null;
}
```

These take a `PACK_KINDS` descriptor rather than a type string so `fileDialog.js` stays free of transfer-layer imports, matching how the rest of the file takes plain values.

- [ ] **Step 2: Verify nothing broke**

Run: `npx vitest run src/ipc`
Expected: PASS (whatever the existing count is; no new failures).

- [ ] **Step 3: Commit**

```bash
git add src/ipc/fileDialog.js
git commit -m "feat(ipc): add file dialog filters for the three pack kinds"
```

---

### Task 7: The transfer hook

**Files:**
- Create: `src/transfer/usePackTransfer.js`
- Create: `src/transfer/usePackTransfer.test.jsx`

The hook owns the sequence: open the picker, write a file; or pick a file, parse it, build a plan, show the review, and on confirm append. Modelled on `src/hooks/useConfigurationProfileActions.js` — read it first — but with one difference the spec is explicit about: **errors are reported specifically, not swallowed into "Import failed".**

- [ ] **Step 1: Write the failing test**

Create `src/transfer/usePackTransfer.test.jsx`:

```jsx
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../ipc/env.js", () => ({ isTauri: () => true }));

const readProfileFile = vi.fn();
const writeProfileFile = vi.fn();
vi.mock("../ipc/commands.js", () => ({
  readProfileFile: (...args) => readProfileFile(...args),
  writeProfileFile: (...args) => writeProfileFile(...args),
}));

const pickPackFile = vi.fn();
const savePackFile = vi.fn();
vi.mock("../ipc/fileDialog.js", () => ({
  pickPackFile: (...args) => pickPackFile(...args),
  savePackFile: (...args) => savePackFile(...args),
}));

import { presetsStore, settingsStore, themesStore } from "../persistence/index.js";
import { usePackTransfer } from "./usePackTransfer.js";

beforeEach(() => {
  vi.clearAllMocks();
  settingsStore.reset();
  presetsStore.reset();
  themesStore.reset();
});

describe("usePackTransfer export", () => {
  it("writes a pack containing only the selected items", async () => {
    settingsStore.patch({
      loudnessProfiles: {
        active: "off",
        profiles: [
          { id: "a", name: "A", referenceLufs: -23, rules: [] },
          { id: "b", name: "B", referenceLufs: -16, rules: [] },
        ],
      },
    });
    savePackFile.mockResolvedValue("C:/out.plvsloudness");

    const { result } = renderHook(() => usePackTransfer());
    await act(async () => {
      await result.current.exportSelection("loudness", ["a"]);
    });

    const written = JSON.parse(writeProfileFile.mock.calls[0][1]);
    expect(written.kind).toBe("loudness-pack");
    expect(written.items.map((item) => item.id)).toEqual(["a"]);
  });

  it("names the file after the item when exactly one is selected", async () => {
    settingsStore.patch({
      loudnessProfiles: { active: "off", profiles: [{ id: "a", name: "A", referenceLufs: -23, rules: [] }] },
    });
    savePackFile.mockResolvedValue(null);

    const { result } = renderHook(() => usePackTransfer());
    await act(async () => {
      await result.current.exportSelection("loudness", ["a"]);
    });

    expect(savePackFile.mock.calls[0][1]).toBe("A.plvsloudness");
  });
});

describe("usePackTransfer import", () => {
  it("opens a review with the plan and writes nothing yet", async () => {
    readProfileFile.mockResolvedValue(
      JSON.stringify({
        app: "PLVS",
        kind: "loudness-pack",
        version: 1,
        exportedAt: "x",
        items: [{ id: "a", name: "A", referenceLufs: -23, rules: [] }],
      })
    );
    pickPackFile.mockResolvedValue("C:/in.plvsloudness");

    const { result } = renderHook(() => usePackTransfer());
    await act(async () => {
      await result.current.beginImport("loudness");
    });

    expect(result.current.review.itemPlan[0].disposition).toBe("added");
    expect(settingsStore.read().loudnessProfiles).toBeUndefined();
  });

  it("appends on confirm", async () => {
    readProfileFile.mockResolvedValue(
      JSON.stringify({
        app: "PLVS",
        kind: "loudness-pack",
        version: 1,
        exportedAt: "x",
        items: [{ id: "a", name: "A", referenceLufs: -23, rules: [] }],
      })
    );
    pickPackFile.mockResolvedValue("C:/in.plvsloudness");

    const { result } = renderHook(() => usePackTransfer());
    await act(async () => {
      await result.current.beginImport("loudness");
    });
    act(() => {
      result.current.confirmImport();
    });

    expect(settingsStore.read().loudnessProfiles.profiles.map((p) => p.id)).toEqual(["a"]);
  });

  it("reports the specific reason for a wrong-kind file", async () => {
    readProfileFile.mockResolvedValue(
      JSON.stringify({ app: "PLVS", kind: "theme-pack", version: 1, exportedAt: "x", items: [] })
    );
    pickPackFile.mockResolvedValue("C:/in.plvsloudness");

    const { result } = renderHook(() => usePackTransfer());
    await act(async () => {
      await result.current.beginImport("loudness");
    });

    expect(result.current.status).toBe("This is a Theme file. Import it from the Theme row.");
    expect(result.current.review).toBe(null);
  });

  it("reports unreadable JSON", async () => {
    readProfileFile.mockResolvedValue("{ not json");
    pickPackFile.mockResolvedValue("C:/in.plvsloudness");

    const { result } = renderHook(() => usePackTransfer());
    await act(async () => {
      await result.current.beginImport("loudness");
    });

    expect(result.current.status).toBe("This file could not be read.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/transfer/usePackTransfer.test.jsx`
Expected: FAIL — `Failed to resolve import "./usePackTransfer.js"`.

- [ ] **Step 3: Write the implementation**

Create `src/transfer/usePackTransfer.js`:

```js
/// Wiring for per-item import and export: file dialogs, JSON, and the two-step import (parse and
/// plan, then append on confirm). The rules themselves live in `mergeIntoLibrary.js`; this module
/// only sequences them.
///
/// Unlike `useConfigurationProfileActions.js`, failures keep their message: a shared file lands on
/// a machine whose user did not make it, and "Import failed" tells them nothing they can act on.

import { useCallback, useState } from "react";
import { readProfileFile, writeProfileFile } from "../ipc/commands.js";
import { isTauri } from "../ipc/env.js";
import { pickPackFile, savePackFile } from "../ipc/fileDialog.js";
import { flushPersistence } from "../persistence/index.js";
import { getAdapter } from "./libraryAdapters.js";
import { planPackImport } from "./mergeIntoLibrary.js";
import { PackValidationError, buildPack, packDescriptor, parsePack, referencedProfileIds } from "./packShape.js";

function defaultFileName(descriptor, items) {
  const base = items.length === 1 ? items[0].name : descriptor.defaultBaseName;
  const safe = String(base).replace(/[\\/:*?"<>|]/g, "-").trim() || descriptor.defaultBaseName;
  return `${safe}.${descriptor.extension}`;
}

function downloadInBrowser(fileName, contents) {
  const blob = new Blob([contents], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function usePackTransfer() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  /** @type {[null | {type: string, pack: object, profileAdditions: object[], profilePlan: object[], itemAdditions: object[], itemPlan: object[]}, Function]} */
  const [review, setReview] = useState(null);

  const exportSelection = useCallback(
    async (type, selectedIds) => {
      if (busy) return;
      setBusy(true);
      setStatus("");
      try {
        await flushPersistence();
        const descriptor = packDescriptor(type);
        const chosen = new Set(selectedIds);
        const items = getAdapter(type).list().filter((item) => chosen.has(item.id));

        const options = {};
        if (type === "presets") {
          const wanted = referencedProfileIds(items);
          options.loudnessProfiles = getAdapter("loudness")
            .list()
            .filter((profile) => wanted.has(profile.id));
        }

        const contents = `${JSON.stringify(buildPack(type, items, options), null, 2)}\n`;
        const fileName = defaultFileName(descriptor, items);

        if (!isTauri()) {
          downloadInBrowser(fileName, contents);
          setStatus(`${descriptor.label} exported`);
          return;
        }
        const path = await savePackFile(descriptor, fileName);
        if (!path) return;
        await writeProfileFile(path, contents);
        setStatus(`${descriptor.label} exported`);
      } catch (error) {
        setStatus(error instanceof PackValidationError ? error.message : "Export failed");
      } finally {
        setBusy(false);
      }
    },
    [busy]
  );

  const beginImport = useCallback(
    async (type) => {
      if (busy) return;
      setBusy(true);
      setStatus("");
      setReview(null);
      try {
        if (!isTauri()) {
          setStatus("Import is available in the desktop app");
          return;
        }
        const descriptor = packDescriptor(type);
        const path = await pickPackFile(descriptor);
        if (!path) return;

        const text = await readProfileFile(path);
        let raw;
        try {
          raw = JSON.parse(text);
        } catch (_) {
          throw new PackValidationError("This file could not be read.");
        }

        const pack = parsePack(raw, type);
        const planned = planPackImport(type, pack, {
          existingItems: getAdapter(type).list(),
          existingProfiles: type === "presets" ? getAdapter("loudness").list() : [],
        });
        setReview({ type, pack, ...planned });
      } catch (error) {
        setStatus(error instanceof PackValidationError ? error.message : "Import failed");
      } finally {
        setBusy(false);
      }
    },
    [busy]
  );

  const confirmImport = useCallback(() => {
    if (!review) return;
    const { type, profileAdditions, itemAdditions } = review;
    if (profileAdditions.length > 0) getAdapter("loudness").append(profileAdditions);
    getAdapter(type).append(itemAdditions);
    setStatus(`${packDescriptor(type).label} imported`);
    setReview(null);
  }, [review]);

  const cancelImport = useCallback(() => setReview(null), []);

  return { busy, status, review, exportSelection, beginImport, confirmImport, cancelImport };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/transfer/usePackTransfer.test.jsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/transfer/usePackTransfer.js src/transfer/usePackTransfer.test.jsx
git commit -m "feat(transfer): wire pack export and two-step import"
```

---

### Task 8: `ItemPickerDialog` — pick mode

**Files:**
- Create: `src/components/ItemPickerDialog.jsx`
- Create: `src/components/ItemPickerDialog.test.jsx`

Read `src/components/ThemeEditor.jsx` first for the movable-dialog pattern (Radix `Dialog` + `clampPanelPos` + `SCRIM_CLASS`) and copy its structure. **Do not register this dialog with `useBlockingEditor`** — it has selection state but no draft, and registering it would wrongly block preset apply and dock entry while it is open. Position is not persisted; the dialog opens centred.

- [ ] **Step 1: Write the failing test**

Create `src/components/ItemPickerDialog.test.jsx`:

```jsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ItemPickerDialog } from "./ItemPickerDialog.jsx";

const PROFILES = [
  { id: "a", name: "Alpha", referenceLufs: -23, rules: [] },
  { id: "b", name: "Beta", referenceLufs: -16, rules: [] },
];

describe("ItemPickerDialog pick mode", () => {
  it("lists the library and exports the checked ids", () => {
    const onExport = vi.fn();
    render(
      <ItemPickerDialog
        open
        mode="pick"
        type="loudness"
        items={PROFILES}
        dependencies={[]}
        onExport={onExport}
        onClose={() => {}}
      />
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Alpha" }));
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(onExport).toHaveBeenCalledWith(["a"]);
  });

  it("disables Export while nothing is checked", () => {
    render(
      <ItemPickerDialog
        open
        mode="pick"
        type="loudness"
        items={PROFILES}
        dependencies={[]}
        onExport={() => {}}
        onClose={() => {}}
      />
    );
    expect(screen.getByRole("button", { name: "Export" })).toBeDisabled();
  });

  it("shows a dependency row only once the preset that needs it is checked", () => {
    render(
      <ItemPickerDialog
        open
        mode="pick"
        type="presets"
        items={[
          { id: "p1", name: "P1", loudnessProfileActive: "profile:a" },
          { id: "p2", name: "P2", loudnessProfileActive: "off" },
        ]}
        dependencies={PROFILES}
        onExport={() => {}}
        onClose={() => {}}
      />
    );
    expect(screen.queryByText("Also included")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "P2" }));
    expect(screen.queryByText("Also included")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "P1" }));
    expect(screen.getByText("Also included")).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Beta")).not.toBeInTheDocument();
  });

  it("shows an empty state instead of a blank list", () => {
    render(
      <ItemPickerDialog
        open
        mode="pick"
        type="themes"
        items={[]}
        dependencies={[]}
        onExport={() => {}}
        onClose={() => {}}
      />
    );
    expect(screen.getByText("No custom themes to export.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/ItemPickerDialog.test.jsx`
Expected: FAIL — `Failed to resolve import "./ItemPickerDialog.jsx"`.

- [ ] **Step 3: Write the implementation**

Create `src/components/ItemPickerDialog.jsx`. Follow `ThemeEditor.jsx` for the drag handle, header and surface classes; the logic below is what matters.

```jsx
import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { SCRIM_CLASS } from "@/components/ui/surfaceStyles.js";
import { parseSelection } from "../lib/loudnessProfileCatalog.js";
import { PACK_KINDS } from "../transfer/packShape.js";

const EMPTY_MESSAGE = {
  loudness: "No loudness profiles to export.",
  presets: "No presets to export.",
  themes: "No custom themes to export.",
};

const DISPOSITION_LABEL = {
  added: "Add",
  skipped: "Already in your library",
  duplicated: "Import as a copy",
};

function PlanRow({ entry }) {
  return (
    <li className="flex items-center justify-between gap-3 py-1">
      <span>{entry.name}</span>
      <span className="text-muted-foreground">{DISPOSITION_LABEL[entry.disposition]}</span>
    </li>
  );
}

/// One dialog, two directions. `pick` chooses library items to write to a file; `review` shows what
/// a parsed file would do before anything is written.
///
/// Deliberately NOT registered with `useBlockingEditor`: it holds selection state, not a draft, so
/// closing it discards nothing the user authored, and neither mode performs a scene operation.
/// Registering it would block preset apply and dock entry for no reason.
export function ItemPickerDialog({
  open,
  mode,
  type,
  items = [],
  dependencies = [],
  review = null,
  onExport = () => {},
  onConfirm = () => {},
  onClose = () => {},
}) {
  const [selected, setSelected] = useState(() => new Set());
  const label = PACK_KINDS[type].label;

  useEffect(() => {
    if (!open) setSelected(new Set());
  }, [open]);

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Which bundled profiles the current selection drags along. Derived from the checked presets
  // rather than passed in, so the caller hands over the plain profile library and nothing has to
  // stay in sync with the checkboxes.
  const neededProfileIds = new Set(
    type === "presets"
      ? items
          .filter((item) => selected.has(item.id))
          .map((item) => parseSelection(item.loudnessProfileActive))
          .filter((selection) => selection.kind === "profile")
          .map((selection) => selection.id)
      : []
  );
  const shownDependencies = dependencies.filter((dep) => neededProfileIds.has(dep.id));

  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <Dialog.Portal>
        <Dialog.Overlay className={SCRIM_CLASS} />
        <Dialog.Content aria-label={mode === "pick" ? `Export ${label}` : `Import ${label}`}>
          <Dialog.Title>{mode === "pick" ? `Export ${label}` : `Import ${label}`}</Dialog.Title>

          {mode === "pick" ? (
            <>
              {items.length === 0 ? (
                <p>{EMPTY_MESSAGE[type]}</p>
              ) : (
                <ul>
                  {items.map((item) => (
                    <li key={item.id}>
                      <label>
                        <input
                          type="checkbox"
                          aria-label={item.name}
                          checked={selected.has(item.id)}
                          onChange={() => toggle(item.id)}
                        />
                        {item.name}
                      </label>
                    </li>
                  ))}
                </ul>
              )}

              {shownDependencies.length > 0 ? (
                <section>
                  <h3>Also included</h3>
                  <ul>
                    {shownDependencies.map((dep) => (
                      <li key={dep.id}>{dep.name}</li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <div>
                <Button onClick={onClose} variant="ghost">
                  Cancel
                </Button>
                <Button disabled={selected.size === 0} onClick={() => onExport([...selected])}>
                  Export
                </Button>
              </div>
            </>
          ) : (
            <>
              <ul>
                {review?.itemPlan.map((entry) => (
                  <PlanRow key={entry.sourceId} entry={entry} />
                ))}
              </ul>
              {review?.profilePlan.length > 0 ? (
                <section>
                  <h3>Also included</h3>
                  <ul>
                    {review.profilePlan.map((entry) => (
                      <PlanRow key={entry.sourceId} entry={entry} />
                    ))}
                  </ul>
                </section>
              ) : null}
              <div>
                <Button onClick={onClose} variant="ghost">
                  Cancel
                </Button>
                <Button onClick={onConfirm}>Import</Button>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

`dependencies` is simply the whole loudness-profile library; the component works out which entries the current selection needs. In `loudness` and `themes` mode the caller passes `[]` and the section never renders.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/ItemPickerDialog.test.jsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/ItemPickerDialog.jsx src/components/ItemPickerDialog.test.jsx
git commit -m "feat(transfer): add the item picker dialog in pick mode"
```

---

### Task 9: `ItemPickerDialog` — review mode

**Files:**
- Modify: `src/components/ItemPickerDialog.test.jsx`

The component already renders review mode (Task 8); this task pins its behaviour.

- [ ] **Step 1: Write the failing test**

Append to `src/components/ItemPickerDialog.test.jsx`:

```jsx
describe("ItemPickerDialog review mode", () => {
  const review = {
    itemPlan: [
      { sourceId: "p1", finalId: "p1", name: "P1", disposition: "added" },
      { sourceId: "p2", finalId: "p2", name: "P2", disposition: "skipped" },
      { sourceId: "p3", finalId: "x", name: "P3 (2)", disposition: "duplicated" },
    ],
    profilePlan: [{ sourceId: "a", finalId: "a", name: "Alpha", disposition: "added" }],
  };

  it("labels each row with its disposition", () => {
    render(
      <ItemPickerDialog open mode="review" type="presets" review={review} onConfirm={() => {}} onClose={() => {}} />
    );
    expect(screen.getByText("P1").closest("li")).toHaveTextContent("Add");
    expect(screen.getByText("P2").closest("li")).toHaveTextContent("Already in your library");
    expect(screen.getByText("P3 (2)").closest("li")).toHaveTextContent("Import as a copy");
  });

  it("shows the bundled profiles under Also included", () => {
    render(
      <ItemPickerDialog open mode="review" type="presets" review={review} onConfirm={() => {}} onClose={() => {}} />
    );
    expect(screen.getByText("Also included")).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });

  it("confirms only when Import is pressed", () => {
    const onConfirm = vi.fn();
    render(
      <ItemPickerDialog open mode="review" type="presets" review={review} onConfirm={onConfirm} onClose={() => {}} />
    );
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run src/components/ItemPickerDialog.test.jsx`
Expected: the three new tests pass if Task 8's review branch is correct. If any fail, fix the component — not the test.

- [ ] **Step 3: Commit**

```bash
git add src/components/ItemPickerDialog.test.jsx
git commit -m "test(transfer): pin the item picker's review mode"
```

---

### Task 10: Settings rows and wiring

**Files:**
- Modify: `src/components/SettingsPanel.jsx` (the Configuration section, around line 566)
- Modify: `src/components/AppSettingsOverlays.jsx`
- Modify: `src/components/SettingsPanel.test.jsx`

- [ ] **Step 1: Write the failing test**

Append to `src/components/SettingsPanel.test.jsx`. That file has no render helper — it spreads a
module-level `BASE_PROPS` object into a plain `render(<SettingsPanel … />)`, so follow that:

```jsx
it("offers export and import for each library above the Configuration row", () => {
  const onPackExport = vi.fn();
  render(<SettingsPanel {...BASE_PROPS} onPackExport={onPackExport} onPackImport={vi.fn()} />);

  for (const label of ["loudness profiles", "presets", "theme"]) {
    expect(screen.getByRole("button", { name: `Export ${label}` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Import ${label}` })).toBeInTheDocument();
  }

  fireEvent.click(screen.getByRole("button", { name: "Export presets" }));
  expect(onPackExport).toHaveBeenCalledWith("presets");
});
```

`aria-label`s stay lowercase — that is the codebase convention (AGENTS.md, Code style). Visible labels are Title Case.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/SettingsPanel.test.jsx`
Expected: FAIL — `Unable to find an accessible element with the role "button" and name "Export loudness profiles"`.

- [ ] **Step 3: Add the rows**

In `src/components/SettingsPanel.jsx`, add two props alongside the existing `onExportConfiguration` group:

```jsx
  onPackExport = () => {},
  onPackImport = () => {},
```

Then, immediately **above** the existing `<SettingsRow label="Configuration" …>` inside the Configuration `<SettingsSection>`, add three rows built from one local list:

```jsx
{[
  { type: "loudness", label: "Loudness Profiles", aria: "loudness profiles" },
  { type: "presets", label: "Presets", aria: "presets" },
  { type: "themes", label: "Theme", aria: "theme" },
].map((row) => (
  <SettingsRow key={row.type} label={row.label} className="settings-row-stackable">
    <div className="flex items-center gap-2.5">
      <button
        type="button"
        onClick={() => onPackExport(row.type)}
        disabled={configurationBusy}
        aria-label={`Export ${row.aria}`}
        className={CONFIG_TEXT_BTN_CLASS}
      >
        Export…
      </button>
      <button
        type="button"
        onClick={() => onPackImport(row.type)}
        disabled={configurationBusy}
        aria-label={`Import ${row.aria}`}
        className={CONFIG_TEXT_BTN_CLASS}
      >
        Import…
      </button>
    </div>
  </SettingsRow>
))}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/SettingsPanel.test.jsx`
Expected: PASS.

- [ ] **Step 5: Wire the hook and the dialog**

In `src/components/AppSettingsOverlays.jsx`, call `usePackTransfer()`, hold the pick-mode dialog's own open state, and render `ItemPickerDialog` twice — once for pick (opened by `onPackExport`) and once for review (open whenever `review` is non-null):

```jsx
import { useState } from "react";
import { ItemPickerDialog } from "./ItemPickerDialog.jsx";
import { getAdapter } from "../transfer/libraryAdapters.js";
import { usePackTransfer } from "../transfer/usePackTransfer.js";

// inside the component:
const pack = usePackTransfer();
const [pickType, setPickType] = useState(null);
```

Pass `onPackExport={setPickType}` and `onPackImport={pack.beginImport}` to `SettingsPanel`, then render:

```jsx
{pickType ? (
  <ItemPickerDialog
    open
    mode="pick"
    type={pickType}
    items={getAdapter(pickType).list()}
    dependencies={pickType === "presets" ? getAdapter("loudness").list() : []}
    onExport={async (ids) => {
      await pack.exportSelection(pickType, ids);
      setPickType(null);
    }}
    onClose={() => setPickType(null)}
  />
) : null}

{pack.review ? (
  <ItemPickerDialog
    open
    mode="review"
    type={pack.review.type}
    review={pack.review}
    onConfirm={pack.confirmImport}
    onClose={pack.cancelImport}
  />
) : null}
```

- [ ] **Step 6: Run the overlay tests**

Run: `npx vitest run src/components/AppSettingsOverlays.test.jsx`
Expected: PASS. If the existing tests render this component without the new stores seeded, `getAdapter(...).list()` still returns `[]` safely.

- [ ] **Step 7: Commit**

```bash
git add src/components/SettingsPanel.jsx src/components/SettingsPanel.test.jsx src/components/AppSettingsOverlays.jsx
git commit -m "feat(settings): add per-library export and import rows"
```

---

### Task 11: Full gate

**Files:** none

- [ ] **Step 1: Run the merge gate**

Run: `npm run check`
Expected: PASS — version check, format, lint, the full Vitest suite, the Vite build, and Rust fmt/clippy/test.

If a Vitest failure appears in `scripts/tauriSecurityConfig.test.js` or `scripts/tauriDependencyContract.test.js`, it is not a frontend failure: those suites read `src-tauri/tauri.conf.json` and the NSIS hooks. This change touches neither, so such a failure means something else on `main` moved — investigate before assuming it is yours.

No capture-layer code is touched, so `smoke:capture` and `soak:capture` are not implicated and need not be run.

- [ ] **Step 2: Commit any formatting the gate applied**

```bash
git status --short
git commit -am "chore: apply formatting from npm run check"
```

Skip if the tree is clean.

---

## Manual verification

`npm run check` cannot see the file dialogs. After the gate is green, run `npm run desktop` and confirm:

1. Settings shows four rows in Configuration, the three new ones above the existing one.
2. Export a theme → the picker lists your custom themes, checking one enables Export, and the save dialog offers `<name>.plvstheme`.
3. Import that same file → the review says "Already in your library", and confirming changes nothing.
4. Edit the theme, export it again to a second file, then import the *first* file → the review says "Import as a copy" and confirming adds a second entry named `<name> (2)`. The original is untouched.
5. Export a preset that uses a loudness profile → the picker shows the profile under "Also included"; importing that file on a machine without the profile adds both, and the preset still points at the profile.
6. Pick a `.plvsconfig` in one of the new Import dialogs is not possible (the filter excludes it); pick a `.plvstheme` from the Presets row by typing its name and confirm the message names the Theme row.
