# Agent Control bridge split — design

Date: 2026-10-11
Status: approved 2026-10-11 — approach B, including the Device unmount correction and the
four-run walkthrough cadence

## Why

`src/agentControl/useAgentControlBridge.js` is 4641 lines and one React hook. It grew about 400
lines in the week before this record. Three things are tangled in it:

1. **Plumbing every command shares** — the request queue, the two timeouts, the revision counter,
   waiting for React to render a committed change, long waits, and the screenshot/recording
   bookkeeping.
2. **Ten "watchers"** — effects that each look at one area of app state after every render, decide
   whether the public revision must advance, and wake any command waiting on that area. Each has a
   hand-written "previous value" ref and a hand-written "who is waiting" ref.
3. **About 114 command branches** in one closure (lines 1107–4449), an `if (request.method === …)`
   chain inside a single `useEffect` with 35 dependencies.

The cost is not the line count itself. It is that the three parts can only be kept consistent by
memory:

- Adding an area means adding a ref, an effect, and a line in the unmount cleanup. The unmount
  cleanup today rejects nine of the ten waiting slots; **the Device one is missing**. Nothing
  detects that.
- Which commands skip the queue is a string list in the listener; which commands skip revision
  batching is a different string test in the dispatcher; which need the monitor inventory is a
  third list. A new command has to be added to the right ones by hand.
- The last branch of the chain (Workspace layout apply) has no method test at all. Any method that
  normalizes successfully and matches no earlier branch runs it.
- The chain's order is load-bearing in places (`preset.list` must precede the generic library
  branch; a comment guards it).

## Terms

Used throughout; each is defined once here.

- **Core** — the plumbing in point 1. Knows nothing about any particular command.
- **Domain** — one area of app state the bridge observes: view, workspace, presets, theme,
  loudnessProfile, settings, transport, device, dock.
- **Signature** — a string (or identity comparison) that changes exactly when the public state of a
  domain changes. Already exists per domain (`viewStateSignature`, `dockStateSignature`, …).
- **Watcher** — the per-domain code that runs after a render, compares the signature with the
  previous one, advances the revision if it changed, and resolves any settlement waiting on that
  domain.
- **Settlement** — a promise a mutation waits on after calling the business function. It resolves
  when the watcher sees React render the committed state. It means "React rendered it", not "the
  function returned".
- **Settlement slot** — the single place per domain where a waiting settlement is parked.
- **Family** — a group of wire methods sharing a prefix and a documentation page: `settings.*`,
  `dock.*`, `preset.*`, and so on.
- **Handler** — the function that serves one wire method.
- **Request-start snapshot / latest inputs** — see "Two views of app state" below.

## What must not change

The public contract: wire methods, JSON envelopes, error codes, messages, `details` payloads,
revision semantics ("one atomic operation advances the revision once"), dry-run behaviour, both
timeouts. `inspect --json` is identical before and after apart from `revision`. Mutations keep
going through the owning domain's business functions. Scene operations stay guarded inside the
business function. `docs/agent-control/generated/` is not touched. The contract tests stay green
unmodified.

One deliberate exception is listed under "The one behaviour change".

## Approaches considered

### A. Mechanical file split

Cut the closure into one function per family, each in its own file, and pass every ref and input
through one large context object. The ten watcher effects, the ten slot refs and the cleanup list
stay in the hook as they are.

- For: smallest diff, almost no reasoning about equivalence.
- Against: it is the cosmetic split. The context object would carry roughly sixty fields because
  nothing is abstracted. A new domain can still forget its effect or its cleanup line; a new method
  can still be left out of a routing list. The file gets shorter and the problems stay.

### B. Core + domain table + method table (recommended)

Three explicit pieces:

- a **core** made of small non-React modules (revision clock, settlement registry, waiters, visual
  bookkeeping) plus the request pipeline;
- one **domain table** that declares, per domain, how to compute its signature and what a change
  means; one loop runs every watcher, and the settlement slots are created from the same table;
- one **method table** mapping each wire method to its handler and to its routing facts.

The hook keeps its name, its signature and its position; it becomes the place where these are wired
together.

