# Loudness Profile Flat Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace standards-oriented built-ins with one flat, mutable Loudness Profile library seeded by a single parameter-named starter profile.

**Architecture:** Keep evaluation and rendering consumers unchanged; replace only the catalogue, persistence shape, provider library operations, and profile-management UI. Persist `{ active, profiles }`, resolve every non-Off selection through the same library, and coordinate profile deletion with the Presets store so no saved preset keeps a dangling profile ID.

**Tech Stack:** React 19, JavaScript, Vitest, Testing Library, local/plugin domain stores, Tailwind/shadcn UI.

**Design:** `docs/superpowers/specs/2026-07-23-loudness-profile-flat-library-design.md`

---

## File map

- `src/lib/loudnessProfileCatalog.js` — starter/draft factories, generic selection IDs, active document resolution.
- `src/lib/loudnessProfileNormalize.js` — flat persisted shape, cold seed, explicit empty-library preservation.
- `src/hooks/LoudnessProfileContext.jsx` — one mutable library, draft lifecycle, deletion cascade into Presets.
- `src/components/LoudnessProfilePopover.jsx` — flat list and Presets-style inline delete confirmation.
- `src/components/LoudnessProfileEditor.jsx` — immediately savable `Untitled` draft and accurate empty-state copy.
- `src/persistence/profileShape.js` — Configuration import/export normalization across settings and preset references.
- Existing Loudness consumer tests — replace built-in fixtures with ordinary library profiles; production consumers do not change.
- Product/design docs — mark standards catalogue as legacy and point old specs to the new contract.

No Rust, DSP, IPC, generated source, or audio-capture code changes are required.

---

### Task 1: Replace the built-in catalogue with flat-library primitives

**Files:**
- Modify: `src/lib/loudnessProfileCatalog.js`
- Modify: `src/lib/loudnessProfileCatalog.test.js`

- [ ] **Step 1: Replace built-in tests with failing starter, draft, and generic-selection tests**

Keep the existing tests for ruleable metrics, empty rules, threshold guards,
`withReferenceLufs`, and `watchedMetricIds`. Remove the built-in and duplicate
suites, then add:

```js
import {
  LOUDNESS_PROFILE_OFF,
  createProfileDraft,
  createStarterProfile,
  parseSelection,
  profileSelectionId,
  resolveActiveDocument,
} from "./loudnessProfileCatalog.js";

describe("createStarterProfile", () => {
  it("creates the ordinary parameter-named starter with fail rules", () => {
    const profile = createStarterProfile(() => "starter-id");
    expect(profile).toEqual({
      id: "starter-id",
      name: "I −23 ±0.5 · TP ≤ −1",
      referenceLufs: -23,
      rules: [
        { metricId: "integrated", op: ">", value: -22.5, severity: "fail" },
        { metricId: "integrated", op: "<", value: -23.5, severity: "fail" },
        { metricId: "truePeak", op: ">", value: -1, severity: "fail" },
      ],
    });
  });
});

describe("createProfileDraft", () => {
  it("starts as an immediately savable inert Untitled profile", () => {
    expect(createProfileDraft()).toEqual({
      id: "draft",
      name: "Untitled",
      referenceLufs: null,
      rules: [],
    });
  });
});

describe("selection helpers", () => {
  it("round-trips a generic profile selection", () => {
    const selection = profileSelectionId("abc");
    expect(selection).toBe("profile:abc");
    expect(parseSelection(selection)).toEqual({ kind: "profile", id: "abc" });
    expect(parseSelection(LOUDNESS_PROFILE_OFF)).toEqual({ kind: "off", id: null });
    expect(parseSelection("builtin:ebu-r128")).toEqual({ kind: "off", id: null });
    expect(parseSelection("user:abc")).toEqual({ kind: "off", id: null });
  });

  it("resolves only documents present in the flat library", () => {
    const mine = { id: "abc", name: "Mine", referenceLufs: null, rules: [] };
    expect(resolveActiveDocument({ active: LOUDNESS_PROFILE_OFF, profiles: [mine] })).toBeNull();
    expect(
      resolveActiveDocument({ active: profileSelectionId("abc"), profiles: [mine] })
    ).toBe(mine);
    expect(
      resolveActiveDocument({ active: profileSelectionId("gone"), profiles: [mine] })
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run the catalogue test and verify the new contract fails**

Run:

```bash
npx vitest run src/lib/loudnessProfileCatalog.test.js
```

Expected: failures for missing `createStarterProfile` /
`profileSelectionId` and the old non-empty draft shape.

- [ ] **Step 3: Implement the minimal flat catalogue**

In `src/lib/loudnessProfileCatalog.js`:

```js
export const LOUDNESS_PROFILE_OFF = "off";
const PROFILE_PREFIX = "profile:";
const defaultMakeId = () => crypto.randomUUID();

