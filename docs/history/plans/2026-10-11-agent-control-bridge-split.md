# Agent Control Bridge Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the 4641-line `useAgentControlBridge.js` into a small composition hook over a
command-agnostic core, one domain table and one method table, with no change to the wire contract.

**Architecture:** Non-React core modules (`revisionClock`, `settlement`, `waiters`,
`visualBookkeeping`) hold the shared plumbing. A domain table drives one watcher loop and creates
the settlement slots. A method table maps each wire method to a handler in `handlers/<family>.js`.
The hook wires them together and keeps the listener lifecycle.

**Tech Stack:** React 19 hooks, plain ES modules with JSDoc types checked by `tsc` (checkJs),
Vitest (jsdom for React tests), Prettier, ESLint.

**Spec:** `docs/history/specs/2026-10-11-agent-control-bridge-split-design.md`

## Global Constraints

- Wire methods, JSON envelopes, error codes, messages, `details`, dry-run behaviour unchanged.
  `inspect --json` identical before and after apart from `revision`.
- "One atomic operation advances the revision once."
- `SETTLEMENT_TIMEOUT_MS = 5000`, `QUEUED_REQUEST_TIMEOUT_MS = 8000`,
  `EDITOR_DRAFT_SETTLEMENT_TIMEOUT_MS = 500`, wait cap of 4 — copied, not retuned.
- `src/agentControl/useAgentControlBridge.test.jsx` is not edited by any task.
- Contract tests stay green unmodified: `panelControlCoverage`, `panelControlContract`,
  `settingsControlContract`, `viewControl`, `libraryTransferContract`, `publicSurfaceDocs`.
- Never edit `docs/agent-control/generated/` or `src/generated/`.
- Mutations go through the owning domain's business function; the bridge never writes a store
  (the existing `planned.commit()` of library import is a business function and stays as is).
- Every incident comment moves verbatim with its code: `commitNotObserved`,
  `persistUnobservedCommit`, the library-import double bump, the per-run `cancelled` flag, the
  Preset-view comparison, the `QUEUED_REQUEST_TIMEOUT_MS` rationale.
- JSDoc types, zero `tsc` errors, no `@ts-ignore`.
- English in code, comments and commits. Commits: `refactor(agent-control): …` (or `test(…)`,
  `docs(…)`), ending with the `Co-Authored-By` line. One commit per task, on `main`.
- Before each commit: `npm test`, `npm run format:check`, `npm run lint`, `npm run typecheck`, then
  the full `npm run check`. Before a push: rebase on `origin/main`, rerun `npm run check`, ask the
  user.
- The only intended behaviour difference: a pending Device settlement is rejected on unmount.

## Review Focus

1. A command abandoned by the 8000 ms backstop finishes late while a later command owns the
   revision batch — the late finish must not clear the later batch. Test in Task 2.
2. The bridge unmounts while a settlement is pending in any domain, Device included — every pending
   promise rejects. Test in Task 4.
3. A render that changes an unrelated domain happens while a loose-predicate settlement
   (`dock.enter`) is armed — the Dock slot must not be examined. Test in Task 4.
4. A library import writes two libraries in one commit — the revision advances once and the
   settlement resolves once. Test in Task 4 (runner level; the integration suite already covers the
   wire level).
5. A wire method exists in the manifest with no handler, or a handler exists for an unknown method.
   Test in Task 26.

## File map

```
src/agentControl/
  useAgentControlBridge.js      shrinks every task; ends as composition + listener lifecycle
  bridge/failures.js            Task 1
  bridge/signatures.js          Task 1
  bridge/revisionClock.js       Task 2   (+ .test.js)
  bridge/waiters.js             Task 2
  bridge/settlement.js          Task 4   (+ .test.js)
  bridge/domains.js             Task 4   (+ .test.js)
  bridge/visualBookkeeping.js   Task 23
  bridge/pipeline.js            Task 26
  bridge/types.js               Task 5
  handlers/shared.js            Task 5
  handlers/index.js             Task 5
  handlers/<family>.js          Tasks 6-25, one each
  handlers/coverage.test.js     Task 26
```

Line numbers below refer to `useAgentControlBridge.js` at commit `e3fd41f1`. They drift as tasks
land; locate each block by its `request.method` test, not by number.

---

### Task 0: Capture and prove the references

**Files:** none tracked. Output under `artifacts/app-state/` (untracked).

- [ ] **Step 1:** Read `artifacts/app-state/recipe.sh`, `dock-walk.sh`, `compare-inspect.cjs`.
      Confirm the RDP session is attached. Confirm no dev app is running
      (`Get-Process plvs | Where-Object Path -like '*target\debug\plvs.exe'`); stop by PID only.
- [ ] **Step 2:** `git rev-parse HEAD` — record the starting commit in the session notes.
- [ ] **Step 3:** Move the old references aside (`baseline` → `baseline-pre-bridge-split`, same for
      `dock-ref-dock`), then run `bash artifacts/app-state/recipe.sh baseline` and
      `bash artifacts/app-state/dock-walk.sh dock-ref`.
- [ ] **Step 4:** Run `bash artifacts/app-state/recipe.sh bs-repro` and
      `bash artifacts/app-state/dock-walk.sh bs-repro`. Expected: `inspect compare exit: 0`,
      `pixel compare (empty) exit: 0` with zero changed pixels, Dock walk reports no differences.
      The `data` set is reviewed by eye. If the two runs disagree, stop and fix the rig before any
      code change — a reference that does not reproduce proves nothing.
- [ ] **Step 5:** `npm run check` on the untouched tree. Expected: pass. Record the duration.

### Task 1: Move the module-level helpers

**Files:**

- Create: `src/agentControl/bridge/failures.js`, `src/agentControl/bridge/signatures.js`
- Modify: `src/agentControl/useAgentControlBridge.js:106-541`

**Interfaces — produces:**

- `failures.js`: `semanticFailure(reason, path, message, code, details?)`,
  `visualSemanticFailure(error)`, `SETTLEMENT_TIMEOUT_MS`, `QUEUED_REQUEST_TIMEOUT_MS`,
  `COMMIT_NOT_OBSERVED`, `isCommitNotObserved(error)`, `persistUnobservedCommit(error, flush)`,
  `WAIT_CANCELLED`.
