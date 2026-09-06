# Library Transfer Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the three library export/import operations the Settings panel already offers — Loudness Profiles, Presets and Theme — through App Control, opening the `theme` and `loudnessProfile` command families.

**Architecture:** The GUI's transfer logic (`src/transfer/`) is already pure and store-facing; App Control calls the same modules rather than restating them. A new `src/agentControl/libraryTransfer.js` holds the App Control layer (id resolution, result shapes) so the 1846-line bridge only gains dispatch. The CLI gets one `parse_library_args` covering all three families, and `--out` file writing happens in Rust — the frontend never touches the filesystem.

**Tech Stack:** React 19, Vitest (node environment by default), Tauri 2, Rust, JSON-RPC over a local Windows named pipe.

**Spec:** [`docs/superpowers/specs/2026-09-06-agent-control-library-transfer-design.md`](../specs/2026-09-06-agent-control-library-transfer-design.md)

---

## Things that will bite you

Read these before Task 1. Each cost a real commit to learn.

1. **`vite.config.js` sets the Vitest environment to `node`.** Any test that renders React or touches a persistence store needs `/** @vitest-environment jsdom */` as its literal first line. Omit it and there is no error — `localStorage` is undefined, `localStorageBackend` silently no-ops, and assertions fail against defaults, which reads like a bug in the code under test.

2. **`@testing-library/jest-dom` is not a dependency.** No `toBeInTheDocument()`, no `toBeDisabled()`. The repo idiom is a bare `getBy*` (which throws when absent), `expect(x).toBeTruthy()`, `expect(queryBy*(...)).toBeNull()`, `expect(el.disabled).toBe(true)`.

3. **Never import `src/workspace/registry.jsx` from a logic module.** It evaluates all eight canvas panels and costs ~2s. `packShape.js` already imports `panelInstances.js` for exactly this reason. Import `workspace/moduleCatalog.js` if you need module ids.

4. **A theme test fixture must be a real Theme V2 document.** `packShape.js`'s `normalizeThemeDocument` runs full Theme V2 validation, and a bare `{ id, name, tokens: {} }` fails it — silently. The normalizer returns `null`, `parsePack` and `buildPack` filter it out, and you get an empty `items` array with no error, so the assertion that fails is `changed: true` and it reads like a bug in the code under test. Build one the way `src/transfer/packShape.test.js` already does:

```js
import { BUILTIN_THEMES_V2 } from "../theme/builtinThemesV2.js";

function makeTheme(id, name) {
  return { ...structuredClone(BUILTIN_THEMES_V2["plvs-dark"]), id, name };
}
```

Every theme fixture in this plan's test code assumes `makeTheme` is defined in that file. Loudness profile and preset fixtures are not affected — their normalizers accept the plain shapes shown.

5. **`npm run check` is the merge gate** and it also runs Rust fmt/clippy/test. Some Vitest suites in `scripts/` read `src-tauri/tauri.conf.json`; you are not touching those, but if one goes red it is not an unrelated frontend failure.

6. **Do not edit `src/generated/` or `docs/agent-control/generated/` by hand.** This work adds no generated page (these commands have no field schema), so you should not need to run `npm run docs:agent-control` — but if `publicSurfaceDocs.test.js` goes red, that command is the fix, not an edit.

---

## File Structure

**Create:**

| Path | Responsibility |
| --- | --- |
| `src/transfer/collectPackItems.js` | Pure: resolve ids to items for one library, including the preset→profile bundling rule. Shared by the GUI hook and the App Control handler. |
| `src/transfer/collectPackItems.test.js` | Its tests. |
| `src/agentControl/libraryTransfer.js` | The App Control layer: `LIBRARY_FAMILIES`, `planLibraryExport`, `planLibraryImport`, result builders. No React. |
| `src/agentControl/libraryTransfer.test.js` | Its tests. |
| `src/agentControl/libraryTransferContract.test.js` | The guard: `PACK_KINDS` and the registered method list agree in both directions. |
| `docs/agent-control/libraries.md` | The public contract page. |

**Modify:**

| Path | Change |
| --- | --- |
| `src/transfer/usePackTransfer.js` | Call `collectPackItems` instead of inlining the bundling rule. |
| `src/agentControl/appSnapshot.js` | Nine new entries in `METHODS`. |
| `src/agentControl/protocol.js` | Accept and shape-check the nine new methods. |
| `src/agentControl/useAgentControlBridge.js` | Dispatch the nine methods; add theme/loudness revision tracking; accept a `customThemes` prop. |
| `src/App.jsx:1246` | Pass `customThemes`. |
| `src-tauri/src/cli_app.rs` | New command variants, `parse_library_args`, method/params mapping, `--out` writing, help text, exit-code classification. |
| `shared/cli-v1-envelope-fixtures.json` | One added fixture pinning the import result's `plan` shape. |
| `docs/agent-control/README.md`, `presets.md`, `settings.md`, `docs/cli.md` | Contract text. |

---

## Task 1: `collectPackItems` — the shared export rule

The preset pack bundles the Loudness Profiles its presets refer to. That rule currently lives inside `usePackTransfer.exportSelection` (a React hook), and the App Control export handler needs the same rule. Extract it first, so both callers exist against one implementation from the start.

**Files:**
- Create: `src/transfer/collectPackItems.js`
- Create: `src/transfer/collectPackItems.test.js`
- Modify: `src/transfer/usePackTransfer.js`

- [ ] **Step 1: Write the failing test**

Create `src/transfer/collectPackItems.test.js`:

```js
/** @vitest-environment jsdom */
import { describe, expect, it, beforeEach } from "vitest";
import { resetAll, presetsStore, settingsStore } from "../persistence/index.js";
import { collectPackItems } from "./collectPackItems.js";

const PROFILE_A = { id: "prof-a", name: "EBU R128", referenceLufs: -23, rules: [] };
const PROFILE_B = { id: "prof-b", name: "ATSC A/85", referenceLufs: -24, rules: [] };

function seedPresets() {
  presetsStore.patch({
    list: [
      { id: "p-1", name: "Mix", panelOrder: [], panelsById: {}, loudnessProfileActive: "profile:prof-a" },
      { id: "p-2", name: "Master", panelOrder: [], panelsById: {}, loudnessProfileActive: "off" },
    ],
  });
  settingsStore.patch({ loudnessProfiles: { profiles: [PROFILE_A, PROFILE_B] } });
}

describe("collectPackItems", () => {
  beforeEach(() => {
    resetAll();
  });

  it("returns the selected items for a plain library", () => {
    settingsStore.patch({ loudnessProfiles: { profiles: [PROFILE_A, PROFILE_B] } });
    const result = collectPackItems("loudness", ["prof-b"]);
    expect(result.missingIds).toEqual([]);
    expect(result.items.map((item) => item.id)).toEqual(["prof-b"]);
    expect(result.options).toEqual({});
  });

  it("bundles the profiles the selected presets refer to", () => {
    seedPresets();
    const result = collectPackItems("presets", ["p-1", "p-2"]);
    expect(result.items.map((item) => item.id)).toEqual(["p-1", "p-2"]);
    expect(result.options.loudnessProfiles.map((p) => p.id)).toEqual(["prof-a"]);
  });

  it("reports ids that are not in the library instead of dropping them", () => {
    seedPresets();
    const result = collectPackItems("presets", ["p-1", "ghost", "gone"]);
    expect(result.missingIds).toEqual(["ghost", "gone"]);
  });

  it("selects the whole library when ids is null", () => {
    seedPresets();
    const result = collectPackItems("presets", null);
    expect(result.items.map((item) => item.id)).toEqual(["p-1", "p-2"]);
    expect(result.missingIds).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/transfer/collectPackItems.test.js
```

Expected: FAIL — `Failed to resolve import "./collectPackItems.js"`.

- [ ] **Step 3: Write the implementation**

Create `src/transfer/collectPackItems.js`:

```js
/// Resolves an export selection to the items and the extra pack options `buildPack` needs.
///
/// Lives here rather than in `usePackTransfer.js` because App Control's export handler needs the
/// same rule, and a pack's contents are pack-format logic, not GUI wiring.

import { getAdapter } from "./libraryAdapters.js";
import { referencedProfileIds } from "./packShape.js";

/**
 * @param {"loudness" | "presets" | "themes"} type
 * @param {string[] | null} ids selected ids, or null for the whole library
 * @returns {{ items: object[], options: object, missingIds: string[] }}
 *   `missingIds` is non-empty when a requested id is not in the library. The caller decides whether
 *   that is an error; this function never silently drops one.
 */
export function collectPackItems(type, ids) {
  const library = getAdapter(type).list();

  let items = library;
  let missingIds = [];
  if (ids !== null) {
    const byId = new Map(library.map((item) => [item.id, item]));
    missingIds = ids.filter((id) => !byId.has(id));
    // Library order, not selection order: a pack is a snapshot of part of a library, and two
    // exports of the same set must produce the same file.
    const wanted = new Set(ids);
    items = library.filter((item) => wanted.has(item.id));
  }

  const options = {};
  if (type === "presets") {
    const wanted = referencedProfileIds(items);
    options.loudnessProfiles = getAdapter("loudness")
      .list()
      .filter((profile) => wanted.has(profile.id));
  }

  return { items, options, missingIds };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/transfer/collectPackItems.test.js
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Make the GUI hook use it**

In `src/transfer/usePackTransfer.js`, replace the body of the `try` block inside `exportSelection` that builds `items` and `options`. Delete this:

```js
        const descriptor = packDescriptor(type);
        const chosen = new Set(selectedIds);
        const items = getAdapter(type)
          .list()
          .filter((item) => chosen.has(item.id));

        const options = {};
        if (type === "presets") {
          const wanted = referencedProfileIds(items);
          options.loudnessProfiles = getAdapter("loudness")
            .list()
            .filter((profile) => wanted.has(profile.id));
        }
```

and put this in its place:

```js
        const descriptor = packDescriptor(type);
        const { items, options } = collectPackItems(type, [...selectedIds]);
```

Then fix the imports at the top of the file. Add:

```js
import { collectPackItems } from "./collectPackItems.js";
```

and remove `referencedProfileIds` from the `packShape.js` import (it is now unused here). `getAdapter` is still used by `confirmImport` and `beginImport`, so leave that import alone.

- [ ] **Step 6: Run the existing transfer tests**

```bash
npx vitest run src/transfer/
```

Expected: PASS. The hook's behaviour is unchanged — the GUI never produces an unknown id, so `missingIds` is always empty there and is correctly ignored.

- [ ] **Step 7: Commit**

```bash
git add src/transfer/collectPackItems.js src/transfer/collectPackItems.test.js src/transfer/usePackTransfer.js
git commit -m "refactor(transfer): extract the export selection rule"
```

---

## Task 2: `libraryTransfer.js` — the App Control layer

Pure module. Knows the three families' App Control identities and turns `collectPackItems` / `parsePack` / `planPackImport` into App Control result shapes. No React, no revision, no persistence — the bridge owns those.

**Files:**
- Create: `src/agentControl/libraryTransfer.js`
- Create: `src/agentControl/libraryTransfer.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/agentControl/libraryTransfer.test.js`:

```js
/** @vitest-environment jsdom */
import { describe, expect, it, beforeEach } from "vitest";
import { resetAll, presetsStore, settingsStore } from "../persistence/index.js";
import {
  LIBRARY_FAMILIES,
  buildLibraryList,
  planLibraryExport,
  planLibraryImport,
} from "./libraryTransfer.js";

const PROFILE_A = { id: "prof-a", name: "EBU R128", referenceLufs: -23, rules: [] };

describe("LIBRARY_FAMILIES", () => {
  it("maps each App Control family to its pack type", () => {
    expect(LIBRARY_FAMILIES.preset.packType).toBe("presets");
    expect(LIBRARY_FAMILIES.theme.packType).toBe("themes");
    expect(LIBRARY_FAMILIES.loudnessProfile.packType).toBe("loudness");
  });

  it("gives each family a distinct not-found code and state key", () => {
    expect(LIBRARY_FAMILIES.preset.notFoundCode).toBe("presetNotFound");
    expect(LIBRARY_FAMILIES.theme.notFoundCode).toBe("themeNotFound");
    expect(LIBRARY_FAMILIES.loudnessProfile.notFoundCode).toBe("loudnessProfileNotFound");
    expect(LIBRARY_FAMILIES.theme.stateKey).toBe("themes");
    expect(LIBRARY_FAMILIES.loudnessProfile.stateKey).toBe("profiles");
  });
});

describe("buildLibraryList", () => {
  beforeEach(() => resetAll());

  it("returns id and name summaries only", () => {
    settingsStore.patch({ loudnessProfiles: { profiles: [PROFILE_A] } });
    expect(buildLibraryList("loudnessProfile")).toEqual([{ id: "prof-a", name: "EBU R128" }]);
  });
});

describe("planLibraryExport", () => {
  beforeEach(() => resetAll());

  it("builds a pack for the whole library", () => {
    settingsStore.patch({ loudnessProfiles: { profiles: [PROFILE_A] } });
    const planned = planLibraryExport("loudnessProfile", null);
    expect(planned.missingIds).toEqual([]);
    expect(planned.pack.kind).toBe("loudness-pack");
    expect(planned.pack.items.map((item) => item.id)).toEqual(["prof-a"]);
  });

  it("reports missing ids and builds no pack", () => {
    settingsStore.patch({ loudnessProfiles: { profiles: [PROFILE_A] } });
    const planned = planLibraryExport("loudnessProfile", ["prof-a", "ghost"]);
    expect(planned.missingIds).toEqual(["ghost"]);
    expect(planned.pack).toBeNull();
  });
});