function rule(metricId, op, value, severity = "fail") {
  return { metricId, op, value, severity };
}

function band(metricId, target, minus, plus, severity = "fail") {
  return [
    rule(metricId, ">", target + plus, severity),
    rule(metricId, "<", target - minus, severity),
  ];
}

export function createStarterProfile(makeId = defaultMakeId) {
  return {
    id: makeId(),
    name: "I −23 ±0.5 · TP ≤ −1",
    referenceLufs: -23,
    rules: [...band("integrated", -23, 0.5, 0.5), rule("truePeak", ">", -1)],
  };
}

export function createProfileDraft() {
  return { id: "draft", name: "Untitled", referenceLufs: null, rules: [] };
}

export function profileSelectionId(id) {
  return `${PROFILE_PREFIX}${id}`;
}

export function parseSelection(selection) {
  if (typeof selection === "string" && selection.startsWith(PROFILE_PREFIX)) {
    const id = selection.slice(PROFILE_PREFIX.length);
    if (id) return { kind: "profile", id };
  }
  return { kind: "off", id: null };
}

export function resolveActiveDocument(state) {
  const { kind, id } = parseSelection(state?.active);
  if (kind === "off") return null;
  return (state?.profiles ?? []).find((profile) => profile.id === id) ?? null;
}
```

Delete `BUILTIN_LOUDNESS_PROFILES`, both old prefixes and selection helpers,
`BUILTIN_BY_ID`, and `duplicateAsDraft`. Update the file header so the documented
rule-document shape no longer contains `kind` or `basedOn`.

- [ ] **Step 4: Run the catalogue test**

Run:

```bash
npx vitest run src/lib/loudnessProfileCatalog.test.js
```

Expected: PASS.

- [ ] **Step 5: Checkpoint the task**

Inspect the diff for only catalogue/test changes. If the user has explicitly
requested commits, commit with `refactor(loudness): replace built-ins with flat profile primitives`;
otherwise do not commit.

---

### Task 2: Normalize cold seed and explicit empty libraries correctly

**Files:**
- Modify: `src/lib/loudnessProfileNormalize.js`
- Modify: `src/lib/loudnessProfileNormalize.test.js`

- [ ] **Step 1: Write failing normalization tests**

Replace `userProfiles` fixtures with `profiles`, remove `kind`/`basedOn`
expectations, and add:

```js
import { LOUDNESS_PROFILE_OFF, profileSelectionId } from "./loudnessProfileCatalog.js";

describe("normalizeRuleDocument", () => {
  it("keeps only the flat document fields and defaults a blank name", () => {
    expect(
      normalizeRuleDocument({
        id: "p1",
        name: "",
        kind: "builtin",
        basedOn: "ebu-r128",
        referenceLufs: null,
        rules: [],
      })
    ).toEqual({
      id: "p1",
      name: "Untitled",
      referenceLufs: null,
      rules: [],
    });
  });
});

describe("normalizeLoudnessProfiles", () => {
  it("seeds one starter and selects Off when the library has never existed", () => {
    const result = normalizeLoudnessProfiles(undefined, { makeId: () => "starter" });
    expect(result.active).toBe(LOUDNESS_PROFILE_OFF);
    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0]).toMatchObject({
      id: "starter",
      name: "I −23 ±0.5 · TP ≤ −1",
      referenceLufs: -23,
    });
  });

  it("preserves an explicitly empty library", () => {
    expect(normalizeLoudnessProfiles({ active: "off", profiles: [] })).toEqual({
      active: "off",
      profiles: [],
    });
  });

  it("drops duplicate ids and normalizes a dangling selection to Off", () => {
    const profile = { id: "p1", name: "Mine", referenceLufs: null, rules: [] };
    const result = normalizeLoudnessProfiles({
      active: profileSelectionId("gone"),
      profiles: [profile, profile],
    });
    expect(result.profiles).toHaveLength(1);
    expect(result.active).toBe("off");
  });
});
```

- [ ] **Step 2: Run the normalization test and verify failure**

Run:

```bash
npx vitest run src/lib/loudnessProfileNormalize.test.js
```

Expected: failures because the implementation still returns `userProfiles`,
retains metadata, and seeds an empty library.

- [ ] **Step 3: Implement the flat persisted shape**

Use an explicit `profiles` array as the marker that initialization has already
happened. Missing or malformed `profiles` seeds the starter; `profiles: []`
remains empty:

```js
import {
  LOUDNESS_PROFILE_OFF,
  createStarterProfile,
  isKnownMetricId,
  isUsableThreshold,
  parseSelection,
} from "./loudnessProfileCatalog.js";