- `signatures.js`: `presetStateSignature`, `themeStateSignature`, `loudnessProfileStateSignature`,
  `activeLoudnessProfileId`, `settingsStateSignature`, `ordinarySettingsStateSignature`,
  `requestedDeviceSignature`, `controllableWorkspaceMatches`, `workspaceMatches`,
  `panelControlsMatch`, `axisStateMatches`, `workspaceMatchesPresetView`, `measuredAudioState`.

- [ ] **Step 1:** Cut each listed function and constant, with its comment block, into the target
      file and `export` it. `awaitSettlement` stays in the hook until Task 4. Everything else at
      module level (`settleEditorDraftObservation`, `publicRecording`, `panelResultPreset`,
      `viewResultPreset`, `compactThemeState`, `themePlanResult`, `compactLoudnessProfileState`,
      `deviceInspection`, `isDifferentPublishedMeasurement`, `transportMutationMatches`) stays
      until the family that uses it moves.
- [ ] **Step 2:** Import them back into the hook. Move the imports the helpers need
      (`settingsStore`, `parseSelection`, `normalizeRuleDocument`, `normalizeThemeDocumentShape`)
      and drop any the hook no longer uses.
- [ ] **Step 3:** `npm test -- src/agentControl` → all pass. `npm run typecheck`, `npm run lint`,
      `npm run format:check` → clean.
- [ ] **Step 4:** `npm run check`, then commit
      `refactor(agent-control): move bridge failure and signature helpers into bridge/`.

### Task 2: Revision clock and waiters

**Files:**

- Create: `src/agentControl/bridge/revisionClock.js`, `bridge/revisionClock.test.js`,
  `bridge/waiters.js`
- Modify: the hook — refs at 738-739, 771-774; callbacks at 784-833; every
  `controlRevisionRef.current`, `revisionBatchRef`, `waitersRef`, `bumpControlRevision`,
  `bumpWorkspaceRevision`, `scheduleWaitWake`, `publishWaitWake` use.

**Interfaces — produces:**

```js
// bridge/waiters.js
/** The long-wait registry: app.wait, measurement.wait*, visual.recording.wait. */
export function createWaiters() {
  /** @type {Map<string, any>} */
  const entries = new Map();
  return {
    entries,
    /** Resolves every revision waiter whose `afterRevision` is no longer current. */
    wakeRevision(revision) {
      for (const [id, waiter] of entries) {
        if (waiter.kind !== "revision") continue;
        if (revision === waiter.afterRevision) continue;
        clearTimeout(waiter.timer);
        entries.delete(id);
        waiter.resolve({ outcome: "changed", matchedImmediately: false, revision });
      }
    },
  };
}
```

```js
// bridge/revisionClock.js
/**
 * The public revision counter and the rules for advancing it.
 *
 * @param {{ onWake: (revision: number) => void }} options
 */
export function createRevisionClock({ onWake }) {
  let revision = 0;
  let bumpedThisTurn = false;
  let workspaceBumpedThisTurn = false;
  let wakeScheduled = false;
  /** @type {{ startRevision: number, bumped: boolean, wakePending: boolean } | null} */
  let batch = null;

  const publishWake = () => {
    if (wakeScheduled) return;
    wakeScheduled = true;
    queueMicrotask(() => {
      wakeScheduled = false;
      onWake(revision);
    });
  };
  const scheduleWake = () => {
    if (batch) {
      batch.wakePending = true;
      return;
    }
    publishWake();
  };
  const bump = () => {
    if (batch) {
      if (batch.bumped) return;
      batch.bumped = true;
      revision += 1;
      return;
    }
    if (bumpedThisTurn) return;
    bumpedThisTurn = true;
    revision += 1;
    queueMicrotask(() => {
      bumpedThisTurn = false;
    });
  };
  const bumpWorkspace = () => {
    if (workspaceBumpedThisTurn) return;
    workspaceBumpedThisTurn = true;
    bump();
    queueMicrotask(() => {
      workspaceBumpedThisTurn = false;
    });
    scheduleWake();
  };

  return {
    current: () => revision,
    bump,
    bumpWorkspace,
    scheduleWake,
    activeBatch: () => batch,
    beginBatch() {
      batch = { startRevision: revision, bumped: false, wakePending: false };
      return batch;
    },
    /** Identity-checked: a command that finishes late cannot clear a later command's batch. */
    endBatch(owned) {
      if (!owned || batch !== owned) return;
      batch = null;
      if (owned.wakePending) publishWake();
    },
    /** For the backstop: the abandoned command has not reached its own cleanup. */
    abandonBatch() {
      const abandoned = batch;
      batch = null;
      if (abandoned?.wakePending) publishWake();
    },
  };
}
```

- [ ] **Step 1: Write the failing test** `bridge/revisionClock.test.js`:

```js
import { describe, expect, it, vi } from "vitest";
import { createRevisionClock } from "./revisionClock.js";

const turn = () => new Promise((resolve) => queueMicrotask(resolve));

describe("createRevisionClock", () => {
  it("advances once for several bumps in one turn and again in the next", async () => {
    const clock = createRevisionClock({ onWake: () => {} });
    clock.bump();
    clock.bump();
    expect(clock.current()).toBe(1);
    await turn();
    clock.bump();
    expect(clock.current()).toBe(2);
  });

  it("advances once for a whole batch, however many turns it spans", async () => {
    const clock = createRevisionClock({ onWake: () => {} });
    const batch = clock.beginBatch();
    clock.bump();
    await turn();
    clock.bump();
    clock.bumpWorkspace();
    expect(clock.current()).toBe(1);
    expect(batch).toMatchObject({ startRevision: 0, bumped: true });
    clock.endBatch(batch);
    await turn();
    clock.bump();
    expect(clock.current()).toBe(2);
  });

  it("holds the wake until the batch ends", async () => {
    const onWake = vi.fn();
    const clock = createRevisionClock({ onWake });
    const batch = clock.beginBatch();
    clock.bump();
    clock.scheduleWake();
    await turn();
    expect(onWake).not.toHaveBeenCalled();
    clock.endBatch(batch);
    await turn();
    expect(onWake).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("does not let a late finish clear a later command's batch", async () => {
    const clock = createRevisionClock({ onWake: () => {} });
    const abandoned = clock.beginBatch();
    clock.abandonBatch();
    const later = clock.beginBatch();
    clock.endBatch(abandoned);
    expect(clock.activeBatch()).toBe(later);
  });

  it("publishes a pending wake when a batch is abandoned", async () => {
    const onWake = vi.fn();
    const clock = createRevisionClock({ onWake });
    clock.beginBatch();
    clock.bumpWorkspace();
    clock.abandonBatch();
    await turn();
    expect(onWake).toHaveBeenCalledExactlyOnceWith(1);
  });
});
```

