# Channel Label Override — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user assign a role to each input channel (per channel count) so any layout — including counts auto-detection can't name (e.g. 7ch) — gets meaningful channel labels instead of generic `Ch N`.

**Architecture:** A fixed role vocabulary + pure helpers map per-channel role tokens to display labels. App stores overrides keyed by channel count in the existing prefs blob, computes label arrays for the live count, and threads them at highest priority into the existing peak/vectorscope/spectrum label contexts. A new Settings "Channel labels" section edits the current count's tokens. Labels only — no loudness/IPC/Rust changes (that's Phase 2).

**Tech Stack:** React (JS, hooks), Vitest + Testing Library, Radix `Select`, Tailwind. No Rust in this phase.

**Spec:** `docs/superpowers/specs/2026-06-12-channel-label-override-design.md`

**Setup note:** The working tree currently has uncommitted prior work (channel-layout setting removal + quad/lcr/5.0 label fix). Before executing, put that work + this plan's commits on a feature branch (e.g. `feat/channel-label-override`) rather than `main`.

---

### Task 1: Role vocabulary + token→label helpers

**Files:**
- Create: `src/math/channelRoles.js`
- Test: `src/math/channelRoles.test.js`

- [ ] **Step 1: Write the failing test**

```js
// src/math/channelRoles.test.js
import { describe, expect, it } from "vitest";
import {
  CHANNEL_ROLE_VOCABULARY,
  roleTokensToLabels,
  seedTokensFromLabels,
  sanitizeChannelLabelOverrides,
} from "./channelRoles.js";

describe("CHANNEL_ROLE_VOCABULARY", () => {
  it("includes generic plus surround and Atmos roles, each with id + label", () => {
    const ids = CHANNEL_ROLE_VOCABULARY.map((r) => r.id);
    expect(ids).toContain("generic");
    expect(ids).toContain("L");
    expect(ids).toContain("LFE");
    expect(ids).toContain("Cs");
    expect(ids).toContain("Ltf");
    for (const r of CHANNEL_ROLE_VOCABULARY) {
      expect(typeof r.id).toBe("string");
      expect(r.id.length).toBeGreaterThan(0);
      expect(typeof r.label).toBe("string");
    }
  });
});

describe("roleTokensToLabels", () => {
  it("maps role tokens to labels; generic and unknown become Ch N", () => {
    expect(roleTokensToLabels(["L", "R", "C", "LFE", "Ls", "Rs", "Cs"])).toEqual([
      "L",
      "R",
      "C",
      "LFE",
      "Ls",
      "Rs",
      "Cs",
    ]);
    expect(roleTokensToLabels(["L", "generic", "zzz"])).toEqual(["L", "Ch 2", "Ch 3"]);
  });
});

describe("seedTokensFromLabels", () => {
  it("maps auto labels back to tokens; numbered labels become generic", () => {
    expect(seedTokensFromLabels(["L", "R", "C", "LFE", "Ls", "Rs"])).toEqual([
      "L",
      "R",
      "C",
      "LFE",
      "Ls",
      "Rs",
    ]);
    expect(seedTokensFromLabels(["Ch 1", "Ch 2", "Ch 3"])).toEqual([
      "generic",
      "generic",
      "generic",
    ]);
  });
});

describe("sanitizeChannelLabelOverrides", () => {
  it("keeps valid entries, drops wrong-length / unknown-token / malformed ones", () => {
    const raw = {
      2: ["L", "R"],
      6: ["L", "R", "C", "LFE", "Ls", "Rs"],
      4: ["L", "R", "Ls"], // wrong length
      3: ["L", "R", "nope"], // unknown token
      foo: ["L", "R"], // non-numeric key
      8: "not-an-array",
    };
    expect(sanitizeChannelLabelOverrides(raw)).toEqual({
      2: ["L", "R"],
      6: ["L", "R", "C", "LFE", "Ls", "Rs"],
    });
  });

  it("returns {} for non-object input", () => {
    expect(sanitizeChannelLabelOverrides(null)).toEqual({});
    expect(sanitizeChannelLabelOverrides([1, 2])).toEqual({});
    expect(sanitizeChannelLabelOverrides("x")).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/math/channelRoles.test.js`
Expected: FAIL — `Failed to resolve import "./channelRoles.js"`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/math/channelRoles.js
/**
 * Fixed per-channel role vocabulary and pure helpers for the user channel-label override.
 * Phase 1 is labels only; the Atmos height roles carry no loudness meaning yet (Phase 2).
 */