export function normalizeRuleDocument(raw) {
  // Keep the existing id/reference/rule guards.
  return {
    id: raw.id,
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name : "Untitled",
    referenceLufs: normalizeReference(raw.referenceLufs),
    rules,
  };
}

function normalizeActive(raw, profiles) {
  const { kind, id } = parseSelection(raw);
  if (kind !== "profile") return LOUDNESS_PROFILE_OFF;
  return profiles.some((profile) => profile.id === id) ? raw : LOUDNESS_PROFILE_OFF;
}

export function normalizeLoudnessProfiles(raw, { makeId } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !Array.isArray(raw.profiles)) {
    return {
      active: LOUDNESS_PROFILE_OFF,
      profiles: [createStarterProfile(makeId)],
    };
  }

  const seenIds = new Set();
  const profiles = raw.profiles.map(normalizeRuleDocument).filter((profile) => {
    if (!profile || seenIds.has(profile.id)) return false;
    seenIds.add(profile.id);
    return true;
  });

  return { active: normalizeActive(raw.active, profiles), profiles };
}
```

Do not read `raw.userProfiles`: the feature has not shipped and the accepted
design explicitly rejects migration.

- [ ] **Step 4: Run both pure-core suites**

Run:

```bash
npx vitest run src/lib/loudnessProfileCatalog.test.js src/lib/loudnessProfileNormalize.test.js
```

Expected: PASS.

- [ ] **Step 5: Checkpoint the task**

If commits were explicitly requested, commit with
`refactor(loudness): normalize a seeded flat profile library`; otherwise do not
commit.

---

### Task 3: Move the provider to one library and cascade deletions to Presets

**Files:**
- Modify: `src/hooks/LoudnessProfileContext.jsx`
- Modify: `src/hooks/LoudnessProfileContext.test.jsx`

- [ ] **Step 1: Write failing provider tests for create, edit, delete, and seed persistence**

Update the test harness to read `result.current.profiles` and use
`profileSelectionId`. Add `waitFor` to the Testing Library import, then add
focused tests:

```jsx
it("persists the starter once but does not recreate an explicitly empty library", async () => {
  settingsStore.reset();
  const first = renderHook(() => useLoudnessProfile(), { wrapper });
  await waitFor(() =>
    expect(settingsStore.read().loudnessProfiles?.profiles).toHaveLength(1)
  );
  act(() => first.result.current.removeProfile(first.result.current.profiles[0].id));
  expect(settingsStore.read().loudnessProfiles.profiles).toEqual([]);
  first.unmount();

  const second = renderHook(() => useLoudnessProfile(), { wrapper });
  expect(second.result.current.profiles).toEqual([]);
});

it("creates an inert Untitled profile and selects it", () => {
  const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
  act(() => result.current.beginCreate());
  expect(result.current.draft.document).toMatchObject({
    name: "Untitled",
    referenceLufs: null,
    rules: [],
  });
  act(() => result.current.saveDraft());
  expect(result.current.document).toMatchObject({
    name: "Untitled",
    referenceLufs: null,
    rules: [],
  });
});