- [ ] **Step 2:** `npm test -- src/agentControl/bridge/revisionClock.test.js` → FAIL (module
      missing).
- [ ] **Step 3:** Create the two modules with the code above. Run the test → PASS.
- [ ] **Step 4:** In the hook replace the refs with

```js
const coreRef = useRef(null);
if (coreRef.current === null) {
  const waiters = createWaiters();
  coreRef.current = {
    waiters,
    clock: createRevisionClock({ onWake: (revision) => waiters.wakeRevision(revision) }),
  };
}
const { clock, waiters } = coreRef.current;
```

      and rewrite uses mechanically: `controlRevisionRef.current` → `clock.current()`;
      `bumpControlRevision()` → `clock.bump()`; `bumpWorkspaceRevision()` → `clock.bumpWorkspace()`;
      `scheduleWaitWake()` → `clock.scheduleWake()`; `waitersRef.current` → `waiters.entries`;
      the batch creation at 1125-1133 →
      `const revisionBatch = (visual or no expectedRevision) ? null : clock.beginBatch()`; the
      `finally` at 4443-4448 → `clock.endBatch(revisionBatch)`; the backstop body at 4508-4510 →
      `clock.abandonBatch()`; `app.wait`'s `revisionBatchRef.current` → `clock.activeBatch()`.
      Remove the four callbacks and their entries from every dependency array.

- [ ] **Step 5:** `npm test -- src/agentControl` → all pass, the integration suite unmodified.
- [ ] **Step 6:** `npm run check`; commit
      `refactor(agent-control): extract the revision clock and wait registry from the bridge hook`.

### Task 3: One inputs ref instead of eight latest refs

**Files:** Modify the hook only.

**Interfaces — produces:** `inputsRef.current` — an object holding every hook option after
defaulting, plus the derived `loudnessProfiles`, `loudnessActive`, `loudnessSignature`,
`themeState`, `themeControl`, `themeSignature`. Later tasks expose it as `ctx.snap` (captured at
request start) and `ctx.live()` (read at call time).

- [ ] **Step 1:** After the derived values are computed, build
      `const inputs = { enabled, runtime, workspace, …every option…, loudnessProfiles,
loudnessActive, loudnessSignature, themeState, themeControl, themeSignature }` and
      `const inputsRef = useRef(inputs)`.
- [ ] **Step 2:** Add, as the **first** effect of the hook and with no dependency array:
      `useEffect(() => { inputsRef.current = inputs; });`. It must precede the watchers: the Device
      watcher reads the latest Transport in the same commit.
- [ ] **Step 3:** Replace reads: `latestThemeRef.current.state` → `inputsRef.current.themeState`,
      `.control` → `.themeControl`; `latestMeasurementContextRef.current` → `.measurementContext`;
      `latestMeasurementProfileRef.current` → `{ active: .loudnessActive, profile:
.loudnessProfile }`; `latestViewRef` → `.viewContext`; `latestVisualRef` → `.visual`;
      `latestTransportRef` → `.transport`; `latestDeviceRef` → `.device`; `latestDockRef` →
      `.dock`. Delete the eight refs, their assignments, and the effect at 778-782.
- [ ] **Step 4:** Leave every closure variable read (`settings`, `dock`, `presets`, …) untouched.
      This task changes only where "latest" comes from.
- [ ] **Step 5:** `npm test -- src/agentControl` → pass. `npm run check`; commit
      `refactor(agent-control): read the latest bridge inputs from one ref`.

### Task 4: Settlement registry and domain table

**Files:**

- Create: `bridge/settlement.js`, `bridge/settlement.test.js`, `bridge/domains.js`,
  `bridge/domains.test.js`
- Modify: the hook — slot refs 755-770, "previous" refs 740-754, effects 835-1061,
  `resolveLibrarySettlement`, `observeLoudnessProfileSettlement`, `awaitSettlement`, every
  `…SettlementRef.current = …` site, the unmount cleanup 4591-4617.

**Interfaces — produces:**

```js
// bridge/settlement.js
export const SETTLEMENT_SLOTS = Object.freeze([...DOMAIN_NAMES, "library"]);

/** @param {{ current: () => number }} clock */
export function createSettlementRegistry(clock) {
  return {
    /**
     * Parks an expectation in a domain's slot before the business function is called.
     * @param {string} name
     * @param {Record<string, any>} expectation
     */
    arm(name, expectation) /* -> { committed, disarm(), observed(subject), resolveNow() } */,
    peek(name),            // the parked entry or null — for watchers
    resolve(name),         // clears the slot and resolves with clock.current()
    rejectAll(error),      // unmount
  };
}
```

`arm` throws `Error("Unknown settlement slot: <name>")` for a name outside `SETTLEMENT_SLOTS`.
`disarm()` sets the slot to `null` unconditionally, as every `clear` callback does today.
`observed(subject)` is today's `awaitSettlement(committed, disarm, subject)` — move that function
and its comment here. `committed` stays reachable because `preset.apply` awaits two slots through
one `Promise.all`.