/** @typedef {{ id: string, label: string }} ChannelRole */

/** @type {readonly ChannelRole[]} */
export const CHANNEL_ROLE_VOCABULARY = Object.freeze([
  { id: "generic", label: "—" },
  { id: "M", label: "M" },
  { id: "L", label: "L" },
  { id: "R", label: "R" },
  { id: "C", label: "C" },
  { id: "LFE", label: "LFE" },
  { id: "Ls", label: "Ls" },
  { id: "Rs", label: "Rs" },
  { id: "Lb", label: "Lb" },
  { id: "Rb", label: "Rb" },
  { id: "Cs", label: "Cs" },
  { id: "Ltf", label: "Ltf" },
  { id: "Rtf", label: "Rtf" },
  { id: "Ltr", label: "Ltr" },
  { id: "Rtr", label: "Rtr" },
]);

const ROLE_LABEL_BY_ID = new Map(CHANNEL_ROLE_VOCABULARY.map((r) => [r.id, r.label]));
const NAMED_LABEL_TO_ID = new Map(
  CHANNEL_ROLE_VOCABULARY.filter((r) => r.id !== "generic").map((r) => [r.label, r.id])
);

/**
 * @param {string[]} tokens
 * @returns {string[]} Display label per channel; `generic` or any unknown token → `Ch n`.
 */
export function roleTokensToLabels(tokens) {
  return tokens.map((token, i) => {
    const label = ROLE_LABEL_BY_ID.get(token);
    return label && token !== "generic" ? label : `Ch ${i + 1}`;
  });
}

/**
 * Seed editor tokens from auto-detected labels. Role-shaped labels (`L`, `Ls`, …) map to their
 * id; numbered (`Ch n`) or unrecognised labels become `generic`.
 * @param {string[]} labels
 * @returns {string[]}
 */
export function seedTokensFromLabels(labels) {
  return labels.map((label) => NAMED_LABEL_TO_ID.get(label) ?? "generic");
}

const VALID_IDS = new Set(CHANNEL_ROLE_VOCABULARY.map((r) => r.id));

/**
 * Validate a persisted overrides blob: keep only entries whose key is a positive integer and whose
 * value is an array of that length containing only known role ids.
 * @param {unknown} raw
 * @returns {Record<number, string[]>}
 */