it("deleting a profile switches active and all referencing presets to Off", () => {
  settingsStore.patch({
    loudnessProfiles: {
      active: profileSelectionId("p1"),
      profiles: [{ id: "p1", name: "Mine", referenceLufs: null, rules: [] }],
    },
  });
  presetsStore.patch({
    list: [
      { id: "a", name: "A", loudnessProfileActive: profileSelectionId("p1") },
      { id: "b", name: "B", loudnessProfileActive: profileSelectionId("other") },
    ],
    activeId: "a",
    dirty: false,
  });

  const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
  act(() => result.current.removeProfile("p1"));

  expect(result.current.active).toBe("off");
  expect(presetsStore.read().list.map((preset) => preset.loudnessProfileActive)).toEqual([
    "off",
    profileSelectionId("other"),
  ]);
});
```

Keep existing assertions that editing an existing profile restores the prior
selection, a new profile selects itself, live preview does not write, dirty
drafts block library actions, and applying a Preset cancels a draft.

- [ ] **Step 2: Run the provider suite and verify failure**

Run:

```bash
npx vitest run src/hooks/LoudnessProfileContext.test.jsx
```

Expected: failures for the old `userProfiles`, `beginDuplicate`, `removeUser`,
and selection shapes.

- [ ] **Step 3: Convert provider state and draft operations**

Change imports and state operations:

```js
import {
  LOUDNESS_PROFILE_OFF,
  createProfileDraft,
  profileSelectionId,
  resolveActiveDocument,
} from "../lib/loudnessProfileCatalog.js";

// beginEdit
const found = state.profiles.find((profile) => profile.id === id);

// saveDraft
const id = current.editingId ?? crypto.randomUUID();
const saved = { ...current.document, id };
const nextActive = current.editingId
  ? current.resumeSelection
  : profileSelectionId(id);
commit((prev) => ({
  ...prev,
  active: nextActive,
  profiles: prev.profiles.some((profile) => profile.id === id)
    ? prev.profiles.map((profile) => (profile.id === id ? saved : profile))
    : [...prev.profiles, saved],
}));
```

Remove `beginDuplicate`. Rename the exposed collection to `profiles` and the
delete action to `removeProfile`. Normalize preview drafts with
`normalizeRuleDocument(draft.document)`; there is no `kind`.

- [ ] **Step 4: Persist the cold seed without reseeding an empty library**

The initial normalized state must reach `settingsStore`, otherwise exporting a
fresh Configuration omits the starter. Preserve the first render's generated ID:

```js
const [state, setState] = useState(readState);
const initialStateRef = useRef(state);

useEffect(() => {
  const raw = settingsStore.read().loudnessProfiles;
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.profiles)) {
    writeState(initialStateRef.current);
  }
  return settingsStore.subscribe(() => setState(readState()));
}, []);
```

An explicit `{ active: "off", profiles: [] }` skips this write and remains empty.

- [ ] **Step 5: Implement deletion and Preset cascade**

Add a focused helper beside `writeState`:

```js
function replacePresetProfileSelection(selection) {
  const raw = presetsStore.read();
  const list = Array.isArray(raw.list) ? raw.list : [];
  let changed = false;
  const nextList = list.map((preset) => {
    if (preset?.loudnessProfileActive !== selection) return preset;
    changed = true;
    return { ...preset, loudnessProfileActive: LOUDNESS_PROFILE_OFF };
  });
  if (changed) presetsStore.patch({ list: nextList });
}
```

Then replace `removeUser`:

```js
const removeProfile = useCallback(
  (id) => {
    if (draftBlocks()) return;
    if (draftRef.current) cancelDraft();
    const selection = profileSelectionId(id);
    commit((prev) => ({
      ...prev,
      active: prev.active === selection ? LOUDNESS_PROFILE_OFF : prev.active,
      profiles: prev.profiles.filter((profile) => profile.id !== id),
    }));
    replacePresetProfileSelection(selection);
  },
  [cancelDraft, commit, draftBlocks]
);
```

Patch only the Preset `list`; preserve `activeId` and `dirty`. The ordinary
provider `commit` still marks the active Preset dirty when deleting the active
profile changes the session selection.

- [ ] **Step 6: Run provider and pure-core tests**

Run:

```bash
npx vitest run src/lib/loudnessProfileCatalog.test.js src/lib/loudnessProfileNormalize.test.js src/hooks/LoudnessProfileContext.test.jsx
```

Expected: PASS.

- [ ] **Step 7: Checkpoint the task**

If commits were explicitly requested, commit with
`feat(loudness): manage one mutable profile library`; otherwise do not commit.

---

### Task 4: Flatten the popover and use inline delete confirmation

**Files:**
- Modify: `src/components/LoudnessProfilePopover.jsx`
- Modify: `src/components/LoudnessProfilePopover.test.jsx`

- [ ] **Step 1: Write failing visible-behaviour tests**

Build the controller fixture with `profiles`, `profileSelectionId`,
`beginEdit`, and `removeProfile`. Add:

```jsx
it("renders Off, a flat profile library, and New profile without group headings", () => {
  render(<LoudnessProfilePopoverContent profile={makeProfile()} />);
  expect(screen.getByText("Off")).toBeTruthy();
  expect(screen.getByText("I −23 ±0.5 · TP ≤ −1")).toBeTruthy();
  expect(screen.getByText("Mine")).toBeTruthy();
  expect(screen.getByText("New profile")).toBeTruthy();
  expect(screen.queryByText("Built-in")).toBeNull();
  expect(screen.queryByText("Yours")).toBeNull();
  expect(screen.queryByText("-23 LUFS")).toBeNull();
});