```js
// bridge/domains.js
/** Each entry: { name, init(inputs) -> memory, deps(inputs) -> any[], observe(env) }.
 *  env = { inputs, memory, clock, settlement, recordings } */
export const DOMAINS = [
  view,
  workspace,
  presets,
  theme,
  loudnessProfile,
  settings,
  transport,
  device,
  dock,
];
export const DOMAIN_NAMES = DOMAINS.map(({ name }) => name);

export function createDomainRunner({ clock, settlement, recordings, initialInputs }) {
  const states = DOMAINS.map((domain) => ({
    domain,
    deps: null,
    memory: domain.init(initialInputs),
  }));
  /** Call once per commit. Order is the table order; a domain whose deps did not change is
   *  skipped, exactly as an effect with unchanged dependencies does not run. */
  return function observeCommit(inputs) {
    for (const state of states) {
      const deps = state.domain.deps(inputs);
      if (state.deps && deps.every((value, index) => Object.is(value, state.deps[index]))) {
        continue;
      }
      state.deps = deps;
      state.domain.observe({ inputs, memory: state.memory, clock, settlement, recordings });
    }
  };
}
```

Each `observe` is the body of today's effect with refs replaced by `memory` fields and slot refs by
`settlement.peek` / `settlement.resolve`. Example, complete, for `presets` (others follow their
own effect the same way):

```js
const presets = {
  name: "presets",
  init: (inputs) => ({ signature: presetStateSignature(inputs.presets) }),
  deps: (inputs) => [inputs.presets],
  observe({ inputs, memory, clock, settlement }) {
    const signature = presetStateSignature(inputs.presets);
    if (signature !== memory.signature) {
      memory.signature = signature;
      clock.bump();
      clock.scheduleWake();
      resolveLibrary(settlement, "preset");
    }
    const pending = settlement.peek("presets");
    if (pending && signature === pending.signature) settlement.resolve("presets");
    observeLoudnessProfileStore(settlement, "presets", signature);
  },
};
```

`resolveLibrary(settlement, family)` and `observeLoudnessProfileStore(settlement, store,
signature)` are today's `resolveLibrarySettlement` and `observeLoudnessProfileSettlement`, moved
with the long comment at 850-861. Dependency lists, copied from the effects: view
`[viewContext]`; workspace `[workspace]`; presets `[presets]`; theme
`[themeControl, themeSignature, themeState]`; loudnessProfile `[loudnessSignature]`; settings
`[settings, settingsContext.autostartReady, settingsContext.clearShortcutReady]`; transport
`[transport]`; device `[device]`; dock `[dock]`. The transport and device entries keep their
recording audio-state loop, reading the recordings map passed as `recordings` and
`inputs.visual`; device reads `inputs.transport`.

- [ ] **Step 1: Write the failing tests.**

```js
// bridge/settlement.test.js
import { afterEach, describe, expect, it, vi } from "vitest";
import { SETTLEMENT_TIMEOUT_MS } from "./failures.js";
import { createSettlementRegistry, SETTLEMENT_SLOTS } from "./settlement.js";

afterEach(() => vi.useRealTimers());

describe("createSettlementRegistry", () => {
  it("resolves an armed slot with the revision current at that moment", async () => {
    let revision = 3;
    const registry = createSettlementRegistry({ current: () => revision });
    const pending = registry.arm("settings", { signature: "s" });
    expect(registry.peek("settings").signature).toBe("s");
    revision = 4;
    registry.resolve("settings");
    await expect(pending.observed("The Settings change")).resolves.toBe(4);
    expect(registry.peek("settings")).toBeNull();
  });

  it("fails with commitNotObserved and clears the slot after the settlement timeout", async () => {
    vi.useFakeTimers();
    const registry = createSettlementRegistry({ current: () => 0 });
    const outcome = registry.arm("dock", { matches: () => false }).observed("The Dock change");
    const assertion = expect(outcome).rejects.toMatchObject({
      reason: "commitNotObserved",
      code: -32031,
      message: `The Dock change was applied but the commit was not observed within ${SETTLEMENT_TIMEOUT_MS} ms.`,
      details: { stateCommitted: true },
    });
    await vi.advanceTimersByTimeAsync(SETTLEMENT_TIMEOUT_MS);
    await assertion;
    expect(registry.peek("dock")).toBeNull();
  });

  it("rejects every pending slot on unmount, Device included", async () => {
    const registry = createSettlementRegistry({ current: () => 0 });
    const pending = SETTLEMENT_SLOTS.map((name) => registry.arm(name, {}).committed);
    registry.rejectAll(new Error("Agent-control bridge unmounted."));
    const settled = await Promise.allSettled(pending);
    expect(settled.map(({ status }) => status)).toEqual(SETTLEMENT_SLOTS.map(() => "rejected"));
    expect(SETTLEMENT_SLOTS).toContain("device");
  });

  it("refuses a slot the domain table does not define", () => {
    const registry = createSettlementRegistry({ current: () => 0 });
    expect(() => registry.arm("sidebar", {})).toThrow("Unknown settlement slot: sidebar");
  });
});
```