describe("planLibraryImport", () => {
  beforeEach(() => resetAll());

  function themePack(items) {
    return { app: "PLVS", kind: "theme-pack", version: 1, exportedAt: "", items };
  }

  it("plans an addition without writing", () => {
    const planned = planLibraryImport(
      "theme",
      themePack([makeTheme("t-1", "Studio")])
    );
    expect(planned.changed).toBe(true);
    expect(planned.plan.items).toEqual([
      { sourceId: "t-1", finalId: "t-1", name: "Studio", disposition: "added" },
    ]);
    expect(planned.commit).toBeTypeOf("function");
  });

  it("rejects a pack of the wrong kind with a readable message", () => {
    expect(() =>
      planLibraryImport("theme", { app: "PLVS", kind: "preset-pack", version: 1, items: [] })
    ).toThrow(/Presets file/);
  });

  it("reports an identical entry as a no-op", () => {
    const theme = makeTheme("t-1", "Studio");
    planLibraryImport("theme", themePack([theme])).commit();
    const planned = planLibraryImport("theme", themePack([theme]));
    expect(planned.changed).toBe(false);
    expect(planned.plan.items[0].disposition).toBe("skipped");
  });

  it("carries the bundled profile plan for presets", () => {
    presetsStore.patch({ list: [] });
    const pack = {
      app: "PLVS",
      kind: "preset-pack",
      version: 1,
      exportedAt: "",
      items: [
        {
          id: "p-1",
          name: "Mix",
          panelOrder: [],
          panelsById: {},
          loudnessProfileActive: "profile:prof-a",
        },
      ],
      loudnessProfiles: [PROFILE_A],
    };
    const planned = planLibraryImport("preset", pack);
    expect(planned.plan.loudnessProfiles.map((entry) => entry.sourceId)).toEqual(["prof-a"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/agentControl/libraryTransfer.test.js
```

Expected: FAIL — `Failed to resolve import "./libraryTransfer.js"`.

- [ ] **Step 3: Write the implementation**

Create `src/agentControl/libraryTransfer.js`:

```js
/// App Control's view of the three shareable libraries.
///
/// It owns only what App Control adds: the family names on the wire, which error code a missing id
/// gets, and the result shapes. Everything about pack files -- the envelope, the merge rules, the
/// renaming, the preset-to-profile bundling, the three libraries' container shapes -- stays in
/// `src/transfer/`, which the GUI calls too. Nothing here restates any of it.

import { collectPackItems } from "../transfer/collectPackItems.js";
import { getAdapter } from "../transfer/libraryAdapters.js";
import { buildPack, packDescriptor, parsePack } from "../transfer/packShape.js";
import { planPackImport } from "../transfer/mergeIntoLibrary.js";

/// Keyed by App Control family name; `packType` is `src/transfer/`'s internal name for the same
/// library. The two vocabularies differ (`preset` vs `presets`, `loudnessProfile` vs `loudness`)
/// and this is the only place that knows it.
export const LIBRARY_FAMILIES = {
  preset: { packType: "presets", stateKey: "presets", notFoundCode: "presetNotFound" },
  theme: { packType: "themes", stateKey: "themes", notFoundCode: "themeNotFound" },
  loudnessProfile: {
    packType: "loudness",
    stateKey: "profiles",
    notFoundCode: "loudnessProfileNotFound",
  },
};

export function libraryFamily(family) {
  const descriptor = LIBRARY_FAMILIES[family];
  if (!descriptor) throw new Error(`Unknown library family: ${family}`);
  return descriptor;
}

/// `{ id, name }` summaries, the same shape `preset.list` already returns.
export function buildLibraryList(family) {
  return getAdapter(libraryFamily(family).packType)
    .list()
    .map(({ id, name }) => ({ id, name }));
}

/**
 * @param {string} family
 * @param {string[] | null} ids null exports the whole library
 * @returns {{ pack: object | null, missingIds: string[] }} `pack` is null when any id is missing:
 *   the caller must fail rather than export the subset that matched.
 */
export function planLibraryExport(family, ids) {
  const { packType } = libraryFamily(family);
  const { items, options, missingIds } = collectPackItems(packType, ids);
  if (missingIds.length > 0) return { pack: null, missingIds };
  return { pack: buildPack(packType, items, options), missingIds: [] };
}

/**
 * Validates and plans an import without writing. Throws `PackValidationError` for a document that
 * is not a valid pack for this family; its message is written for a person who received a shared
 * file and is passed through verbatim.
 *
 * @returns {{ changed: boolean, plan: { items: object[], loudnessProfiles: object[] },
 *   commit: () => void }} `commit` performs the append; a dry run simply never calls it.
 */
export function planLibraryImport(family, raw) {
  const { packType } = libraryFamily(family);
  const pack = parsePack(raw, packType);
  const planned = planPackImport(packType, pack, {
    existingItems: getAdapter(packType).list(),
    existingProfiles: packType === "presets" ? getAdapter("loudness").list() : [],
  });

  const changed = planned.itemAdditions.length > 0 || planned.profileAdditions.length > 0;

  return {
    changed,
    plan: {
      items: planned.itemPlan,
      loudnessProfiles: planned.profilePlan,
    },
    /// Writes through the adapters and nothing else. They are what announce the write to the
    /// React state that owns each library (`notifyLocal`); reaching a store directly here would
    /// land the data and leave the list on screen unchanged.
    commit() {
      if (planned.profileAdditions.length > 0) {
        getAdapter("loudness").append(planned.profileAdditions);
      }
      getAdapter(packType).append(planned.itemAdditions);
    },
  };
}

/// Exposed so the contract guard can compare against `PACK_KINDS` without importing the bridge.
export function libraryPackKind(family) {
  return packDescriptor(libraryFamily(family).packType).kind;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/agentControl/libraryTransfer.test.js
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/agentControl/libraryTransfer.js src/agentControl/libraryTransfer.test.js
git commit -m "feat(agent-control): add the library transfer layer"
```

---

## Task 3: The contract guard

`PACK_KINDS` is the list of libraries that have a pack format. A fourth entry added there without a command family would leave the CLI one library short with every test green. This fails in both directions.

**Files:**
- Create: `src/agentControl/libraryTransferContract.test.js`

- [ ] **Step 1: Write the test**

Create `src/agentControl/libraryTransferContract.test.js`:

```js
import { describe, expect, it } from "vitest";
import { PACK_KINDS } from "../transfer/packShape.js";
import { LIBRARY_FAMILIES, libraryPackKind } from "./libraryTransfer.js";

/// Guards the one thing nothing else would catch: a library that can be shared as a pack but has
/// no App Control commands, or an App Control family naming a library that has no pack format.
/// Both directions are silent failures -- the app works, the CLI is quietly incomplete.
describe("library transfer contract", () => {
  it("gives every pack kind an App Control family", () => {
    const covered = new Set(Object.keys(LIBRARY_FAMILIES).map((family) => libraryPackKind(family)));
    for (const descriptor of Object.values(PACK_KINDS)) {
      expect(covered.has(descriptor.kind)).toBe(true);
    }
  });

  it("gives every App Control family a pack kind", () => {
    const kinds = new Set(Object.values(PACK_KINDS).map((descriptor) => descriptor.kind));
    for (const family of Object.keys(LIBRARY_FAMILIES)) {
      expect(kinds.has(libraryPackKind(family))).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run it**

```bash
npx vitest run src/agentControl/libraryTransferContract.test.js
```

Expected: PASS, 2 tests. (This guard passes from the start — its job is to fail later.)

- [ ] **Step 3: Prove it actually guards**

Temporarily add a fourth entry to `PACK_KINDS` in `src/transfer/packShape.js`:

```js
  scratch: {
    type: "scratch",
    kind: "scratch-pack",
    extension: "plvsscratch",
    label: "Scratch",
    filterName: "PLVS Scratch",
    defaultBaseName: "plvs-scratch",
    normalizeItem: (raw) => raw,
  },
```

Run the guard again. Expected: FAIL on "gives every pack kind an App Control family". **Then revert that edit** — do not commit it.

- [ ] **Step 4: Commit**

```bash
git add src/agentControl/libraryTransferContract.test.js
git commit -m "test(agent-control): guard the library transfer contract"
```

---

## Task 4: Protocol validation

`protocol.js` shapes every incoming request before the bridge sees it. Reads take no params; export takes `ids` (array of strings) or nothing; import takes a `pack` document plus the standard mutation options.

**Files:**
- Modify: `src/agentControl/protocol.js`
- Modify: `src/agentControl/protocol.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `src/agentControl/protocol.test.js`:

```js
describe("library transfer requests", () => {
  it("accepts the three list methods with no params", () => {
    for (const method of ["theme.list", "loudnessProfile.list"]) {
      const normalized = normalizeAgentControlRequest({ jsonrpc: "2.0", id: 1, method });
      expect(normalized.request.method).toBe(method);
      expect(normalized.request.params).toEqual({});
    }
  });

  it("accepts an export with no ids as a whole-library export", () => {
    const normalized = normalizeAgentControlRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "theme.export",
      params: {},
    });
    expect(normalized.request.params.ids).toBeNull();
  });

  it("accepts an export with a string id list", () => {
    const normalized = normalizeAgentControlRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "theme.export",
      params: { ids: ["t-1", "t-2"] },
    });
    expect(normalized.request.params.ids).toEqual(["t-1", "t-2"]);
  });

  it("rejects an export whose ids are not strings", () => {
    const normalized = normalizeAgentControlRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "theme.export",
      params: { ids: [1] },
    });
    expect(normalized.error).toBeTruthy();
  });

  it("accepts an import carrying a pack object", () => {
    const normalized = normalizeAgentControlRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "theme.import",
      params: { pack: { app: "PLVS" }, expectedRevision: 3, dryRun: true },
    });
    expect(normalized.request.params.pack).toEqual({ app: "PLVS" });
    expect(normalized.request.params.expectedRevision).toBe(3);
    expect(normalized.request.params.dryRun).toBe(true);
  });

  it("rejects an import with no pack", () => {
    const normalized = normalizeAgentControlRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "theme.import",
      params: { expectedRevision: 3 },
    });
    expect(normalized.error).toBeTruthy();
  });
});
```

If `protocol.test.js` does not already import `describe`/`it`/`expect` and `normalizeAgentControlRequest`, match whatever the file's existing tests use rather than adding a second import.

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run src/agentControl/protocol.test.js
```

Expected: FAIL — the new methods fall through to the unknown-method branch.

- [ ] **Step 3: Implement**

In `src/agentControl/protocol.js`, add the three read methods to the existing no-params branch (the one listing `app.capabilities`, `app.inspect`, `axis.describe` …):

```js
    input.method === "theme.list" ||
    input.method === "loudnessProfile.list" ||
```

`preset.list` is already there. Then, before the final unknown-method rejection, add:

```js
  const LIBRARY_EXPORT = new Set(["preset.export", "theme.export", "loudnessProfile.export"]);
  const LIBRARY_IMPORT = new Set(["preset.import", "theme.import", "loudnessProfile.import"]);

  if (LIBRARY_EXPORT.has(input.method)) {
    const raw = input.params?.ids;
    // Absent means the whole library. An explicit empty array is a caller asking for nothing, and
    // is rejected rather than quietly exporting everything.
    if (raw !== undefined && (!Array.isArray(raw) || raw.length === 0)) {
      return invalidParams(input.id, "$.params.ids", "ids must be a non-empty array of strings.");
    }
    if (Array.isArray(raw) && raw.some((id) => typeof id !== "string" || id.length === 0)) {
      return invalidParams(input.id, "$.params.ids", "ids must be a non-empty array of strings.");
    }
    return {
      request: {
        id: input.id,
        method: input.method,
        params: { ids: Array.isArray(raw) ? [...raw] : null },
      },
    };
  }

  if (LIBRARY_IMPORT.has(input.method)) {
    const pack = input.params?.pack;
    if (pack === null || typeof pack !== "object" || Array.isArray(pack)) {
      return invalidParams(input.id, "$.params.pack", "pack must be a JSON object.");
    }
    return {
      request: {
        id: input.id,
        method: input.method,
        params: {
          pack,
          expectedRevision: input.params?.expectedRevision,
          dryRun: input.params?.dryRun === true,
        },
      },
    };
  }
```

Declare the two `Set`s at module scope beside the file's other constants rather than inside the function — the file's existing style puts fixed vocabularies at the top. Use whatever the file's existing invalid-params helper is called; if the file builds those errors inline rather than through a helper, match that shape instead of introducing `invalidParams`.

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/agentControl/protocol.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agentControl/protocol.js src/agentControl/protocol.test.js
git commit -m "feat(agent-control): accept library transfer requests"
```

---

## Task 5: Capabilities

**Files:**
- Modify: `src/agentControl/appSnapshot.js:9-54`
- Modify: `src/agentControl/appSnapshot.test.js`

- [ ] **Step 1: Write the failing test**

Append to `src/agentControl/appSnapshot.test.js` (inside whichever `describe` covers capabilities):

```js
  it("advertises the library transfer commands", () => {
    const capabilities = buildAgentControlCapabilities(
      { available: true, appName: "PLVS", appVersion: "0.15.0", identifier: "x", platform: "windows" },
      7
    );
    for (const method of [
      "preset.export",
      "preset.import",
      "theme.list",
      "theme.export",
      "theme.import",
      "loudnessProfile.list",
      "loudnessProfile.export",
      "loudnessProfile.import",
    ]) {
      expect(capabilities.commands).toContain(method);
    }
  });
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run src/agentControl/appSnapshot.test.js
```

Expected: FAIL on the first missing method.

- [ ] **Step 3: Implement**

In `src/agentControl/appSnapshot.js`, extend `METHODS`. Put the two preset entries after `"preset.apply"` and the two new families after them, so the list stays grouped by family:

```js
  "preset.export",
  "preset.import",
  "theme.list",
  "theme.export",
  "theme.import",
  "loudnessProfile.list",
  "loudnessProfile.export",
  "loudnessProfile.import",
```

- [ ] **Step 4: Run the whole agentControl suite**

```bash
npx vitest run src/agentControl/
```

Expected: PASS. If `publicSurfaceDocs.test.js` fails, run `npm run docs:agent-control` and commit the regenerated pages with this change.

- [ ] **Step 5: Commit**

```bash
git add src/agentControl/appSnapshot.js src/agentControl/appSnapshot.test.js
git commit -m "feat(agent-control): advertise the library transfer commands"
```

---

## Task 6: Revision tracking for the two new libraries

The Preset library already bumps the revision through a watched signature (`useAgentControlBridge.js:358`). The Theme and Loudness Profile libraries are not watched at all. Add the same treatment, so a GUI import counts exactly as an agent import does.

**Files:**
- Modify: `src/agentControl/useAgentControlBridge.js`
- Modify: `src/App.jsx:1246`
- Modify: `src/agentControl/useAgentControlBridge.test.jsx`

- [ ] **Step 1: Write the failing test**

Append to `src/agentControl/useAgentControlBridge.test.jsx`, following the file's existing harness for rendering the hook and issuing requests:

```js
  it("bumps the revision when the theme library changes outside a command", async () => {
    const harness = renderBridge({ customThemes: { "t-1": { id: "t-1", name: "Studio" } } });
    const before = (await harness.call("app.capabilities")).revision;

    harness.rerender({ customThemes: { "t-1": { id: "t-1", name: "Studio" }, "t-2": { id: "t-2", name: "Night" } } });

    const after = (await harness.call("app.capabilities")).revision;
    expect(after).toBe(before + 1);
  });

  it("bumps the revision when the loudness profile library changes outside a command", async () => {
    const harness = renderBridge({ loudnessProfiles: [{ id: "p-1", name: "EBU R128", rules: [] }] });
    const before = (await harness.call("app.capabilities")).revision;

    harness.rerender({
      loudnessProfiles: [
        { id: "p-1", name: "EBU R128", rules: [] },
        { id: "p-2", name: "ATSC A/85", rules: [] },
      ],
    });

    const after = (await harness.call("app.capabilities")).revision;
    expect(after).toBe(before + 1);
  });
```

Adapt `renderBridge` / `harness.call` / `harness.rerender` to whatever the existing tests in that file actually use — do not invent a harness. Read the file's first test before writing these.

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run src/agentControl/useAgentControlBridge.test.jsx
```

Expected: FAIL — the revision does not move.

- [ ] **Step 3: Implement the signatures**

In `src/agentControl/useAgentControlBridge.js`, beside `presetStateSignature` (line ~110), add:

```js
/// Identity and name only: those are what `theme.list` and `loudnessProfile.list` report, so those
/// are what a revision must track. A theme's tokens changing is an edit inside an entry, which the
/// future Theme Control will account for; it is invisible to this family.
function librarySignature(entries) {
  return JSON.stringify(
    (Array.isArray(entries) ? entries : Object.values(entries ?? {})).map(({ id, name }) => [
      id,
      name,
    ])
  );
}
```

Add the prop, beside `loudnessProfiles = []` in the destructured parameter list:

```js
  customThemes = {},
```

Add the refs, beside `previousPresetsSignatureRef`:

```js
  const previousThemeLibrarySignatureRef = useRef(librarySignature(customThemes));
  const previousLoudnessLibrarySignatureRef = useRef(librarySignature(loudnessProfiles));
```

And add the effects, immediately after the preset effect that ends at line ~370:

```js
  useEffect(() => {
    const signature = librarySignature(customThemes);
    if (signature === previousThemeLibrarySignatureRef.current) return;
    previousThemeLibrarySignatureRef.current = signature;
    bumpControlRevision();
    scheduleWaitWake();
  }, [bumpControlRevision, customThemes, scheduleWaitWake]);

  useEffect(() => {
    const signature = librarySignature(loudnessProfiles);
    if (signature === previousLoudnessLibrarySignatureRef.current) return;
    previousLoudnessLibrarySignatureRef.current = signature;
    bumpControlRevision();
    scheduleWaitWake();
  }, [bumpControlRevision, loudnessProfiles, scheduleWaitWake]);
```

- [ ] **Step 4: Pass the prop from App.jsx**

In `src/App.jsx`, in the `useAgentControlBridge({ ... })` call at line 1246, add beside `loudnessProfiles`:

```js
    customThemes: settings.customThemes,
```

`settings.customThemes` is the map `useThemeSettings` keeps in sync with `themesStore` (it subscribes at `useThemeSettings.js:92`), so an import through any path reaches this prop.

- [ ] **Step 5: Run to verify it passes**

```bash
npx vitest run src/agentControl/useAgentControlBridge.test.jsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/agentControl/useAgentControlBridge.js src/agentControl/useAgentControlBridge.test.jsx src/App.jsx
git commit -m "feat(agent-control): track the theme and loudness libraries in the revision"
```

---

## Task 7: The bridge handlers

Nine methods. Reads return immediately; export builds a pack; import validates, plans, and commits through the adapters, then flushes persistence.

**Files:**
- Modify: `src/agentControl/useAgentControlBridge.js`
- Modify: `src/agentControl/useAgentControlBridge.test.jsx`

- [ ] **Step 1: Write the failing tests**

Append to `src/agentControl/useAgentControlBridge.test.jsx`, again adapting to the file's existing harness:

```js
  it("lists a library", async () => {
    const harness = renderBridge({ loudnessProfiles: [{ id: "p-1", name: "EBU R128", rules: [] }] });
    const result = await harness.call("loudnessProfile.list");
    expect(result.profiles).toEqual([{ id: "p-1", name: "EBU R128" }]);
  });

  it("exports the whole library", async () => {
    seedThemeLibrary([makeTheme("t-1", "Studio")]);
    const harness = renderBridge({});
    const result = await harness.call("theme.export", { ids: null });
    expect(result.pack.kind).toBe("theme-pack");
    expect(result.pack.items.map((item) => item.id)).toEqual(["t-1"]);
  });

  it("fails an export naming an id that is not in the library", async () => {
    seedThemeLibrary([makeTheme("t-1", "Studio")]);
    const harness = renderBridge({});
    const failure = await harness.callExpectingError("theme.export", { ids: ["ghost", "gone"] });
    expect(failure.reason).toBe("themeNotFound");
    expect(failure.details.missingIds).toEqual(["ghost", "gone"]);
  });

  it("imports a pack and reports the plan", async () => {
    const harness = renderBridge({});
    const revision = (await harness.call("app.capabilities")).revision;
    const result = await harness.call("theme.import", {
      pack: {
        app: "PLVS",
        kind: "theme-pack",
        version: 1,
        exportedAt: "",
        items: [makeTheme("t-1", "Studio")],
      },
      expectedRevision: revision,
      dryRun: false,
    });
    expect(result.changed).toBe(true);
    expect(result.plan.items[0].disposition).toBe("added");
    expect(result.state.themes).toEqual([{ id: "t-1", name: "Studio" }]);
  });

  it("writes nothing on a dry run", async () => {
    const harness = renderBridge({});
    const revision = (await harness.call("app.capabilities")).revision;
    const result = await harness.call("theme.import", {
      pack: {
        app: "PLVS",
        kind: "theme-pack",
        version: 1,
        exportedAt: "",
        items: [makeTheme("t-1", "Studio")],
      },
      expectedRevision: revision,
      dryRun: true,
    });
    expect(result.dryRun).toBe(true);
    expect(result.plan.items[0].disposition).toBe("added");
    expect(result.revision).toBe(revision);
    expect(readThemeLibrary()).toEqual([]);
  });

  it("treats an import of what is already there as a no-op", async () => {
    const theme = makeTheme("t-1", "Studio");
    seedThemeLibrary([theme]);
    const harness = renderBridge({});
    const revision = (await harness.call("app.capabilities")).revision;
    const result = await harness.call("theme.import", {
      pack: { app: "PLVS", kind: "theme-pack", version: 1, exportedAt: "", items: [theme] },
      expectedRevision: revision,
      dryRun: false,
    });
    expect(result.changed).toBe(false);
    expect(result.revision).toBe(revision);
  });

  it("does not dirty the active preset", async () => {
    const harness = renderBridge({ presets: { list: [], activeId: "preset-1", dirty: false } });
    const revision = (await harness.call("app.capabilities")).revision;
    await harness.call("theme.import", {
      pack: {
        app: "PLVS",
        kind: "theme-pack",
        version: 1,
        exportedAt: "",
        items: [makeTheme("t-1", "Studio")],
      },
      expectedRevision: revision,
      dryRun: false,
    });
    const inspection = await harness.call("app.inspect");
    expect(inspection.preset).toEqual({ activeId: "preset-1", dirty: false });
  });

  it("imports while a blocking editor is open", async () => {
    // Not a scene operation: an append-only merge that moves no selection cannot destroy a draft,
    // and the GUI's Import buttons are not disabled by editor state either.
    const harness = renderBridge({ activeEditors: ["theme"] });
    const revision = (await harness.call("app.capabilities")).revision;
    const result = await harness.call("theme.import", {
      pack: {
        app: "PLVS",
        kind: "theme-pack",
        version: 1,
        exportedAt: "",
        items: [makeTheme("t-1", "Studio")],
      },
      expectedRevision: revision,
      dryRun: false,
    });
    expect(result.changed).toBe(true);
  });

  it("rejects a pack of the wrong kind", async () => {
    const harness = renderBridge({});
    const revision = (await harness.call("app.capabilities")).revision;
    const failure = await harness.callExpectingError("theme.import", {
      pack: { app: "PLVS", kind: "preset-pack", version: 1, items: [] },
      expectedRevision: revision,
      dryRun: false,
    });
    expect(failure.reason).toBe("invalidPack");
    expect(failure.message).toMatch(/Presets file/);
  });
```

Two things to adapt rather than copy. `renderBridge` / `harness.call` / `harness.callExpectingError` / `harness.rerender` stand in for whatever the file's existing tests use — read its first test and use those. `activeEditors: ["theme"]` stands for however that file already simulates an open blocking editor; in `App.jsx` the value reaches the bridge through `dockContext.activeEditors` and `presets.assertSceneOperationAllowed`, so follow whichever the existing refusal tests exercise.

Write `seedThemeLibrary` / `readThemeLibrary` as small local helpers over `getAdapter("themes")` from `src/transfer/libraryAdapters.js`; the file needs `/** @vitest-environment jsdom */` already present at its top (check — it renders React, so it will be).

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run src/agentControl/useAgentControlBridge.test.jsx
```

Expected: FAIL — unknown method.

- [ ] **Step 3: Implement the handlers**

Add to the imports in `src/agentControl/useAgentControlBridge.js`:

```js
import {
  buildLibraryList,
  libraryFamily,
  planLibraryExport,
  planLibraryImport,
} from "./libraryTransfer.js";
import { PackValidationError } from "../transfer/packShape.js";
```

Insert this block in the request dispatch, immediately after the `preset.rename / preset.delete / preset.reorder` branch ends (line ~1392):

```js
        const libraryMatch = /^(preset|theme|loudnessProfile)\.(list|export|import)$/.exec(
          request.method
        );
        if (libraryMatch && !(libraryMatch[1] === "preset" && libraryMatch[2] === "list")) {
          const [, family, action] = libraryMatch;
          const { stateKey, notFoundCode } = libraryFamily(family);

          if (action === "list") {
            return {
              requestId,
              result: {
                revision: controlRevisionRef.current,
                [stateKey]: buildLibraryList(family),
                ...(family === "loudnessProfile"
                  ? { activeId: activeLoudnessProfileId(loudnessProfiles, settings) }
                  : {}),
              },
            };
          }

          if (action === "export") {
            const planned = planLibraryExport(family, request.params.ids);
            if (planned.missingIds.length > 0) {
              throw semanticFailure(
                notFoundCode,
                "$.params.ids",
                `These ids are not in the library: ${planned.missingIds.join(", ")}.`,
                -32020,
                { missingIds: planned.missingIds }
              );
            }
            return {
              requestId,
              result: { revision: controlRevisionRef.current, pack: planned.pack },
            };
          }

          const currentRevision = controlRevisionRef.current;
          if (
            request.params.expectedRevision !== undefined &&
            request.params.expectedRevision !== currentRevision
          ) {
            throw semanticFailure(
              "revisionConflict",
              "$.params.expectedRevision",
              `App state changed after revision ${request.params.expectedRevision}.`,
              -32004,
              { expectedRevision: request.params.expectedRevision, currentRevision }
            );
          }

          let planned;
          try {
            planned = planLibraryImport(family, request.params.pack);
          } catch (error) {
            if (!(error instanceof PackValidationError)) throw error;
            // The message is the one a recipient of a shared file needs -- which library the file
            // belongs to, or that it is a whole configuration -- so it is passed through verbatim.
            throw semanticFailure("invalidPack", "$.params.pack", error.message, -32602);
          }

          const result = {
            dryRun: request.params.dryRun === true,
            revision: currentRevision,
            changed: planned.changed,
            warnings: [],
            plan: planned.plan,
            state: { [stateKey]: buildLibraryList(family) },
          };
          if (result.dryRun || !planned.changed) {
            return { requestId, result };
          }

          planned.commit();
          result.state = { [stateKey]: buildLibraryList(family) };
          bumpControlRevision();
          result.revision = controlRevisionRef.current;
          try {
            await flush();
          } catch (error) {
            throw semanticFailure(
              "persistenceFailed",
              "$",
              `Library committed but persistence failed: ${error?.message || String(error)}`,
              -32030,
              { stateCommitted: true, revision: result.revision }
            );
          }
          return { requestId, result };
        }
```

`bumpControlRevision` is called directly here rather than waiting on a state settlement, because the adapters write the store synchronously and the same-turn guard inside `bumpControlRevision` collapses this with the effect from Task 6 that fires on the resulting re-render — so one import produces exactly one increment either way.

Add the small helper beside `presetStateSignature`:

```js
/// The live Loudness Profile selection, as `loudnessProfile.list` reports it. Off is null.
function activeLoudnessProfileId(profiles, settings) {
  const active = settings?.loudnessProfiles?.active;
  if (typeof active !== "string" || !active.startsWith("profile:")) return null;
  const id = active.slice("profile:".length);
  return profiles.some((profile) => profile.id === id) ? id : null;
}
```

Check `src/lib/loudnessProfileCatalog.js` first: it exports `parseSelection` and `LOUDNESS_PROFILE_OFF`, and if `parseSelection` gives you the id directly, use it instead of the string slicing above. Do not restate a selection format that module already owns.

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/agentControl/
```

Expected: PASS.

- [ ] **Step 5: Add the one test that proves the adapters are used**

The stale-list hazard is already closed by `notifyLocal` and covered at the adapter and context level (`eef93f67`). What is not covered is that this family goes through the adapters rather than reaching a store directly. Append to `src/agentControl/useAgentControlBridge.test.jsx`:

```js
  it("shows an imported theme in the library the editor renders", async () => {
    const harness = renderBridge({});
    const themes = renderHook(() => useThemeSettings());
    const revision = (await harness.call("app.capabilities")).revision;

    await harness.call("theme.import", {
      pack: {
        app: "PLVS",
        kind: "theme-pack",
        version: 1,
        exportedAt: "",
        items: [makeTheme("t-1", "Studio")],
      },
      expectedRevision: revision,
      dryRun: false,
    });

    expect(Object.keys(themes.result.current.customThemes)).toContain("t-1");
  });
```

Adapt to `useThemeSettings`'s actual signature and return shape — read `src/hooks/useThemeSettings.js` first. If it requires context or arguments the test cannot easily supply, render the smallest component that owns the list instead; the assertion that matters is on rendered state, never on store contents, which would pass either way.

- [ ] **Step 6: Run and commit**

```bash
npx vitest run src/agentControl/
git add src/agentControl/useAgentControlBridge.js src/agentControl/useAgentControlBridge.test.jsx
git commit -m "feat(agent-control): handle library list, export and import"
```

---

## Task 8: The CLI

One parser for all three families. `--out` writes the pack in Rust.

**Files:**
- Modify: `src-tauri/src/cli_app.rs`

- [ ] **Step 1: Write the failing tests**

Append to the `mod tests` block at the bottom of `src-tauri/src/cli_app.rs`:

```rust
  #[test]
  fn parses_and_builds_library_commands() {
    assert_eq!(
      parse_app_args(&args(&["theme", "list", "--json"])),
      Ok(CliAppCommand::LibraryList {
        family: "theme".to_string()
      })
    );

    let export = parse_app_args(&args(&[
      "loudness-profile",
      "export",
      "--ids",
      "p-1,p-2",
      "--out",
      "pack.json",
      "--json",
    ]))
    .unwrap();
    assert_eq!(
      export,
      CliAppCommand::LibraryExport {
        family: "loudnessProfile".to_string(),
        ids: Some(vec!["p-1".to_string(), "p-2".to_string()]),
        out: Some("pack.json".to_string()),
      }
    );
    let request = build_request(&export, &mut Cursor::new(Vec::new())).unwrap();
    assert_eq!(request.method, "loudnessProfile.export");
    assert_eq!(request.params["ids"][0], "p-1");

    let all = parse_app_args(&args(&["theme", "export", "--all", "--json"])).unwrap();
    let request = build_request(&all, &mut Cursor::new(Vec::new())).unwrap();
    assert_eq!(request.params["ids"], Value::Null);
  }

  #[test]
  fn rejects_invalid_library_commands() {
    for bad in [
      args(&["theme", "list"]),
      args(&["theme", "export", "--json"]),
      args(&["theme", "export", "--all", "--ids", "t-1", "--json"]),
      args(&["theme", "import", "pack.json", "--json"]),
      args(&["theme", "import", "--expected-revision", "3", "--json"]),
      args(&["theme", "export", "--all", "--dry-run", "--json"]),
    ] {
      assert!(parse_app_args(&bad).is_err(), "expected an error for {bad:?}");
    }
  }

  #[test]
  fn builds_a_library_import_request_from_a_document() {
    let import = parse_app_args(&args(&[
      "theme",
      "import",
      "-",
      "--expected-revision",
      "3",
      "--json",
    ]))
    .unwrap();
    let mut stdin = Cursor::new(br#"{"app":"PLVS","kind":"theme-pack","version":1,"items":[]}"#.to_vec());
    let request = build_request(&import, &mut stdin).unwrap();
    assert_eq!(request.method, "theme.import");
    assert_eq!(request.params["pack"]["kind"], "theme-pack");
    assert_eq!(request.params["expectedRevision"], 3);
    assert_eq!(request.params["dryRun"], false);
  }
```

`build_request` is whatever the existing tests call to turn a `CliAppCommand` into a request — read `parses_and_builds_preset_read_commands` and use the same function and the same `Cursor` idiom rather than the names above if they differ.

- [ ] **Step 2: Run to verify failure**

```bash
cargo test --manifest-path src-tauri/Cargo.toml cli_app
```

Expected: FAIL to compile — `CliAppCommand::LibraryList` does not exist.

- [ ] **Step 3: Add the command variants**

In the `CliAppCommand` enum, after `PresetReorder`:

```rust
  LibraryList {
    family: String,
  },
  LibraryExport {
    family: String,
    /// None exports the whole library.
    ids: Option<Vec<String>>,
    out: Option<String>,
  },
  LibraryImport {
    family: String,
    input: String,
    expected_revision: Option<u64>,
    dry_run: bool,
  },
```

- [ ] **Step 4: Route the three family words**

In `parse_app_args`, beside the other family arms:

```rust
    [command, rest @ ..] if command == "theme" => return parse_library_args("theme", rest),
    [command, rest @ ..] if command == "loudness-profile" => {
      return parse_library_args("loudnessProfile", rest)
    }
```

`preset export` and `preset import` are handled inside `parse_preset_args`: add `"export" | "import"` to its `matches!` list of accepted commands, and before its positional-count check, delegate:

```rust
  if command == "export" || command == "import" {
    return parse_library_args("preset", args);
  }
```

Place that delegation immediately after the `command` is read and validated, before any of `parse_preset_args`'s own flag parsing runs.

- [ ] **Step 5: Write the parser**

Add beside `parse_preset_args`:

```rust
/// One parser for all three libraries. The CLI family word is the caller's business (`theme`,
/// `loudness-profile`, `preset`); `family` here is already the wire name.
fn parse_library_args(family: &str, args: &[String]) -> Result<CliAppCommand, String> {
  if args.iter().any(|arg| is_help(arg)) {
    return Ok(CliAppCommand::Help);
  }
  let usage = format!(
    "Usage: plvs-cli app {} <list|export|import> ... --json",
    if family == "loudnessProfile" {
      "loudness-profile"
    } else {
      family
    }
  );
  let command = args
    .first()
    .map(String::as_str)
    .ok_or_else(|| usage.clone())?;
  if !matches!(command, "list" | "export" | "import") {
    return Err(usage);
  }

  let mut json = false;
  let mut dry_run = false;
  let mut all = false;
  let mut ids: Option<Vec<String>> = None;
  let mut out = None;
  let mut expected_revision = None;
  let mut positionals = Vec::new();
  let mut index = 1;
  while index < args.len() {
    match args[index].as_str() {
      "--json" => {
        json = true;
        index += 1;
      }
      "--dry-run" => {
        dry_run = true;
        index += 1;
      }
      "--all" => {
        all = true;
        index += 1;
      }
      "--ids" => {
        let raw = args
          .get(index + 1)
          .ok_or_else(|| "Missing value for --ids.".to_string())?;
        let parsed: Vec<String> = raw
          .split(',')
          .map(str::trim)
          .filter(|value| !value.is_empty())
          .map(str::to_string)
          .collect();
        if parsed.is_empty() {
          return Err("The --ids value must list at least one id.".to_string());
        }
        ids = Some(parsed);
        index += 2;
      }
      "--out" => {
        out = Some(take_library_value(args, index, "--out")?);
        index += 2;
      }
      "--expected-revision" => {
        let raw = args
          .get(index + 1)
          .ok_or_else(|| "Missing value for --expected-revision.".to_string())?;
        let revision = raw.parse::<u64>().map_err(|_| {
          "The --expected-revision value must be a non-negative safe integer.".to_string()
        })?;
        if revision > MAX_SAFE_REVISION {
          return Err(
            "The --expected-revision value must be a non-negative safe integer.".to_string(),
          );
        }
        expected_revision = Some(revision);
        index += 2;
      }
      value if value.starts_with("--") => return Err(format!("Unknown option: {value}")),
      value => {
        positionals.push(value.to_string());
        index += 1;
      }
    }
  }

  if !json {
    return Err(format!("The app {family} {command} command requires --json."));
  }

  match command {
    "list" => {
      if !positionals.is_empty() || all || ids.is_some() || out.is_some() || dry_run {
        return Err(format!(
          "The app {family} list command takes no options other than --json."
        ));
      }
      if expected_revision.is_some() {
        return Err(format!(
          "The app {family} list command does not accept --expected-revision."
        ));
      }
      Ok(CliAppCommand::LibraryList {
        family: family.to_string(),
      })
    }
    "export" => {
      if !positionals.is_empty() {
        return Err(format!(
          "The app {family} export command takes no positional arguments."
        ));
      }
      // Export is a read: it cannot conflict, and there is nothing to preview.
      if expected_revision.is_some() || dry_run {
        return Err(format!(
          "The app {family} export command does not accept --expected-revision or --dry-run."
        ));
      }
      if all == ids.is_some() {
        return Err("Pass exactly one of --all or --ids.".to_string());
      }
      Ok(CliAppCommand::LibraryExport {
        family: family.to_string(),
        ids,
        out,
      })
    }
    _ => {
      if positionals.len() != 1 || positionals[0].trim().is_empty() {
        return Err(format!(
          "Usage: plvs-cli app {family} import <file|-> --json --expected-revision <n> [--dry-run]"
        ));
      }
      if all || ids.is_some() || out.is_some() {
        return Err(format!(
          "The app {family} import command does not accept --all, --ids or --out."
        ));
      }
      let expected_revision = Some(expected_revision.ok_or_else(|| {
        format!("The app {family} import command requires --expected-revision.")
      })?);
      Ok(CliAppCommand::LibraryImport {
        family: family.to_string(),
        input: positionals.remove(0),
        expected_revision,
        dry_run,
      })
    }
  }
}

fn take_library_value(args: &[String], index: usize, flag: &str) -> Result<String, String> {
  args
    .get(index + 1)
    .cloned()
    .ok_or_else(|| format!("Missing value for {flag}."))
}
```

If `cli_app.rs` already has a helper that takes a flag value, use it and delete `take_library_value`.

- [ ] **Step 6: Map methods and params**

In the `match` that produces the method name (line ~1204), add:

```rust
    CliAppCommand::LibraryList { family } => return format!("{family}.list"),
    CliAppCommand::LibraryExport { family, .. } => return format!("{family}.export"),
    CliAppCommand::LibraryImport { family, .. } => return format!("{family}.import"),
```

Adapt to the function's actual return type — the existing arms return `&'static str`, so the signature has to become `String` (change every arm to `.to_string()`) or the new arms have to be handled by the caller. Prefer changing the return type to `String`: it is a small mechanical change and it keeps one mapping.

In the params builder (the `match` around line 1340), add:

```rust
    CliAppCommand::LibraryList { .. } => serde_json::json!({}),
    CliAppCommand::LibraryExport { ids, .. } => match ids {
      Some(values) => serde_json::json!({ "ids": values }),
      None => serde_json::json!({ "ids": Value::Null }),
    },
    CliAppCommand::LibraryImport {
      input,
      expected_revision,
      dry_run,
      ..
    } => {
      let pack = read_json_document(input, stdin, "library pack")?;
      mutation_params([("pack", pack)], *expected_revision, *dry_run)
    }
```

Match `mutation_params`' actual signature — read how `PresetReorder` calls it just above.

- [ ] **Step 7: Classify the new error codes**

The `match` near line 1145 is the v1 exit-code classifier, not an allowlist. Its classes are documented in `docs/cli.md:235`: 1 runtime/system failure, 2 app unavailable, 3 invalid command input, 4 the current state refuses the operation, 5 wait did not complete. An unlisted code falls to 1.

Add the two not-found codes to the **exit-3** arm, beside `"presetNotFound"`:

```rust
        | "themeNotFound"
        | "loudnessProfileNotFound"
```

Do **not** add `invalidPack`. The handler throws it with RPC code `-32602`, and the classifier's first arm — `(Some(-32602), _) => 3` — already puts it in the same class. Listing it by name as well would suggest it needs a special case when it does not.

`revisionConflict` is already in the exit-4 arm and needs nothing.

- [ ] **Step 8: Write the pack file for `--out`**

In `run`, replace the body with:

```rust
pub fn run(command: CliAppCommand) -> ExitCode {
  if command == CliAppCommand::Help {
    println!("{}", help_text());
    return ExitCode::SUCCESS;
  }
  let (mut report, mut exit_code) = execute(&command, &mut io::stdin().lock(), &LocalControlClient);
  if let CliAppCommand::LibraryExport { out: Some(path), .. } = &command {
    if let Err(failure) = write_pack_file(&mut report, path) {
      eprintln!("{failure}");
      // 1, not 2: the app answered and the pack is in hand, so this is a local write failure --
      // `docs/cli.md`'s exit-code table names "output write failed" under 1. Reporting 2 would tell
      // a script the app is unreachable and send it into a retry that a full disk cannot satisfy.
      exit_code = 1;
    }
  }
  match serde_json::to_string(&report) {
    Ok(json) => println!("{json}"),
    Err(error) => {
      eprintln!("Unable to serialize app-control report: {error}");
      return ExitCode::from(2);
    }
  }
  ExitCode::from(exit_code)
}

/// Moves `result.pack` out of the envelope and onto disk, leaving `result.out` behind. `pack` and
/// `out` never appear together, so a script can tell which it got without inspecting sizes.
fn write_pack_file(report: &mut CliAppReport, path: &str) -> Result<(), String> {
  let Some(result) = report.result.as_mut().and_then(Value::as_object_mut) else {
    return Ok(());
  };
  let Some(pack) = result.remove("pack") else {
    return Ok(());
  };
  let contents = format!(
    "{}\n",
    serde_json::to_string_pretty(&pack).map_err(|error| format!("Unable to serialize pack: {error}"))?
  );
  fs::write(Path::new(path), contents)
    .map_err(|error| format!("Unable to write the pack to {path}: {error}"))?;
  result.insert("out".to_string(), Value::String(path.to_string()));
  Ok(())
}
```

`CliAppReport.result` is `Option<Value>` in the existing struct — if it is a typed struct instead, add the file writing where the result value is still a `Value`, before it is typed. Read the struct before writing this.

- [ ] **Step 9: Update the help text**

In `help_text()`, add these lines to the usage block, after the preset lines:

```text
  plvs-cli app preset export <--all|--ids <id,...>> --json [--out <file>]
  plvs-cli app preset import <file|-> --json --expected-revision <n> [--dry-run]
  plvs-cli app theme list --json
  plvs-cli app theme export <--all|--ids <id,...>> --json [--out <file>]
  plvs-cli app theme import <file|-> --json --expected-revision <n> [--dry-run]
  plvs-cli app loudness-profile list --json
  plvs-cli app loudness-profile export <--all|--ids <id,...>> --json [--out <file>]
  plvs-cli app loudness-profile import <file|-> --json --expected-revision <n> [--dry-run]
```

- [ ] **Step 10: Add a golden envelope fixture for the import result**

`shared/cli-v1-envelope-fixtures.json` pins the shape of each v1 response class, and `cli_contract.rs` asserts the envelope invariants over every entry. The nine required ids stay as they are — this adds a tenth entry, which the test permits (ids only have to be unique). It is worth adding because `plan` is a field no other command returns, so nothing else would notice if its shape changed.

Append to the array in `shared/cli-v1-envelope-fixtures.json`:

```json
  {
    "id": "mutation.libraryImportDryRun",
    "exitCode": 0,
    "envelope": {
      "schemaVersion": 1,
      "ok": true,
      "result": {
        "dryRun": true,
        "revision": 13,
        "changed": true,
        "warnings": [],
        "plan": {
          "items": [
            { "sourceId": "t-1", "finalId": "t-1", "name": "Studio", "disposition": "added" }
          ],
          "loudnessProfiles": []
        },
        "state": { "themes": [] }
      }
    }
  }
```

Match the file's existing entry formatting — read the last entry before appending, and keep the array's trailing punctuation valid.

- [ ] **Step 11: Run the Rust tests**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
```

Expected: all PASS.

- [ ] **Step 12: Commit**

```bash
git add src-tauri/src/cli_app.rs shared/cli-v1-envelope-fixtures.json
git commit -m "feat(cli): add the library transfer commands"
```

---

## Task 9: Documentation

**Files:**
- Create: `docs/agent-control/libraries.md`
- Modify: `docs/agent-control/README.md`, `docs/agent-control/presets.md`, `docs/agent-control/settings.md`, `docs/cli.md`

- [ ] **Step 1: Write `docs/agent-control/libraries.md`**

Cover, in this order: the command list; that `theme.list` reports custom themes only and built-ins live in `settings describe`; the export result and `--out`'s `result.out`; that an unknown id fails rather than exporting the subset; that import is merge-only and never moves a selection; the `plan` shape and its three dispositions; that a dry run is the same code path minus the append; that an all-`skipped` import is a successful no-op; the revision rule; that import never dirties the active Preset; and that editors do not block it.

Take the wording from the spec's corresponding sections. Do not restate the merge rules in prose — link to the behaviour, state the contract.

- [ ] **Step 2: Update `docs/agent-control/README.md`**

In the command families code block, add:

```text
preset export / preset import
theme.list / theme export / theme import
loudnessProfile.list / loudnessProfile export / loudnessProfile import
```

In "Implementation status", add Library Transfer to the implemented list. In the guard table, add a row:

| `src/agentControl/libraryTransferContract.test.js` | A library has a pack format but no command family, or the reverse. |

In "Follow-on module specifications", add `- [`libraries.md`](libraries.md) — approved Library Transfer contract`.

- [ ] **Step 3: Update `docs/agent-control/presets.md`**

Delete this sentence from the paragraph at line ~32:

```text
Individual Preset import/export remains outside this command family.
```

and add a pointer in its place:

```text
Individual Preset import and export belong to Library Transfer; see
[`libraries.md`](libraries.md).
```

Leave the following sentence about whole-configuration backup alone — Phase B has not happened.

- [ ] **Step 4: Update `docs/agent-control/settings.md`**

Replace the two exclusion bullets at lines ~39-40:

```text
- Theme library creation, editing, duplication, and deletion; these belong to future Theme Control.
- Loudness Profile library and selection; these belong to future Loudness Profile Control.
```

with:

```text
- Theme library creation, editing, duplication, and deletion; these belong to future Theme Control.
  Sharing a Theme between machines is Library Transfer's ([`libraries.md`](libraries.md)).
- Loudness Profile library editing and selection; these belong to future Loudness Profile Control.
  Sharing a Loudness Profile is Library Transfer's ([`libraries.md`](libraries.md)).
```

- [ ] **Step 5: Update `docs/cli.md`**

Add the nine commands to whatever `plvs-cli app` reference that file carries, matching its existing formatting.

- [ ] **Step 6: Commit**

```bash
git add docs/agent-control docs/cli.md
git commit -m "docs(agent-control): document library transfer control"
```

---

## Task 10: The merge gate

- [ ] **Step 1: Run the full check**

```bash
npm run check
```

Expected: PASS. It runs version check, format, lint, the whole Vitest suite, the Vite build, and Rust fmt/clippy/test.

- [ ] **Step 2: If `publicSurfaceDocs.test.js` fails**

```bash
npm run docs:agent-control
```

Then re-run `npm run check` and commit the regenerated pages.

- [ ] **Step 3: Manual verification in the real app**

`npm run check` does not exercise the pipe. In one terminal:

```bash
npm run desktop
```

In another, with Agent Control on (it is on by default in development builds):

```bash
npm run desktop:control --silent -- theme list --json
```

Then export, re-import into a fresh profile, and confirm the imported theme appears in the Settings theme picker **without restarting** — that is the `notifyLocal` path, and it is the one thing the suite cannot prove end to end.

- [ ] **Step 4: Commit anything the check regenerated**

```bash
git status
```

Expected: clean. If not, commit what `npm run check` produced.