it("requires inline confirmation before deleting any profile", () => {
  const profile = makeProfile();
  render(<LoudnessProfilePopoverContent profile={profile} />);

  fireEvent.click(screen.getByLabelText("Delete Mine"));
  expect(profile.removeProfile).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText("Cancel delete Mine"));
  expect(profile.removeProfile).not.toHaveBeenCalled();

  fireEvent.click(screen.getByLabelText("Delete Mine"));
  fireEvent.click(screen.getByLabelText("Confirm delete Mine"));
  expect(profile.removeProfile).toHaveBeenCalledWith("mine");
});

it("offers the same edit action on the seeded profile", () => {
  const profile = makeProfile();
  render(<LoudnessProfilePopoverContent profile={profile} />);
  fireEvent.click(screen.getByLabelText("Edit I −23 ±0.5 · TP ≤ −1 rules"));
  expect(profile.beginEdit).toHaveBeenCalledWith("starter");
});
```

- [ ] **Step 2: Run the popover suite and verify failure**

Run:

```bash
npx vitest run src/components/LoudnessProfilePopover.test.jsx
```

Expected: the old Built-in/Yours groups render and delete fires immediately.

- [ ] **Step 3: Implement one flat row map**

Remove `Copy`, `BUILTIN_LOUDNESS_PROFILES`, both old selection helpers, and both
group headings. Import `InlineConfirm` and `profileSelectionId`. Render
`profile.profiles.map` after Off:

```jsx
{profiles.map((entry) => {
  const selection = profileSelectionId(entry.id);
  return (
    <div key={entry.id} className={cn(ROW_CLASS, "group")}>
      <button
        type="button"
        aria-label={`Use ${entry.name}`}
        onClick={() => profile.select(selection)}
        disabled={blocked}
        className={cn(ROW_BUTTON_CLASS, blockedClass)}
      >
        <ActiveDot active={active === selection} />
        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
      </button>
      <button
        type="button"
        aria-label={`Edit ${entry.name} rules`}
        title="Edit rules"
        onClick={() => profile.beginEdit(entry.id)}
        disabled={blocked}
        className={cn(ICON_BUTTON_CLASS, blockedClass)}
      >
        <SlidersHorizontal className="size-[length:var(--ui-icon-management-action)]" />
      </button>
      <span className="mr-1.5 flex shrink-0 items-center">
        <InlineConfirm
          onConfirm={() => profile.removeProfile(entry.id)}
          confirmLabel={`Confirm delete ${entry.name}`}
          cancelLabel={`Cancel delete ${entry.name}`}
          trigger={(arm) => (
            <button
              type="button"
              aria-label={`Delete ${entry.name}`}
              onClick={arm}
              disabled={blocked}
              className={cn(ICON_BUTTON_CLASS, blockedClass)}
            >
              <Trash2 className="size-[length:var(--ui-icon-management-action)]" />
            </button>
          )}
        />
      </span>
    </div>
  );
})}
```

Keep the existing draft-action blocking and Missing Stats affordance.

- [ ] **Step 4: Run the popover and provider suites**

Run:

```bash
npx vitest run src/components/LoudnessProfilePopover.test.jsx src/hooks/LoudnessProfileContext.test.jsx
```

Expected: PASS.

- [ ] **Step 5: Checkpoint the task**

If commits were explicitly requested, commit with
`feat(loudness): flatten profile management`; otherwise do not commit.

---

### Task 5: Make the empty Untitled editor frictionless

**Files:**
- Modify: `src/components/LoudnessProfileEditor.jsx`
- Modify: `src/components/LoudnessProfileEditor.test.jsx`
- Verify: `src/lib/loudnessProfileEvaluate.test.js`
- Verify: `src/lib/loudnessProfileMissing.test.js`

- [ ] **Step 1: Write failing editor tests**

Keep rule-row coverage by replacing the old `createProfileDraft()`-based
`namedDraft` fixture with an explicit rule-bearing document:

```js
const rulefulDraft = () => ({
  id: "draft",
  name: "Draft",
  referenceLufs: -23,
  rules: [
    { metricId: "integrated", op: ">", value: -22.5, severity: "fail" },
    { metricId: "integrated", op: "<", value: -23.5, severity: "fail" },
    { metricId: "truePeak", op: ">", value: -1, severity: "fail" },
  ],
});