```js
// bridge/domains.test.js
import { describe, expect, it, vi } from "vitest";
import { createDomainRunner, DOMAIN_NAMES } from "./domains.js";
import { createRevisionClock } from "./revisionClock.js";
import { createSettlementRegistry } from "./settlement.js";

const turn = () => new Promise((resolve) => queueMicrotask(resolve));

function baseInputs(overrides = {}) {
  return {
    viewContext: { view: {} },
    workspace: {
      tree: null,
      panelsById: {},
      panelOrder: [],
      panelControlsById: {},
      pinnedPanelsById: {},
      axisViewports: {},
    },
    presets: { list: [], activeId: null, dirty: false },
    themeState: { appearance: { mode: "system" }, themes: [] },
    themeControl: null,
    themeSignature: "theme-0",
    loudnessSignature: "loudness-0",
    settings: { openAtLogin: false, clearShortcut: null, channelLabels: { mode: "auto" } },
    settingsContext: { autostartReady: true, clearShortcutReady: true },
    transport: {
      source: "live",
      live: { state: "stopped" },
      files: { sessions: [] },
      snapshot: { active: false },
    },
    device: null,
    dock: { enabled: false },
    visual: null,
    ...overrides,
  };
}

function setup() {
  const clock = createRevisionClock({ onWake: () => {} });
  const settlement = createSettlementRegistry(clock);
  const inputs = baseInputs();
  const observeCommit = createDomainRunner({
    clock,
    settlement,
    recordings: new Map(),
    initialInputs: inputs,
  });
  observeCommit(inputs);
  return { clock, settlement, inputs, observeCommit };
}

describe("createDomainRunner", () => {
  it("keeps the order of the effects it replaces", () => {
    expect(DOMAIN_NAMES).toEqual([
      "view",
      "workspace",
      "presets",
      "theme",
      "loudnessProfile",
      "settings",
      "transport",
      "device",
      "dock",
    ]);
  });

  it("does not advance the revision on the first commit or on an unchanged one", () => {
    const { clock, inputs, observeCommit } = setup();
    observeCommit({ ...inputs });
    expect(clock.current()).toBe(0);
  });

  it("does not examine a domain whose inputs did not change", async () => {
    const { settlement, inputs, observeCommit } = setup();
    const matches = vi.fn(() => true);
    settlement.arm("dock", { matches });
    observeCommit({ ...inputs, presets: { list: [], activeId: "p1", dirty: false } });
    await turn();
    expect(matches).not.toHaveBeenCalled();
    expect(settlement.peek("dock")).not.toBeNull();
  });

  it("advances once when an import lands in two libraries in one commit", async () => {
    const { clock, settlement, inputs, observeCommit } = setup();
    const pending = settlement.arm("library", { families: ["preset", "loudnessProfile"] });
    observeCommit({
      ...inputs,
      presets: { list: [{ id: "p1" }], activeId: null, dirty: false },
      loudnessSignature: "loudness-1",
    });
    await expect(pending.committed).resolves.toBe(1);
    expect(clock.current()).toBe(1);
  });

  it("leaves a library settlement alone when a library it did not write changes", () => {
    const { settlement, inputs, observeCommit } = setup();
    settlement.arm("library", { families: ["theme"] });
    observeCommit({ ...inputs, loudnessSignature: "loudness-1" });
    expect(settlement.peek("library")).not.toBeNull();
  });
});
```

- [ ] **Step 2:** Run both → FAIL (modules missing).
- [ ] **Step 3:** Implement `settlement.js` and `domains.js`. Run both → PASS. If a fixture field
      turns out to be wrong for a real signature function, fix the fixture, not the function.
- [ ] **Step 4:** In the hook: create `settlement` and the runner inside `coreRef` (the runner
      needs the first render's `inputs`); replace the ten effects with one, placed directly after
      the `inputsRef` effect and with no dependency array:
      `useEffect(() => { observeCommit(inputs); });`. Replace every arming site:

| Site (method)                                    | Becomes                                                                                                                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| device.select                                    | `arm("device", { requestedId })`                                                                                                                                          |
| dock.\*                                          | `arm("dock", { matches })`; manual resolve → `pending.resolveNow()`                                                                                                       |
| transport.\*                                     | `arm("transport", { matches }).observed(…)` after the pre-check                                                                                                           |
| settings.update                                  | `arm("settings", { signature })`                                                                                                                                          |
| view.update / reset                              | `arm("view", { signature })`                                                                                                                                              |
| loudnessProfile.\*                               | `arm("loudnessProfile", { expected, observed: new Set() })`                                                                                                               |
| preset.save / update / rename / delete / reorder | `arm("presets", { signature })`                                                                                                                                           |
| preset.apply                                     | `arm("presets", …)` and `arm("workspace", { matches })`, both awaited through one `Promise.all` wrapped by a single `awaitSettlement`-equivalent whose clear disarms both |
| theme.\*                                         | `arm("theme", { signature })`                                                                                                                                             |
| \*.import                                        | `arm("library", { families: planned.writes })`                                                                                                                            |
| axis.\*, panel.\*, workspace.applyLayout         | `arm("workspace", { matches, … })`                                                                                                                                        |

      Export `awaitSettlement` from `settlement.js` for the `preset.apply` pair and the
      `waitForWorkspacePersistenceEnqueue` wait, which have no slot. Replace the cleanup lines
      4591-4617 with `settlement.rejectAll(new Error("Agent-control bridge unmounted."))`.

- [ ] **Step 5:** `npm test -- src/agentControl` → all pass, the integration suite unmodified. If it
      disagrees on watcher timing, use the fallback in the spec's Risks section (ten explicit
      effects calling the same `observe` bodies) and record that in the commit message.
- [ ] **Step 6:** `npm run check`; commit
      `refactor(agent-control): derive bridge watchers and settlement slots from one domain table`.
- [ ] **Step 7 (walkthrough 1 of 4):** `bash artifacts/app-state/recipe.sh bs-t4` and
      `bash artifacts/app-state/dock-walk.sh bs-t4`. Expected: as Task 0 Step 4. With the app kept
      running once more (`recipe.sh bs-t4b keep`), exercise through `npm run desktop:control --`
      one mutation and its reverse for settings, view, dock enter/exit and preset save/delete,
      checking `changed: true`, revision +1 each, and `changed: false` on repeat. Use
      `docs/user/cli.md` for the exact flags. Stop the app by PID.

### Task 5: Handler context and the dispatcher

**Files:**

- Create: `bridge/types.js`, `handlers/index.js`, `handlers/shared.js`
- Modify: the hook's `processRef.current` closure.

**Interfaces — produces:**

```js
// bridge/types.js
/**
 * @typedef {Record<string, any>} BridgeInputs  Every hook option after defaulting, plus the
 *   derived loudness and theme values. Typed loosely on purpose: the hook's own JSDoc is the
 *   authority for the option shapes.
 *
 * @typedef {{
 *   request: { id: string, method: string, params: Record<string, any> },
 *   requestId: string,
 *   snap: BridgeInputs,
 *   live: () => BridgeInputs,
 *   clock: ReturnType<typeof import("./revisionClock.js").createRevisionClock>,
 *   settlement: ReturnType<typeof import("./settlement.js").createSettlementRegistry>,
 *   waiters: ReturnType<typeof import("./waiters.js").createWaiters>,
 *   visual: Record<string, any>,
 *   dockRequestContext: Record<string, any>,
 *   flush: () => Promise<any>,
 * }} BridgeContext
 *
 * @typedef {{
 *   run: (ctx: BridgeContext) => Promise<any>,
 *   lane?: "direct",
 *   monitorInventory?: true,
 * }} HandlerEntry
 */
export {};
```