- For: "cannot forget" becomes structural — slots, watchers and cleanup are all derived from one
  table, and a test compares the method table with the command manifest. Handlers become plain
  async functions that can be read alone. The existing 6621-line test file exercises the hook
  through the same entry point and needs no edits, so it is the proof of equivalence.
- Against: replacing ten effects with one loop needs an equivalence argument (given below) rather
  than being obviously identical. More moving parts than A.

### C. Each domain owner registers its own commands

Move control into the providers that own state (`useSettingsControl()` inside the settings owner,
and so on), each registering handlers with a core through context. This would also dissolve the
30-input `AgentControlBridge.jsx`.

- For: the most idiomatic React shape; each domain is fully self-contained.
- Against: settlement relies on all watchers running in one component within one commit — the
  library import comment ("both watchers fire in the same React commit and the first to arrive is
  the right answer") and the two-store Loudness Profile settlement both depend on it. Spreading
  watchers across providers changes effect ordering, which is exactly the area with recorded
  incidents. It also rewrites the test harness, which removes the proof that nothing changed, and
  it touches every domain owner, which is outside this task (the hook file only).

**Recommendation: B.** A does not solve the problem that was asked about. C is a different, larger
project with a worse risk profile; B does not block it later.

## Design (approach B)

### Layout

```
src/agentControl/
  useAgentControlBridge.js        composition only (target: ~250 lines)
  bridge/
    failures.js                   semanticFailure, visualSemanticFailure, commitNotObserved,
                                  persistUnobservedCommit, the two timeout constants
    revisionClock.js              revision counter, same-turn dedupe, revision batch, wait wake
    settlement.js                 settlement slots, awaitSettlement, rejectAll
    domains.js                    the domain table and the watcher runner
    signatures.js                 the signature and comparison helpers now at the top of the hook
    waiters.js                    the long-wait registry (app.wait, measurement.wait*, recording)
    visualBookkeeping.js          capture controllers, recordings map, capture-active flag
    pipeline.js                   normalize -> batch -> dispatch -> error mapping -> cleanup
    types.js                      JSDoc typedefs: BridgeInputs, BridgeContext, HandlerEntry
  handlers/
    index.js                      merges the family tables into the method table
    app.js  module.js  settings.js  view.js  axis.js  panel.js  workspaceLayout.js
    transport.js  device.js  dock.js  theme.js  loudnessProfile.js  preset.js
    libraryTransfer.js  config.js  measurement.js  visual.js  ui.js  editorDraft.js
    developmentFixture.js
```

The existing per-family helper modules (`settingsControl.js`, `dockControl.js`, …) are untouched.
They are pure planners: given state and a request, say what would change. A handler is the glue
around a planner: check the revision, plan, turn issues into error codes, stop here for a dry run,
arm a settlement, call the business function, wait, flush, shape the result.

### What the core keeps

| Concern                   | Today                                                                   | After                                                                 |
| ------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Request queue             | `queueRef` chain in the listener effect                                 | same code, in the hook's listener effect                              |
| Backstop timeout          | `processWithBackstop`, 8000 ms, clears an abandoned batch               | unchanged, calls `revisionClock.abandonBatch()`                       |
| Settlement timeout        | `awaitSettlement`, 5000 ms, `commitNotObserved`                         | `settlement.js`, same constant, same failure                          |
| Revision                  | `controlRevisionRef` + two "bumped this turn" refs + two bump callbacks | `revisionClock`: `current()`, `bump()`, `bumpWorkspace()`             |
| Revision batching         | `revisionBatchRef`, installed per request                               | `revisionClock.beginBatch()` / `endBatch(batch)`, identity-checked    |
| Waiters                   | `waitersRef`, `waitWakeScheduledRef`, cap of 4                          | `waiters.js`; the revision clock calls its wake                       |
| Visual bookkeeping        | three refs, plus audio-state pushes inside two watchers                 | `visualBookkeeping.js`; transport and device watchers call into it    |
| Listener lifecycle        | per-run `cancelled`, `ready`, `aliveRef`, announce / un-announce        | unchanged, stays in the hook; it is React lifecycle, not command code |
| Error mapping             | one `catch` at the end of the closure                                   | one `catch` in `pipeline.js`, same order of checks                    |
| `persistUnobservedCommit` | called from that one `catch`                                            | same, still exactly one call site                                     |

`revisionClock`, `settlement` and `waiters` are plain objects created once per hook instance and
held in a ref. They contain no React. That makes the subtle rules — a batch advances the revision
once, a late finish cannot clear a later command's batch, wake-ups are deferred while a batch is
open — directly unit-testable for the first time.

### Domains: one table instead of ten effects

```js
// bridge/domains.js (shape, not final code)
export const DOMAINS = [
  { name: "view",      deps: (i) => [i.viewContext],
    signature: (i) => viewStateSignature(i.viewContext.view), bump: "control" },
  { name: "workspace", deps: (i) => [i.workspace],
    changed: (prev, i) => !controllableWorkspaceMatches(prev, i.workspace), bump: "workspace" },
  { name: "presets",   …, bump: "control", library: "preset", alsoObserves: "loudnessProfile" },
  { name: "theme",     …, bump: "control", library: "theme" },
  { name: "loudnessProfile", …, bump: "control", library: "loudnessProfile" },
  { name: "settings",  …custom change rule: ordinary signature + readiness-gated fields },
  { name: "transport", …, bump: "control", afterObserve: pushRecordingAudioState },
  { name: "device",    …, bump: "control", afterObserve: pushRecordingAudioState },
  { name: "dock",      …, bump: "workspace" },
];
```

One effect in the hook runs after every commit and walks the table **in this order**, which is the
declaration order of today's effects. For each domain it first compares the domain's `deps` with
the ones it saw last time, exactly as React compares an effect's dependency array, and skips the
domain if none changed. Then it does what the effect does today: compare signature, bump, wake
waiters, resolve the library slot, resolve the domain's settlement slot.

Why this is equivalent to ten effects:

- React runs a component's effects in declaration order within one commit; the loop runs the same
  bodies in the same order within one effect of the same commit.
- An effect whose dependencies did not change does not run; the loop skips a domain whose `deps`
  did not change. The settlement check therefore still happens only when that domain's input
  changed, never "on any render" — this matters for predicate settlements such as `dock.enter`,
  whose predicate is loose.
- None of the ten effects has a cleanup function, so there is no cleanup ordering to preserve.

What the table buys:

- `settlement.js` creates one slot per table entry, plus the cross-domain `library` slot. Unmount
  calls `rejectAll()`. There is no list to keep in step.
- A domain that declares `library: "theme"` resolves the library slot when it changes; the "import
  does not bump the revision itself" rule and its double-bump incident comment move to that one
  place.
- The special cases stay visible as named options rather than disappearing into a generic
  mechanism: the settings change rule, the two-store Loudness Profile settlement, the recording
  audio-state push.

Each long incident comment moves with the code it describes, verbatim.

### Settlement, as handlers see it

```js
const pending = ctx.settlement.arm("settings", { signature });   // park before calling
try { await snap.applySettings(…); } catch (e) { pending.disarm(); throw … }
result.revision = await pending.observed("The Settings change");   // 5000 ms, commitNotObserved
```

`arm` takes the domain name and the same expectation object used today (`signature`, `matches`,
`requestedId`, or the two-store `expected` map). `observed(subject)` is today's `awaitSettlement`
with its `clear` callback built in, so a handler cannot forget to clear the slot on timeout.
`resolveNow()` covers the two places that resolve by hand (`dock.enter` after reconciliation;
`transport.*` checks the predicate before arming and keeps doing so).

No "mutation template" is introduced. Device, `preset.apply` and library import each differ from
the common shape for a recorded reason, and a template would either hide those differences or grow
a flag for each. The handlers share primitives, not a pipeline.

### Two views of app state

The closure today reads state in two ways, and the difference is behaviour:

- **Closure variables** (`settings`, `dock`, `presets`, `workspace`, …) are whatever React last
  rendered when the request **started**. After an `await` they are stale on purpose — e.g. the Dock
  failure path compares the Dock now with the Dock at request start to report `partial`.
- **`latest…Ref.current`** (`latestDockRef`, `latestTransportRef`, `latestDeviceRef`, …) are
  whatever React rendered **most recently**, read after an `await` to see the committed result.

The design names both and gives every handler both:

- `ctx.snap` — the request-start snapshot: the whole inputs object as of the last commit before the
  request began, never updated during the request.
- `ctx.live()` — the latest inputs, read at the moment of the call.

Both come from one `inputsRef` the hook updates in an effect each commit, which replaces the eight
`latest…Ref`s. Each handler keeps using whichever view its code uses today, line for line. This
also removes the 35-entry dependency array: the pipeline no longer closes over render values.

### Handlers and the method table

```js
// handlers/settings.js
export const settingsHandlers = {
  "settings.describe": { run: describeOrInspect },
  "settings.inspect": { run: describeOrInspect },
  "settings.update": { run: update },
};
```

A handler is `async (ctx) => result-envelope`. `ctx` carries:

| Field                  | What it is                                                         |
| ---------------------- | ------------------------------------------------------------------ |
| `request`, `requestId` | the normalized request                                             |
| `snap`, `live()`       | the two views above                                                |
| `revision`             | `current()`, `assertExpected(subject, options)`, `bump()`          |
| `settlement`           | `arm(domain, expectation)`                                         |
| `flush`                | persistence flush, as injected today                               |
| `dockRequestContext`   | Dock context plus the monitor inventory when the entry asks for it |
| `waiters`, `visual`    | only meaningful to the wait and visual families                    |

An entry may also declare routing facts, which today live in three separate lists:

- `lane: "direct"` — answer without entering the serialized queue (`app.wait`, `measurement.*`,
  `visual.*`). Default is queued, with the backstop.
- `monitorInventory: true` — read the monitor inventory first (`dock.describe`, `dock.enter`,
  `preset.apply`).

Revision batching is not declared; it stays the rule it is now (no batch for `visual.*` or when
`expectedRevision` is absent), in one place in the pipeline.

`revision.assertExpected` replaces about fifteen copies of the conflict check. The copies are not
identical — the subject of the message differs, some require the field and some allow it to be
absent, and the Workspace layout one sends no `details` — so the helper takes those as arguments
and every call site reproduces its current output exactly.

**How a new method cannot be forgotten.** A new test, `handlers/coverage.test.js`, asserts that the
set of method-table keys equals the set of `wireMethod` values of the running-app commands in
`commandManifest.json` plus the development fixture methods. A wire method without a handler, or a
handler for a method the manifest does not know, fails the merge gate. Dispatch is an exact lookup,
so branch order stops mattering and the unguarded final branch disappears.

**How a new domain cannot be forgotten.** A second assertion in the same test checks that every
domain name passed to `settlement.arm` in the handlers appears in `DOMAINS`; `arm` also throws on an
unknown name. Slot, watcher and unmount rejection all come from the table entry.

### Tests

`useAgentControlBridge.test.jsx` stays as the integration suite and is **not edited** during this
work. It mounts the hook through `Harness`, sends requests through the mocked IPC listener and
asserts on wire responses, which is exactly the surface that must not change. Editing it while
moving the code underneath would remove the evidence.

New tests are added only for what is new:

- `bridge/revisionClock.test.js` — single bump per turn, batch bumps once, identity-checked
  `endBatch`, abandoned batch, deferred wake.
- `bridge/settlement.test.js` — arm / observe / disarm, timeout produces `commitNotObserved`,
  `rejectAll` covers every domain, unknown domain throws.
- `bridge/domains.test.js` — the runner skips a domain whose deps did not change, keeps table order,
  resolves the library slot only on a change.
- `handlers/coverage.test.js` — the two assertions above.

Splitting the 6621-line test file by family is a pure file move that can be done afterwards if
wanted. It is not part of this task.

### The one behaviour change

Unmount currently leaves a pending Device settlement to time out after 5 s instead of rejecting it.
With slots derived from the table it is rejected like the others. Nothing reaches the wire either
way — responses are dropped once the bridge is unmounted — so this is not observable to a caller.
It is called out because it is the only place the new code intentionally does something the old
code does not.

## Migration order

Every step is one commit that passes `npm run check`. The integration suite is the gate throughout.

**Step 0 — references.** On the starting commit, recapture `artifacts/app-state` references with
`recipe.sh` and `dock-walk.sh`, twice, and show the two runs agree (inspect identical apart from
the ignored paths; zero changed pixels in the `empty` set). No code change.

**Step 1 — pure moves.** Module-level helpers (failures, signatures, the visual error table) move
to `bridge/`. No logic change.

**Step 2 — revision clock and waiters.** The revision refs and bump callbacks become
`revisionClock`; the waiter map becomes `waiters`. Handlers still live in the closure and call the
new objects.

**Step 3 — settlement registry and domain table.** The ten effects and ten slot refs become the
table and one runner; the closure's `…SettlementRef.current = …` sites become `settlement.arm`.
This is the riskiest step and is done before any handler moves, so that it is judged against an
otherwise unchanged file. Full `recipe.sh` and `dock-walk.sh` run after it.

**Step 4 — `inputsRef` and the dispatcher.** Introduce `ctx`, `snap`, `live()`, and a method table
that is consulted first; anything not in the table falls through to the remaining closure. The
table starts empty.

**Step 5 — one family per commit**, simplest first so the pattern is settled before the hard ones:

1. `app` (capabilities, inspect, wait)
2. `module`
3. `settings`
4. `view`
5. `axis`
6. `panel`
7. `workspaceLayout`
8. `transport`
9. `device`
10. `dock`
11. `theme`
12. `loudnessProfile`
13. `preset`
14. `libraryTransfer` (the `list` / `export` / `import` trio across three families)
15. `config`
16. `measurement`
17. `visual`
18. `ui`
19. `editorDraft`
20. `developmentFixture`

For each mutating family, before committing: with the dev app running, exercise one real mutation
and its reverse through `npm run desktop:control --`, and record `changed: true`, a revision step of
exactly one, and a repeated no-op returning `changed: false`.

**Step 6 — close.** Delete the fall-through and the empty closure, add `handlers/coverage.test.js`,
update the synchronization checklist in `docs/agent-control/README.md` (a new method needs a
method-table entry; a new domain needs a `DOMAINS` entry), and describe the bridge's three parts in
`docs/architecture.md`. Run `recipe.sh`, `dock-walk.sh` and `npm run smoke:agent-control`.

Full `recipe.sh` and `dock-walk.sh` runs are planned after steps 3, 5.7, 5.13 and 6, and
additionally after any step whose CLI exercise shows anything unexpected. They are not run on every
commit: they cold-start the app and take minutes, and the integration suite plus the per-family CLI
exercise cover the per-commit risk.

## Risks

- **Watcher equivalence (step 3).** Argued above, verified by the unmodified integration suite, the
  new runner tests and a full walkthrough. If the suite disagrees, the fallback is to keep ten
  explicit effects that each call `domains.observe(name, inputs)`; the slots and cleanup still come
  from the table, and only the "one loop" part is given up.
- **Snapshot versus latest (step 4).** A handler reading `live()` where the closure read a captured
  variable, or the reverse, is a silent behaviour change. Each family commit is a line-for-line move
  and is reviewed against the old branch for exactly this.
- **Concurrent work on `main`.** Another session pushes to `main`. Any change it makes to this hook
  during the migration conflicts with a moved branch. Family commits are small so a rebase is
  cheap, and `npm run check` is rerun after every rebase; pushes are requested, not automatic.
- **Typecheck.** `ctx` and the inputs get JSDoc typedefs in `bridge/types.js`. No `@ts-ignore`.

## Out of scope

- `AgentControlBridge.jsx` and its 30 inputs.
- Any change to the wire contract, the CLI, the planners, or the generated documentation.
- Splitting the integration test file.
- Moving control into domain owners (approach C).