function newDraft() {
  return {
    editingId: null,
    document: createProfileDraft(),
    dirty: false,
  };
}
```

Make `editorProps` default to `rulefulDraft()` so existing rule editing tests
stay meaningful. Use `newDraft()` only for the new-profile cases:

```jsx
it("selects Untitled for immediate replacement in a new profile", () => {
  renderEditor({ draft: newDraft() });
  const input = screen.getByLabelText("Loudness Profile name");
  expect(input).toHaveFocus();
  expect(input.selectionStart).toBe(0);
  expect(input.selectionEnd).toBe("Untitled".length);
});

it("allows an inert profile to save immediately", () => {
  const onSave = vi.fn();
  renderEditor({ draft: newDraft(), onSave });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(onSave).toHaveBeenCalledOnce();
});

it("describes an empty rule set without claiming a reference line exists", () => {
  renderEditor({ draft: newDraft() });
  expect(screen.getByText("No rules — this profile does not judge any metrics.")).toBeTruthy();
});
```

- [ ] **Step 2: Run the editor suite and verify failure**

Run:

```bash
npx vitest run src/components/LoudnessProfileEditor.test.jsx
```

Expected: the new non-empty name does not open rename mode, and old empty-state
copy claims the profile draws a reference line.

- [ ] **Step 3: Implement the editor behaviour**

Initialize rename mode from whether this is a new draft, not whether the name is
blank:

```js
const [renaming, setRenaming] = useState(() => draft.editingId === null);
const [nameDraft, setNameDraft] = useState(draft.document.name ?? "Untitled");
```

Keep the existing focus/select effect. Remove the Save button's disabled
condition:

```jsx
<Button onClick={onSave}>Save</Button>
```

Replace the empty-state copy:

```jsx
<p className="px-1 py-1 text-[length:var(--ui-fs-caption)] text-muted-foreground">
  No rules — this profile does not judge any metrics.
</p>
```

The provider/normalizer still converts a deliberately cleared name to
`Untitled`, so no persisted or accessible label is empty.

- [ ] **Step 4: Verify empty profiles remain inert**

Run:

```bash
npx vitest run src/components/LoudnessProfileEditor.test.jsx src/lib/loudnessProfileEvaluate.test.js src/lib/loudnessProfileMissing.test.js
```

Expected: PASS; no evaluator or missing-stat production change is needed.

- [ ] **Step 5: Checkpoint the task**

If commits were explicitly requested, commit with
`fix(loudness): make empty profiles immediately savable`; otherwise do not
commit.

---

### Task 6: Normalize Configuration snapshots and update all downstream fixtures

**Files:**
- Modify: `src/persistence/profileShape.js`
- Modify: `src/persistence/profileShape.test.js`
- Modify: `src/persistence/profile.test.js`
- Modify: `src/hooks/usePresets.test.jsx`
- Modify: `src/App.smoke.test.jsx`
- Modify: `src/components/PanelSettingsContent.test.jsx`
- Modify: `src/components/panels/StatsPanel.test.jsx`
- Modify: `src/components/panels/LevelMeterPanel.test.jsx`
- Modify: `src/dock/modules/DockStats.test.jsx`
- Modify: `src/hooks/useDockMode.test.js`

- [ ] **Step 1: Add failing Configuration normalization tests**

In `profileShape.test.js`, add a flat library and two preset references:

```js
it("round-trips a flat profile library and normalizes dangling preset references", () => {
  const profile = { id: "p1", name: "Mine", referenceLufs: null, rules: [] };
  const result = buildProfileSnapshot({
    settings: {
      loudnessProfiles: {
        active: "profile:p1",
        profiles: [profile],
      },
    },
    presets: {
      list: [
        { ...VALID_PRESET, id: "valid", loudnessProfileActive: "profile:p1" },
        { ...VALID_PRESET, id: "dangling", loudnessProfileActive: "profile:gone" },
      ],
      activeId: "valid",
    },
  });

  expect(result.settings.loudnessProfiles).toEqual({
    active: "profile:p1",
    profiles: [profile],
  });
  expect(result.presets.list.map((preset) => preset.loudnessProfileActive)).toEqual([
    "profile:p1",
    "off",
  ]);
});
```

In `profile.test.js`, add one browser-mode export/import assertion that the
same flat library reaches `settingsStore` and dangling Preset references arrive
as `off`.

- [ ] **Step 2: Run persistence tests and verify failure**

Run:

```bash
npx vitest run src/persistence/profileShape.test.js src/persistence/profile.test.js
```

Expected: the settings blob is currently cloned without Loudness normalization
and Preset references are not checked against the library.

- [ ] **Step 3: Normalize settings before presets**

Import `normalizeLoudnessProfiles`, `LOUDNESS_PROFILE_OFF`, and
`profileSelectionId`. Keep missing `settings.loudnessProfiles` absent so a
Configuration from before this feature cold-seeds on launch:

```js
function normalizeSettings(settings) {
  const next = clonePlainObject(settings);
  // existing field normalization...
  if ("loudnessProfiles" in next) {
    next.loudnessProfiles = normalizeLoudnessProfiles(next.loudnessProfiles);
  }
  return next;
}