```js
// handlers/shared.js
/**
 * @param {import("../bridge/types.js").BridgeContext} ctx
 * @param {string} subject  The start of the message, e.g. "Settings" in
 *   "Settings changed after revision 4."
 * @param {{ required?: boolean, details?: boolean }} [options]
 * @returns {number} the current revision
 */
export function assertExpectedRevision(ctx, subject, { required = false, details = true } = {}) {
  const currentRevision = ctx.clock.current();
  const { expectedRevision } = ctx.request.params;
  if ((required || expectedRevision !== undefined) && expectedRevision !== currentRevision) {
    throw semanticFailure(
      "revisionConflict",
      "$.params.expectedRevision",
      `${subject} changed after revision ${expectedRevision}.`,
      -32004,
      details ? { expectedRevision, currentRevision } : undefined
    );
  }
  return currentRevision;
}
```

Before using `assertExpectedRevision` at a site, compare the site's message, whether it tolerates
an absent field, and its `details` with what the helper produces. A site that does not fit (the
development-fixture one throws a differently shaped error) keeps its own code.

`handlers/shared.js` also receives `panelResultPreset` and `viewResultPreset` from the hook.

```js
// handlers/index.js
/** @type {Record<string, import("../bridge/types.js").HandlerEntry>} */
export const METHOD_TABLE = Object.freeze({});
```

- [ ] **Step 1:** Create the three files.
- [ ] **Step 2:** In the closure, immediately after `dockRequestContext` is resolved and before the
      development-fixture branch, add:

```js
const entry = METHOD_TABLE[request.method];
if (entry) {
  return await entry.run({
    request,
    requestId,
    snap,
    live: () => inputsRef.current,
    clock,
    settlement,
    waiters,
    visual: visualBook,
    dockRequestContext,
    flush: snap.flush,
  });
}
```

      with `const snap = inputsRef.current;` taken as the first statement of the closure, and
      `visualBook = { captures: visualCapturesRef.current, recordings:
      visualRecordingsRef.current, captureActive: visualCaptureActiveRef }` until Task 23 replaces
      it. The `return await` keeps the call inside the closure's `try`, so error mapping and batch
      cleanup still apply.

- [ ] **Step 3:** `npm test -- src/agentControl` → pass (the table is empty; nothing is routed).
- [ ] **Step 4:** `npm run check`; commit
      `refactor(agent-control): add the bridge handler context and method table`.

### Tasks 6-25: one family per commit

Every family task follows the same procedure. The table gives what differs.

**Procedure**

- [ ] **Step 1:** Create `src/agentControl/handlers/<file>.js`. Move the family's branches out of
      the closure into named `async function`s taking `ctx`, and export
      `export const <family>Handlers = { "<wire.method>": { run: fn }, … }` with one key per wire
      method listed. Branches that serve several methods become one function registered under each
      key.
- [ ] **Step 2:** Translate identifiers, and nothing else: - a closure variable `x` that was a hook option or derived value → `ctx.snap.x`
      (destructure at the top of the function: `const { settings, settingsContext } = ctx.snap;`); - `inputsRef.current.x` → `ctx.live().x`; - `request`, `requestId`, `clock`, `settlement`, `waiters`, `flush`, `dockRequestContext` →
      from `ctx`; - a repeated revision check → `assertExpectedRevision` only where the output is identical.
      Do not reorder statements, merge branches, rename result fields or "tidy" conditions.
- [ ] **Step 3:** Move module-level helpers used only by this family into the handler file; ones
      shared with another family go to `handlers/shared.js`. Move their comments with them.
- [ ] **Step 4:** Spread the family table into `METHOD_TABLE` in `handlers/index.js`. Delete the
      moved branches from the closure, and remove from the closure effect's dependency array and
      from the hook's imports whatever nothing references any more.
- [ ] **Step 5:** Review the diff of the moved code against the deleted code with
      `git diff --color-moved=dimmed-zebra --color-moved-ws=ignore-all-space`. Every line that is
      not dimmed must be one of the Step 2 translations. In particular check each state read: was it
      a closure variable (→ `snap`) or a latest ref (→ `live()`)?
- [ ] **Step 6:** `npm test -- src/agentControl` → all pass, integration suite unmodified.
      `npm run typecheck`, `npm run lint`, `npm run format:check` → clean.
- [ ] **Step 7:** If the family mutates: with the dev app running on an isolated profile
      (`recipe.sh <label> keep`), run the listed CLI exercise through `npm run desktop:control --`
      (flags from `docs/user/cli.md`): `inspect --json` for the revision; the mutation with
      `--dry-run` (expect no revision change); the mutation (expect `changed: true`, revision +1);
      the same mutation again (expect `changed: false`, revision unchanged); the reverse (expect
      revision +1). Stop the app by PID afterwards.
- [ ] **Step 8:** `npm run check`; commit `refactor(agent-control): move the <family> handlers out
of the bridge hook`.

**Families**