export function sanitizeChannelLabelOverrides(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  /** @type {Record<number, string[]>} */
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    const count = Number(key);
    if (!Number.isInteger(count) || count <= 0) continue;
    if (!Array.isArray(value) || value.length !== count) continue;
    if (!value.every((t) => VALID_IDS.has(t))) continue;
    out[count] = value.slice();
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/math/channelRoles.test.js`
Expected: PASS (4 describes, all green).

- [ ] **Step 5: Commit**

```bash
git add src/math/channelRoles.js src/math/channelRoles.test.js
git commit -m "feat(channel-labels): add role vocabulary and token helpers"
```

---

### Task 2: `getPeakMeterChannelLabels` override branch

**Files:**
- Modify: `src/math/peakMeterChannelLabels.js` (the `getPeakMeterChannelLabels` body + the context typedef)
- Test: `src/math/peakMeterChannelLabels.test.js`

- [ ] **Step 1: Write the failing test** (append inside the existing `describe("getPeakMeterChannelLabels", …)` block, before its closing `});`)

```js
  it("honours overrideLabels at highest priority when length matches", () => {
    expect(
      getPeakMeterChannelLabels(7, {
        channelLayout: "auto",
        resolvedLayout: "unknown",
        overrideLabels: ["L", "R", "C", "LFE", "Ls", "Rs", "Cs"],
      })
    ).toEqual(["L", "R", "C", "LFE", "Ls", "Rs", "Cs"]);
  });

  it("ignores overrideLabels when its length does not match the channel count", () => {
    expect(
      getPeakMeterChannelLabels(6, {
        resolvedLayout: "5.1",
        overrideLabels: ["L", "R"],
      })
    ).toEqual(["L", "R", "C", "LFE", "Ls", "Rs"]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/math/peakMeterChannelLabels.test.js`
Expected: FAIL — first new test gets `["Ch 1" … "Ch 7"]` (unknown guard) instead of the override labels.

- [ ] **Step 3: Write minimal implementation**

In `src/math/peakMeterChannelLabels.js`, add the override field to the context typedef (after the `formatId` line):

```js
 * @property {string[]} [overrideLabels] User per-channel labels; used verbatim when length === channelCount.
```

Then in `getPeakMeterChannelLabels`, insert the new branch immediately after the `if (n === 0) { return []; }` guard and before the `if (ctx.formatId)` block:

```js
  if (Array.isArray(ctx.overrideLabels) && ctx.overrideLabels.length === n) {
    return [...ctx.overrideLabels];
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/math/peakMeterChannelLabels.test.js`
Expected: PASS (all existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/math/peakMeterChannelLabels.js src/math/peakMeterChannelLabels.test.js
git commit -m "feat(channel-labels): apply overrideLabels at highest priority"
```

---

### Task 3: Settings "Channel labels" section

**Files:**
- Modify: `src/components/SettingsPanel.jsx` (imports, props, new section JSX)
- Test: `src/components/SettingsPanel.test.jsx`

- [ ] **Step 1: Write the failing test** (add to `src/components/SettingsPanel.test.jsx`)

First extend `BASE_PROPS` (after `setReferenceLufs: vi.fn(),`) with channel-label defaults:

```js
  channelCount: 0,
  channelLabelTokens: [],
  channelLabelHasOverride: false,
  setChannelLabelToken: vi.fn(),
  resetChannelLabels: vi.fn(),
```

Then add a new `describe` block (after the existing `describe("SettingsPanel", …)`):

```js
describe("SettingsPanel — Channel labels", () => {
  it("shows the idle hint when no input is connected", () => {
    render(<SettingsPanel {...BASE_PROPS} channelCount={0} />);
    expect(screen.getByText("Connect an input to label its channels.")).toBeTruthy();
  });

  it("renders one role select per channel when an input is active", () => {
    render(
      <SettingsPanel
        {...BASE_PROPS}
        channelCount={2}
        channelLabelTokens={["L", "R"]}
      />
    );
    expect(screen.getByLabelText("Channel 1 role")).toBeTruthy();
    expect(screen.getByLabelText("Channel 2 role")).toBeTruthy();
  });

  it("disables Reset to Auto when there is no override", () => {
    render(
      <SettingsPanel
        {...BASE_PROPS}
        channelCount={2}
        channelLabelTokens={["L", "R"]}
        channelLabelHasOverride={false}
      />
    );
    expect(screen.getByRole("button", { name: "Reset to Auto" }).disabled).toBe(true);
  });

  it("calls resetChannelLabels when Reset to Auto is clicked", () => {
    const resetChannelLabels = vi.fn();
    render(
      <SettingsPanel
        {...BASE_PROPS}
        channelCount={2}
        channelLabelTokens={["L", "R"]}
        channelLabelHasOverride={true}
        resetChannelLabels={resetChannelLabels}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Reset to Auto" }));
    expect(resetChannelLabels).toHaveBeenCalledTimes(1);
  });
});
```

Ensure `fireEvent` is imported in the test file (alongside `render`, `screen` from `@testing-library/react`). If it isn't already imported, add it.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/SettingsPanel.test.jsx`
Expected: FAIL — idle hint / role selects / Reset button not found.

- [ ] **Step 3: Write minimal implementation**

In `src/components/SettingsPanel.jsx`:

(a) Add the import after the existing `clearShortcutPrefs` import:

```js
import { CHANNEL_ROLE_VOCABULARY } from "@/math/channelRoles.js";
```

(b) Add the new props to the destructured `SettingsPanel({ … })` signature (with defaults):

```js
  channelCount = 0,
  channelLabelTokens = [],
  channelLabelHasOverride = false,
  setChannelLabelToken = () => {},
  resetChannelLabels = () => {},
```

(c) Insert the section JSX immediately after the Loudness reference row's closing `</div>` (the row containing `settings-ref-lufs`) and before the `{appVersion ? (` block:

```jsx
                <Separator />
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="shrink-0">
                      Channel labels{channelCount > 0 ? ` · ${channelCount}-channel` : ""}
                    </Label>
                    {channelCount > 0 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={resetChannelLabels}
                        disabled={!channelLabelHasOverride}
                        className="h-auto px-2 py-1 text-xs"
                      >
                        Reset to Auto
                      </Button>
                    ) : null}
                  </div>
                  {channelCount > 0 ? (
                    <div className="flex flex-col gap-1.5">
                      {channelLabelTokens.map((token, i) => (
                        <div key={i} className="flex items-center justify-between gap-2">
                          <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                            {i + 1}
                          </span>
                          <Select value={token} onValueChange={(v) => setChannelLabelToken(i, v)}>
                            <SelectTrigger
                              className="w-auto shrink-0"
                              aria-label={`Channel ${i + 1} role`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent position="popper">
                              {CHANNEL_ROLE_VOCABULARY.map((role) => (
                                <SelectItem key={role.id} value={role.id}>
                                  {role.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      Connect an input to label its channels.
                    </span>
                  )}
                </div>
```

(`Button`, `Select`/`SelectTrigger`/`SelectValue`/`SelectContent`/`SelectItem`, `Label`, `Separator` are already imported in this file.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/SettingsPanel.test.jsx`
Expected: PASS (existing + 4 new).

- [ ] **Step 5: Commit**

```bash
git add src/components/SettingsPanel.jsx src/components/SettingsPanel.test.jsx
git commit -m "feat(channel-labels): add Channel labels Settings section"
```

---

### Task 4: Wire overrides into App (state, persistence, contexts, props)

**Files:**
- Modify: `src/App.jsx`

No new unit test file — this is integration wiring verified by the full suite (the pure logic is covered by Tasks 1–3). Verify by running the whole suite + lint at the end.

- [ ] **Step 1: Add imports and state**

In `src/App.jsx`, add to the import that pulls from `./math/channelRoles.js` (create the import line near the other `./math/*` imports, e.g. after the `peakMeterChannelLabels.js` import on line 33):

```js
import {
  roleTokensToLabels,
  seedTokensFromLabels,
  sanitizeChannelLabelOverrides,
} from "./math/channelRoles.js";
```

Add state near the other `useState` declarations (e.g. after the `updateInfo` state, line ~225):

```js
  const [channelLabelOverrides, setChannelLabelOverrides] = useState({});
```

Confirm `useCallback` is imported from `react` at the top of the file; if not, add it to the existing `import { … } from "react";`.

- [ ] **Step 2: Compute override labels + editor tokens, thread into contexts**

Where `peakLabelContext` / `vectorscopeLabelContext` are defined (lines ~396–405), replace those two memos and add the override/seed computations just above them:

```js
  const channelLabelOverride =
    channelCount > 0 ? (channelLabelOverrides[channelCount] ?? null) : null;
  const overrideLabels = useMemo(
    () => (channelLabelOverride ? roleTokensToLabels(channelLabelOverride) : null),
    [channelLabelOverride]
  );
  const channelAutoLabels = useMemo(
    () =>
      channelCount > 0
        ? getPeakMeterChannelLabels(channelCount, {
            channelLayout: "auto",
            resolvedLayout: layoutResolution.resolved,
          })
        : [],
    [channelCount, layoutResolution.resolved]
  );
  const channelLabelTokens = useMemo(
    () => channelLabelOverride ?? seedTokensFromLabels(channelAutoLabels),
    [channelLabelOverride, channelAutoLabels]
  );

  const peakLabelContext = useMemo(
    () => ({ channelLayout: "auto", resolvedLayout: layoutResolution.resolved, overrideLabels }),
    [layoutResolution.resolved, overrideLabels]
  );

  const vectorscopeLabelContext = useMemo(
    () => ({ channelLayout: "auto", resolvedLayout: layoutResolution.resolved, overrideLabels }),
    [layoutResolution.resolved, overrideLabels]
  );
```

- [ ] **Step 3: Add edit + reset callbacks**

Immediately after the memos from Step 2, add:

```js
  const setChannelLabelToken = useCallback(
    (index, token) => {
      if (channelCount <= 0) return;
      setChannelLabelOverrides((prev) => {
        const base = prev[channelCount] ?? seedTokensFromLabels(channelAutoLabels);
        const next = base.slice();
        next[index] = token;
        return { ...prev, [channelCount]: next };
      });
    },
    [channelCount, channelAutoLabels]
  );
  const resetChannelLabels = useCallback(() => {
    setChannelLabelOverrides((prev) => {
      if (!(channelCount in prev)) return prev;
      const next = { ...prev };
      delete next[channelCount];
      return next;
    });
  }, [channelCount]);
```

- [ ] **Step 4: Persistence — load**

In the load `useEffect` (the one reading `STORE_KEY`, ~line 764), add inside the `try` (after the existing `if (typeof s.spectrogramTopRatio …)` line):

```js
      setChannelLabelOverrides(sanitizeChannelLabelOverrides(s.channelLabelOverrides));
```

- [ ] **Step 5: Persistence — save**

In the save `useEffect` (~line 785), add `channelLabelOverrides,` to the persisted object (after `themeId: persistedThemeId,`):

```js
          channelLabelOverrides,
```

and add `channelLabelOverrides` to that effect's dependency array (after `fixedThemeSelectValue,`).

- [ ] **Step 6: Pass props to SettingsPanel**

In the `<SettingsPanel … />` JSX (~line 1103), add (e.g. after `setReferenceLufs={setReferenceLufs}`):

```jsx
          channelCount={channelCount}
          channelLabelTokens={channelLabelTokens}
          channelLabelHasOverride={!!channelLabelOverride}
          setChannelLabelToken={setChannelLabelToken}
          resetChannelLabels={resetChannelLabels}
```

- [ ] **Step 7: Run the full suite + lint**

Run: `npm test`
Expected: PASS — all test files green (no regressions; new behavior covered by Tasks 1–3).

Run: `npm run lint`
Expected: 0 errors (pre-existing tray `react-hooks/refs` warnings are unrelated and acceptable).

- [ ] **Step 8: Commit**

```bash
git add src/App.jsx
git commit -m "feat(channel-labels): wire per-count overrides into live label contexts"
```

---

### Task 5: Manual verification + spectrum-options regression check

**Files:** none (verification only).

- [ ] **Step 1: Confirm spectrum/vectorscope options inherit overrides**

`spectrumChannelOptions` (App.jsx ~line 411) and `vectorscopeChannelLabels` (~line 425) both call `getPeakMeterChannelLabels(n, peakLabelContext)` / a context carrying `overrideLabels`. Re-read those call sites and confirm they pass the same context object that now includes `overrideLabels` (no extra change needed — they read `peakLabelContext`). If either builds its own context literal without `overrideLabels`, add `overrideLabels` to it.

- [ ] **Step 2: Build check**

Run: `npm run build`
Expected: Vite build succeeds (no unresolved imports / syntax errors).

- [ ] **Step 3: (If a 4–8 channel source is available) smoke test in the app**

Run: `npm run desktop` (or `npm run tauri dev`). With an N-channel input active, open Settings → Channel labels, change a few roles, confirm the peak meter headers, spectrum channel options, and vectorscope pair labels update live; click Reset to Auto and confirm they revert. Note in the PR if no multichannel source was available to test manually.

- [ ] **Step 4: Commit (docs/CHANGELOG if the project tracks one)**

If `CHANGELOG.md` has an Unreleased section, add a bullet:

```
- Channel labels: assign a role to each input channel (Settings → Channel labels), per channel count.
```

```bash
git add CHANGELOG.md
git commit -m "docs(channel-labels): note per-channel label override in changelog"
```

---

## Self-Review

**Spec coverage:**
- Role vocabulary (surround + Cs + Atmos height + generic) → Task 1.
- Per-count override data model + token storage → Task 1 (`sanitizeChannelLabelOverrides`) + Task 4 (state/persistence).
- Highest-priority label resolution → Task 2.
- Settings "Channel labels" section, N rows, seed values, Reset to Auto, idle hint → Task 3 (UI) + Task 4 (seed/token computation feeding props).
- Scope of effect (peak meter, vectorscope, spectrum) → Task 4 contexts + Task 5 Step 1 regression check.
- Persistence in STORE_KEY blob, defensive load → Task 1 (`sanitize`) + Task 4 Steps 4–5.
- Resolver unchanged → no task touches `channelLayoutResolver.js`. ✓
- Loudness untouched → no Rust task. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type/name consistency:** `CHANNEL_ROLE_VOCABULARY`, `roleTokensToLabels`, `seedTokensFromLabels`, `sanitizeChannelLabelOverrides` used identically across Tasks 1, 3, 4. Prop names (`channelCount`, `channelLabelTokens`, `channelLabelHasOverride`, `setChannelLabelToken`, `resetChannelLabels`) match between Task 3 (consumer + test) and Task 4 (provider). `overrideLabels` context field matches between Task 2 and Task 4. ✓