function normalizePresetProfileSelection(selection, loudnessProfiles) {
  if (selection === LOUDNESS_PROFILE_OFF) return LOUDNESS_PROFILE_OFF;
  return loudnessProfiles?.profiles.some(
    (profile) => profileSelectionId(profile.id) === selection
  )
    ? selection
    : LOUDNESS_PROFILE_OFF;
}

function normalizePresets(presets, loudnessProfiles) {
  // Preserve the existing object/id/name/module guards.
  const list = validList.map((preset) => ({
    ...preset,
    loudnessProfileActive: normalizePresetProfileSelection(
      preset.loudnessProfileActive,
      loudnessProfiles
    ),
  }));
  // Preserve activeId normalization.
}

export function buildProfileSnapshot(raw = {}, options = {}) {
  const settings = normalizeSettings(raw.settings);
  return {
    // existing envelope...
    settings,
    presets: normalizePresets(raw.presets, settings.loudnessProfiles),
  };
}
```

Do not modify Rust profile code: `normalizeImportedProfile` runs before the
frontend sends the snapshot to `importProfileCommand`, so both browser and Tauri
imports receive the normalized JS shape.

- [ ] **Step 4: Replace built-in fixtures in consumer tests**

Define an ordinary reusable fixture in each affected test file:

```js
const TEST_PROFILE = {
  id: "test-profile",
  name: "Test profile",
  referenceLufs: -23,
  rules: [
    { metricId: "integrated", op: ">", value: -22.5, severity: "fail" },
    { metricId: "integrated", op: "<", value: -23.5, severity: "fail" },
    { metricId: "truePeak", op: ">", value: -1, severity: "fail" },
  ],
};