| Task | File                    | Wire methods                                                                                                                                                                              | Notes; CLI exercise                                                                                                                                                                                                                                                                                                      |
| ---- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 6    | `app.js`                | `app.capabilities`, `app.inspect`, `app.wait`                                                                                                                                             | `app.wait` gets `lane: "direct"`. `deviceInspection` moves to `shared.js` (Device uses it too). Exercise: `inspect`, `capabilities`, a `wait` that times out and one released by a settings change.                                                                                                                      |
| 7    | `module.js`             | `module.list`, `module.describe`                                                                                                                                                          | Read-only.                                                                                                                                                                                                                                                                                                               |
| 8    | `settings.js`           | `settings.describe`, `settings.inspect`, `settings.update`                                                                                                                                | Exercise: toggle one ordinary setting and back.                                                                                                                                                                                                                                                                          |
| 9    | `view.js`               | `view.describe`, `view.inspect`, `view.update`, `view.reset`                                                                                                                              | Exercise: change one view field and `reset`.                                                                                                                                                                                                                                                                             |
| 10   | `axis.js`               | `axis.describe`, `axis.inspect`, `axis.shared.update`, `axis.shared.reset`, `axis.panel.update`, `axis.panel.reset`                                                                       | Exercise: one shared axis update and reset.                                                                                                                                                                                                                                                                              |
| 11   | `panel.js`              | `panel.describe`, `panel.update`, `panel.reset`                                                                                                                                           | Exercise: one panel control and `reset`.                                                                                                                                                                                                                                                                                 |
| 12   | `workspaceLayout.js`    | `workspace.applyLayout`                                                                                                                                                                   | This is the unguarded final branch; its revision conflict carries no `details` (`details: false`). Keep `WorkspaceLayoutError` mapping in the closure's `catch`. Exercise: apply a changed layout and the original. **Walkthrough 2 of 4 after this commit** (`recipe.sh bs-t12`, `dock-walk.sh bs-t12`).                |
| 13   | `transport.js`          | `transport.inspect`, `transport.file.report`, and the twelve mutating/action methods the manifest lists under `transport.*`                                                               | `transportMutationMatches` moves here. `transport.live.clear` keeps its manual `clock.bump(); clock.scheduleWake()`. Exercise: `live start` / `live stop`; a snapshot select / clear if history is available.                                                                                                            |
| 14   | `device.js`             | `device.list`, `device.inspect`, `device.select`                                                                                                                                          | Keep the three plan/preview passes and the two `awaitSettlement` branches as they are. Exercise: select another device with the restart confirmation, and back; if only one device exists, `--dry-run` only and say so in the commit.                                                                                    |
| 15   | `dock.js`               | `dock.describe`, `dock.inspect`, `dock.panel.describe`, `dock.enter`, `dock.exit`, `dock.layout.apply`, `dock.panel.update`, `dock.panel.reset`                                           | `dock.describe` and `dock.enter` get `monitorInventory: true` (not yet read by the core; Task 26). The failure path compares `ctx.live().dock` with `ctx.snap.dock` — keep both. Exercise: enter, a panel update, exit.                                                                                                  |
| 16   | `theme.js`              | `theme.inspect`, `theme.list`, `theme.describe`, `theme.select`, `theme.followSystem`, `theme.create`, `theme.update`, `theme.rename`, `theme.duplicate`, `theme.delete`, `theme.reorder` | `theme.list` here is the family's own branch at 3688, not the generic library one — confirm which branch each method reaches today before registering it. `compactThemeState`, `themePlanResult` move here. Exercise: duplicate a theme, select it, delete it.                                                           |
| 17   | `loudnessProfile.js`    | `loudnessProfile.describe`, `.select`, `.create`, `.update`, `.rename`, `.delete`, `.reorder`                                                                                             | The two-store expectation stays as written. Exercise: create, select, delete.                                                                                                                                                                                                                                            |
| 18   | `preset.js`             | `preset.list`, `preset.describe`, `preset.save`, `preset.update`, `preset.apply`, `preset.rename`, `preset.delete`, `preset.reorder`                                                      | `preset.apply` gets `monitorInventory: true`. Keep both `assertSceneOperationAllowed` calls per method and the Preset-view comment. Exercise: save, apply another, apply back, delete. **Walkthrough 3 of 4 after this commit.**                                                                                         |
| 19   | `libraryTransfer.js`    | `loudnessProfile.list`, `preset.export`, `theme.export`, `loudnessProfile.export`, `preset.import`, `theme.import`, `loudnessProfile.import`                                              | One function per action registered under each family's key. `theme.list` and `preset.list` are **not** here if their own branches serve them today. Exercise: export a preset pack, import it (expect appended copy, revision +1), delete the copy.                                                                      |
| 20   | `config.js`             | `config.export`, `config.import`                                                                                                                                                          | The response keeps `awaitDelivery` and `afterResponse`. Exercise: export; import with `--dry-run` only (a real import relaunches).                                                                                                                                                                                       |
| 21   | `measurement.js`        | `measurement.describe`, `measurement.inspect`, `measurement.wait`, `measurement.waitUntil`                                                                                                | All four `lane: "direct"`. `buildCurrentMeasurement` / `buildMeasurementOrFail` and `isDifferentPublishedMeasurement` move here and read `ctx.live()`.                                                                                                                                                                   |
| 22   | `ui.js`                 | `ui.inspect`, `ui.show.settings`, `ui.show.panelSettings`, `ui.show.themeEditor`, `ui.show.loudnessProfileEditor`, `ui.show.feedback`, `ui.close`, `ui.cancel`                            | Exercise: show settings, close.                                                                                                                                                                                                                                                                                          |
| 23   | `visual.js`             | `visual.describe`, `visual.screenshot`, `visual.recording.start`, `.inspect`, `.wait`, `.stop`                                                                                            | All `lane: "direct"`. Also create `bridge/visualBookkeeping.js` exporting `createVisualBookkeeping()` → `{ captures: Map, recordings: Map, captureActive: { current: boolean } }`, held in `coreRef`, replacing the three refs and passed to the domain runner as `recordings`. Exercise: `npm run smoke:agent-control`. |
| 24   | `editorDraft.js`        | `editorDraft.describe`, `.inspect`, `.patch`, `.undo`, `.redo`, `.discard`, `.save`                                                                                                       | `settleEditorDraftObservation` and its 500 ms constant move here. Exercise: open the theme editor through `ui show`, patch, undo, discard.                                                                                                                                                                               |
| 25   | `developmentFixture.js` | the methods `isDevelopmentFixtureMethod` accepts                                                                                                                                          | The pre-normalization choice (`normalizeDevelopmentFixtureRequest`) stays in the pipeline; only the branch body moves. The handler is reached only when `developmentFixtures?.enabled`; otherwise normalization has already rejected the method.                                                                         |

### Task 26: Close

**Files:**

- Create: `bridge/pipeline.js`, `handlers/coverage.test.js`
- Modify: the hook, `handlers/index.js`, `docs/agent-control/README.md`, `docs/architecture.md`

**Interfaces — produces:**

```js
// bridge/pipeline.js
/**
 * @param {{ inputsRef: { current: import("./types.js").BridgeInputs }, clock, settlement,
 *   waiters, visual, table: Record<string, import("./types.js").HandlerEntry> }} core
 * @returns {(rawRequest: any) => Promise<any>}
 */
export function createRequestProcessor(core) { … }

/** @returns {boolean} whether the listener answers this method outside the serialized queue */
export function isDirectLane(table, method) {
  return table[method]?.lane === "direct";
}
```

`createRequestProcessor` is what is left of the closure: take `snap`, choose the normalizer,
compute `requestId`, begin the batch (same rule), resolve `dockRequestContext` when
`entry.monitorInventory` is set, run the handler, and keep the `catch` (commitNotObserved →
`persistUnobservedCommit`; `WorkspaceLayoutError`; refused scene operation) and the `finally`
(`clock.endBatch`) exactly as they are. A method with no entry throws
`semanticFailure("commandFailed", "$.method", …, -32601)` — unreachable while the coverage test
passes; confirm the code against what `normalizeAgentControlRequest` returns for an unknown method
and reuse that failure instead if it differs.

- [ ] **Step 1: Write the failing test** `handlers/coverage.test.js`:

```js
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import manifest from "../commandManifest.json" with { type: "json" };
import { DEVELOPMENT_FIXTURE_METHODS } from "../developmentFixtureProtocol.js";
import { SETTLEMENT_SLOTS } from "../bridge/settlement.js";
import { METHOD_TABLE } from "./index.js";

describe("Agent Control handler coverage", () => {
  it("has exactly one handler for every wire method a running app serves", () => {
    const wireMethods = manifest.commands
      .filter(({ execution }) => execution === "runningApp")
      .map(({ wireMethod }) => wireMethod);
    const expected = [...new Set([...wireMethods, ...DEVELOPMENT_FIXTURE_METHODS])].sort();
    expect(Object.keys(METHOD_TABLE).sort()).toEqual(expected);
  });

  it("gives every handler a run function", () => {
    for (const [method, entry] of Object.entries(METHOD_TABLE)) {
      expect(typeof entry.run, method).toBe("function");
    }
  });

  it("arms only settlement slots the domain table defines", () => {
    const directory = fileURLToPath(new URL(".", import.meta.url));
    const armed = new Set();
    for (const file of readdirSync(directory).filter((name) => name.endsWith(".js"))) {
      const source = readFileSync(`${directory}/${file}`, "utf8");
      for (const [, name] of source.matchAll(/settlement\.arm\(\s*"([^"]+)"/g)) armed.add(name);
    }
    expect(armed.size).toBeGreaterThan(0);
    for (const name of armed) expect(SETTLEMENT_SLOTS, name).toContain(name);
  });
});
```

      If `developmentFixtureProtocol.js` does not export a method list, export the one
      `isDevelopmentFixtureMethod` already uses as `DEVELOPMENT_FIXTURE_METHODS`; if the manifest
      already lists those methods, drop the import and the union.

- [ ] **Step 2:** Run it. Expected: PASS already if Tasks 6-25 were complete; a failure names the
      method that was missed — move it, do not edit the expectation.
- [ ] **Step 3:** Create `pipeline.js`; the hook's closure effect and `processRef` are replaced by
      `const process = useMemo(() => createRequestProcessor({ … }), [])` built from `coreRef` and
      `inputsRef`. In the listener, replace the direct-lane string list with
      `isDirectLane(METHOD_TABLE, request?.method)` and the monitor-inventory string list with the
      entry flag. Confirm by reading that the direct-lane set is unchanged: `app.wait`, the four
      `measurement.*`, and every `visual.*`.
- [ ] **Step 4:** `npm test -- src/agentControl` → all pass, integration suite unmodified.
- [ ] **Step 5:** `docs/agent-control/README.md`, synchronization checklist: add "register the wire
      method in `src/agentControl/handlers/<family>.js`; `handlers/coverage.test.js` fails
      otherwise" and "a new observed state area is a new entry in `bridge/domains.js`".
      `docs/architecture.md`, next to the `AgentControlBridge` paragraph (around line 148): three
      or four sentences naming the core, the domain table and the method table, and stating that
      settlement means React rendered the committed state. No link into `docs/history/`.
- [ ] **Step 6:** `npm run check`; commit
      `refactor(agent-control): dispatch bridge requests through the method table`.
- [ ] **Step 7 (walkthrough 4 of 4):** `recipe.sh bs-final`, `dock-walk.sh bs-final`, and with the
      dev app running `npm run smoke:agent-control`. Expected: inspect identical apart from the
      ignored paths and `revision`; zero changed pixels in the `empty` set; smoke green.
- [ ] **Step 8:** Report to the user: final line counts per file, the four walkthrough results,
      anything that deviated from this plan. Ask before pushing; rebase on `origin/main` and rerun
      `npm run check` first.

## Self-review notes

- Spec coverage: core table → Tasks 1, 2, 4, 23, 26; domain table → Task 4; two views of state →
  Tasks 3, 5; method table and routing facts → Tasks 5-26; tests → Tasks 2, 4, 26; the one
  behaviour change → Task 4 (`rejectAll`); migration order → task order; documentation → Task 26.
- The spec's `ctx.revision` / `ctx.settlement.arm` sketch is realised as `ctx.clock` and
  `ctx.settlement`; `assertExpected` is the free function `assertExpectedRevision(ctx, …)`.
- The spec sketches domain entries as declarative options (`bump`, `library`). The plan uses an
  explicit `observe` body per domain instead: nine short functions that read like the effects they
  replace are easier to verify against the original than a generic interpreter with special-case
  flags, and the "cannot forget" property comes from the table, not from the option names.