settingsStore.patch({
  loudnessProfiles: {
    active: profileSelectionId(TEST_PROFILE.id),
    profiles: [TEST_PROFILE],
  },
});
```

Use this shape in Stats, Dock Stats, Level Meter, Panel Settings, dock-mode, and
App smoke tests. Update `usePresets.test.jsx` expectations from
`builtin:*`/`user:*` to `profile:*`; production `usePresets.js` should remain
unchanged because it snapshots an opaque selection string.

- [ ] **Step 5: Run persistence and all affected consumer suites**

Run:

```bash
npx vitest run src/persistence/profileShape.test.js src/persistence/profile.test.js src/hooks/usePresets.test.jsx src/App.smoke.test.jsx src/components/PanelSettingsContent.test.jsx src/components/panels/StatsPanel.test.jsx src/components/panels/LevelMeterPanel.test.jsx src/dock/modules/DockStats.test.jsx src/hooks/useDockMode.test.js
```

Expected: PASS.

- [ ] **Step 6: Checkpoint the task**

If commits were explicitly requested, commit with
`test(loudness): migrate consumers to flat profiles`; otherwise do not commit.

---

### Task 7: Bring product and historical documentation in line

**Files:**
- Modify: `docs/prd.md`
- Modify: `docs/loudness-references.md`
- Modify: `docs/superpowers/specs/2026-07-19-loudness-profile-design.md`
- Modify: `docs/superpowers/specs/2026-07-20-loudness-profile-editor-design.md`

- [ ] **Step 1: Update the PRD product contract**

Replace the user-story 14 summary with:

```markdown
- **响度档（Loudness Profile，用户故事 14）**：会话级、自定义优先的规则集；首次配置提供一个以实际参数命名、可编辑可删除的示例档，其余由用户按工作流创建。响度档驱动 Loudness 参考线、Stats 数值配色与 Level Meter 的 TP Max 标记，不提供或暗示平台、广播或法规认证预设。测量仍为 ITU-R BS.1770 路径。
```

Adjust the earlier “持续扩充参考集合” statement in §5.2 so it describes
user-defined overlays rather than continued growth of named platform presets.
Do not remove the separate ITU-R BS.1770 measurement-engine statement.

- [ ] **Step 2: Mark the bibliography as legacy without deleting it**

Replace the opening blockquote in `docs/loudness-references.md` with:

```markdown
> **Legacy — historical parameter sources**
>
> This page records sources used by PLVS's former built-in EBU, ATSC, and
> Streaming Loudness Profiles. Those standards are no longer provided or
> recommended as product presets. PLVS now exposes transparent parameters and
> prioritizes user-defined rules, especially for workflows such as game audio
> where broadcast delivery presets are often not useful.
>
> The references below remain only for historical parameter traceability.
> Current product behaviour is specified in
> [`2026-07-23-loudness-profile-flat-library-design.md`](superpowers/specs/2026-07-23-loudness-profile-flat-library-design.md).
```

Rename `Sources (v1 built-ins)` to `Historical sources`.

- [ ] **Step 3: Mark old specs superseded without rewriting history**

At the top of both old Loudness Profile specs, change Status to `Superseded` and
add:

```markdown
**Superseded by:** [`2026-07-23-loudness-profile-flat-library-design.md`](2026-07-23-loudness-profile-flat-library-design.md)
```

Leave their historical bodies intact.

- [ ] **Step 4: Checkpoint the task**

Review links and English-language style. If commits were explicitly requested,
commit with `docs: describe the flat loudness profile library`; otherwise do not
commit.

---

### Task 8: Full verification and scope audit

**Files:**
- Verify all files changed in Tasks 1–7

- [ ] **Step 1: Search for obsolete production vocabulary and APIs**

Run:

```bash
rg "BUILTIN_LOUDNESS_PROFILES|builtinSelectionId|userSelectionId|beginDuplicate|removeUser|userProfiles|builtin:|user:" src
```

Expected: no production-code matches. Historical tests/docs may mention old
shapes only where explicitly testing rejection or explaining superseded
behaviour.

- [ ] **Step 2: Run the focused Loudness and persistence suite**

Run:

```bash
npx vitest run src/lib/loudnessProfileCatalog.test.js src/lib/loudnessProfileNormalize.test.js src/lib/loudnessProfileEvaluate.test.js src/lib/loudnessProfileMissing.test.js src/hooks/LoudnessProfileContext.test.jsx src/components/LoudnessProfilePopover.test.jsx src/components/LoudnessProfileEditor.test.jsx src/hooks/usePresets.test.jsx src/persistence/profileShape.test.js src/persistence/profile.test.js src/App.smoke.test.jsx src/components/PanelSettingsContent.test.jsx src/components/panels/StatsPanel.test.jsx src/components/panels/LevelMeterPanel.test.jsx src/dock/modules/DockStats.test.jsx src/hooks/useDockMode.test.js
```

Expected: all listed suites pass.

- [ ] **Step 3: Run the repository merge gate**

Run:

```bash
npm run check
```

Expected: version, formatting, lint, Vitest, frontend build, Rust formatting,
Clippy, and Rust tests all pass.

If the Rust half reports a missing `src-tauri/binaries/ffmpeg-*.exe` resource in
a fresh worktree, run `npm run ffmpeg:fetch` there and rerun `npm run check`, as
required by `AGENTS.md`.

- [ ] **Step 4: Inspect the final diff against scope**

Confirm:

- no generated files were edited,
- no engine/DSP/capture files changed,
- no migration compatibility was added,
- an explicit empty library survives reload,
- the starter is persisted once and remains fully editable/deletable,
- deleting a profile rewrites active and Preset selections to Off,
- all visible built-in/user grouping and standard-named presets are gone,
- `docs/loudness-references.md` remains present and marked Legacy.

- [ ] **Step 5: Final checkpoint**

Report changed files and verification evidence. Do not create a commit unless
the user explicitly requests one.
