# Three-Platform Capture Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A stable release cannot publish unless `smoke:capture` passed on Windows, macOS and Linux
for the exact release commit, run by self-hosted runners on the maintainer's home machines.

**Architecture:** The rig lease becomes machine-wide so a runner clone and a manual clone share it.
A dispatch-only `capture-acceptance.yml` runs `smoke:capture` on three self-hosted labels and checks
each `result.json` with a small verifier script. After the home machines have been measured, the
workflow gains `workflow_call`, and `release.yml` makes `prepare-draft` depend on it. A contract test
keeps every self-hosted job unreachable from untrusted triggers.

**Tech Stack:** Node ESM scripts and Vitest (`scripts/*.mjs`, `*.test.mjs`), GitHub Actions YAML,
Markdown docs.

**Spec:** `docs/history/specs/2026-10-20-three-platform-capture-acceptance-design.md`

## Global Constraints

- Repository is public: self-hosted jobs may only live in workflows triggered by
  `workflow_dispatch`, `workflow_call` or `schedule`, and are never handed secrets.
- No bypass input on any capture gate.
- Evidence must name the exact `commit_sha` and the job's platform; `summary` must be `complete`.
- ADR 0028 is not edited; the new ADR supersedes only its lease location.
- Commits: Conventional Commits with scope, ending with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Before each commit: `npm test`, plus
  `npm run format:check` and `npm run lint` when scripts change. Before each push:
  `npm run check:changes`.
- Work lands on `main` directly; history stays linear.
- This plan does not touch the capture layer (`src-tauri/src/audio`, `dsp`,
  `engine`).

## Review Focus

1. **A live lease held by another OS user is never stolen.** When the start time of a live PID
   cannot be read (another user's process on Windows), the holder counts as alive. Pinned in Task 1.
2. **PID reuse on macOS and Linux.** A lease whose PID now belongs to a process that started at a
   different time counts as dead. Pinned in Task 1.
3. **Evidence from a different commit or platform in the same artifacts tree.** The runner keeps old
   runs. The verifier must select only the exact SHA and platform, and fail when there is none.
   Pinned in Task 4.
4. **A self-hosted job reachable through `workflow_call` from a workflow with an untrusted
   trigger.** Pinned in Task 4, re-checked in Task 6.
5. **An offline runner.** The release must wait and then fail, never skip. Pinned in Task 6 by
   asserting there is no `continue-on-error` or `if:` skip on the capture job.

---

## Phase 1 — repository prerequisites (no home machine needed)

### Task 1: Machine-wide rig lease and ADR 0034

**Files:**

- Modify: `scripts/rig-lease.mjs`
- Modify: `scripts/rig-lease.test.mjs`
- Modify: `scripts/capture-rig.mjs:17,476-495` (import and `takeRig`)
- Create: `docs/adr/0034-capture-rig-lease-is-machine-wide.md`
- Modify: `docs/pitfalls.md` (capture rig lease paragraph), `AGENTS.md` ("Capture rig" pitfall: add
  "the lease is per machine, not per repository")

**Interfaces:**

- Produces: `machineLeaseDirectory(platform = process.platform, env = process.env): string`, which
  returns `join(env.ProgramData ?? "C:\\ProgramData", "PLVS")` on `win32`, `"/Users/Shared/PLVS"` on
  `darwin`, and `"/var/tmp/plvs"` otherwise.
- Produces: `ensureLeaseDirectory(directory: string): string`, which runs `mkdirSync` recursively
  and, on POSIX, `chmodSync(directory, 0o777)` so that any local user can create and remove the
  lease. It returns the directory.
- Changes: `holderIsAlive(holder, { startTimeMs = processStartTimeMs } = {})`. The PID check stays as
  it is. Then, on every platform: a start time of `null` (unreadable) means alive; otherwise the
  holder is alive when the start time is within `START_TIME_TOLERANCE_MS` of
  `holder.processStartedAtMs`.
- Changes: `processStartTimeMs(pid)` covers all three platforms. Windows keeps the PowerShell query;
  macOS and Linux use `ps -o lstart= -p <pid>` with `LC_ALL=C` and `Date.parse` on the trimmed
  output. Any failure returns `null`.
- `leasePath(directory)` keeps its signature.

- [ ] **Step 1: Write failing tests in `scripts/rig-lease.test.mjs`**

```js
describe("machineLeaseDirectory", () => {
  it("is one shared directory per platform", () => {
    expect(machineLeaseDirectory("win32", { ProgramData: "D:\\PD" })).toBe(join("D:\\PD", "PLVS"));
    expect(machineLeaseDirectory("darwin", {})).toBe("/Users/Shared/PLVS");
    expect(machineLeaseDirectory("linux", {})).toBe("/var/tmp/plvs");
  });
});

describe("holderIsAlive across users and PID reuse", () => {
  it("treats a live PID whose start time cannot be read as alive", () => {
    expect(
      holderIsAlive(currentOwner({ worktree: "w", command: "c" }), { startTimeMs: () => null })
    ).toBe(true);
  });
  it("treats a live PID that started at another time as reused, so dead", () => {
    const holder = { ...currentOwner({ worktree: "w", command: "c" }), processStartedAtMs: 1 };
    expect(holderIsAlive(holder, { startTimeMs: () => Date.now() })).toBe(false);
  });
});
```

Also: `ensureLeaseDirectory` creates a nested directory under a temp root and returns it, and on
POSIX the resulting mode includes `0o777` (`it.skipIf(process.platform === "win32")`).

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run scripts/rig-lease.test.mjs`
Expected: FAIL. `machineLeaseDirectory` is not exported, and the `null` start time currently yields
`false` on Windows.

- [ ] **Step 3: Implement the interfaces above in `scripts/rig-lease.mjs`**

Update the header comment so it no longer says "a file in the Git common directory" or "the rig is
Windows-only today".

- [ ] **Step 4: Switch `takeRig` in `scripts/capture-rig.mjs`**

Replace `leasePath(gitCommonDir(ROOT))` with
`leasePath(ensureLeaseDirectory(machineLeaseDirectory()))`. Remove the `gitCommonDir` import if
nothing else in the file uses it. Change the "(ADR 0028)" reference in its comment to "(ADR 0034)".

- [ ] **Step 5: Run lease, rig and worktree tests**

Run: `npx vitest run scripts/rig-lease.test.mjs scripts/capture-rig.test.mjs scripts/dev-worktree.test.mjs`
Expected: PASS.

- [ ] **Step 6: Write ADR 0034**

Follow the shape of ADR 0028 (Status / Context / Decision / Consequences). Status: "Accepted
(2026-10-20). Supersedes the lease location in ADR 0028; the rest of 0028 stands." Context: a
self-hosted runner works in its own clone, which is a second Git common directory driving the same
VB-Cable, BlackHole or Pulse rig. Decision: the paths above, `0o777` on POSIX, unreadable start time
means alive. Consequences:

- an old checkout on the same machine still uses the old path until it is updated;
- a holder on Windows from another user can only be cleared by hand when it really is dead;
- Linux sinks are already private per PID, so on Linux the lease guards the harness, not the tone.

Update `docs/pitfalls.md` and `AGENTS.md` as listed under Files.

- [ ] **Step 7: Verify and commit**

Run: `npm run format:check && npm run lint && npm test`
Expected: all pass.

```bash
git add scripts/rig-lease.mjs scripts/rig-lease.test.mjs scripts/capture-rig.mjs docs/adr/0034-capture-rig-lease-is-machine-wide.md docs/pitfalls.md AGENTS.md
git commit -m "fix(rig): share the capture rig lease across every clone on a machine"
```

### Task 2: Linux as a base acceptance platform

**Files:**

- Modify: `scripts/acceptance-evidence.mjs:10`
- Modify: `scripts/acceptance-evidence.test.mjs` (the expectation near line 96)
- Modify: `CONTRIBUTING.md` (the "ready for Linux branch integration" paragraph in "Packaged update
  acceptance")

**Interfaces:**

- Produces: `ACCEPTANCE_BASE_PLATFORMS = ["windows", "macos", "linux"]`.
- Does not change `PLATFORMS` in `scripts/report-update-acceptance.mjs`. Packaged update acceptance
  has no Linux producer, so requiring Linux there would block every updater-touching release. That
  is recorded as a follow-up, not done here.

- [ ] **Step 1: Change the test expectation**

Change `expect(value.platforms).toEqual(["windows", "macos"])` to
`["windows", "macos", "linux"]`. Add an assertion that, with no Linux evidence, every Linux cell's
status is `"missing"`.

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run scripts/acceptance-evidence.test.mjs`
Expected: FAIL on the platforms list.

- [ ] **Step 3: Add `"linux"` to `ACCEPTANCE_BASE_PLATFORMS`**

Run the same command. Expected: PASS. Then run `npm test` to catch other suites that snapshot the
report.

- [ ] **Step 4: Rewrite the CONTRIBUTING paragraph**

The general acceptance report now always shows a Linux column. Packaged update acceptance remains
Windows/macOS until a Linux version-notice producer exists.

- [ ] **Step 5: Commit**

```bash
git commit -am "fix(release): report Linux as a base acceptance platform"
```

### Task 3: Pin hosted runner images in release.yml

**Files:**

- Modify: `.github/workflows/release.yml:122,202`
- Modify: `scripts/releaseWorkflowContract.test.js`

**Interfaces:** none.

The 2026-10-19 release run resolved `macos-latest` to image `macos-26-arm64` and `windows-latest` to
`windows-2025-vs2026`.

- [ ] **Step 1: Confirm the labels**

Check the `runs-on` label names for exactly those images in the `actions/runner-images` README. The
expected labels are `macos-26` and `windows-2025-vs2026`. If the README names a different label for
the same image, use that one.

- [ ] **Step 2: Write the failing contract test**

In `releaseWorkflowContract.test.js`:

```js
it("builds stable releases on pinned hosted images", () => {
  expect(releaseWorkflow).not.toMatch(/runs-on:\s*(macos|windows)-latest/);
  expect(releaseWorkflow).toContain("runs-on: macos-26");
  expect(releaseWorkflow).toContain("runs-on: windows-2025-vs2026");
});
```

Run: `npx vitest run scripts/releaseWorkflowContract.test.js`
Expected: FAIL.

- [ ] **Step 3: Replace the two labels in `release.yml`, rerun the test, and expect PASS**

Leave the other workflows unchanged (the spec makes them optional). Say so in the commit body.

- [ ] **Step 4: Commit**

```bash
git commit -am "fix(release): pin the hosted macOS and Windows build images"
```

---

## Phase 2a — the workflow, before the home session

### Task 4: Dispatch-only capture acceptance workflow, evidence verifier and trigger guard

**Files:**

- Create: `scripts/verify-capture-evidence.mjs`
- Create: `scripts/verify-capture-evidence.test.mjs`
- Create: `.github/workflows/capture-acceptance.yml`
- Create: `scripts/selfHostedWorkflowContract.test.js`

**Interfaces:**

- Produces: `findCaptureEvidence({ root, sha, platform }): { path: string, evidence: object }`. It
  scans `<root>/artifacts/capture-smoke/<sha.slice(0, 8)>/*/result.json` and keeps the files whose
  `sourceSha === sha`, whose `platform.os === platform` and whose `domain === "capture"`. It returns
  the newest by `endedAt`. If none qualifies it throws `Error("No capture evidence for <platform> at
<sha>")`. If the newest has `summary !== "complete"` it throws `Error("Capture evidence for
<platform> at <sha> is <summary>")`.
- CLI: `node scripts/verify-capture-evidence.mjs --sha <40-hex> --platform <windows|macos|linux>`.
  It prints the evidence path on success and exits 1 with the message on failure.
- Produces: `selfHostedWorkflowContract.test.js` exports nothing. It reads every
  `.github/workflows/*.yml` as text.

- [ ] **Step 1: Write the verifier tests**

Build the fixtures in a temp directory.

```js
it("selects the exact SHA and platform among older runs", ...);        // two runs, other SHA + other platform present → returns the matching one
it("fails when only another platform's evidence exists", ...);         // throws /No capture evidence for linux/
it("fails when the newest exact run is incomplete", ...);              // summary "incomplete" → throws /is incomplete/
it("prefers the newest exact run by endedAt", ...);
```

- [ ] **Step 2: Run them and see them fail. Implement `findCaptureEvidence` and the CLI. Rerun and expect PASS.**

Run: `npx vitest run scripts/verify-capture-evidence.test.mjs`

- [ ] **Step 3: Write the trigger guard test**

Rule: for every workflow file, if it contains `self-hosted`, or contains
`uses: ./.github/workflows/<f>` where `<f>` contains `self-hosted`, then every top-level key under
its `on:` block must be one of `workflow_dispatch`, `workflow_call` or `schedule`. Parse the `on:`
block by indentation: the keys indented one level under a top-level `on:` line. Handle the
`on: [a, b]` and `on: a` one-line forms. Also assert that no job that runs on a self-hosted runner
contains `secrets:` or `${{ secrets.`.

```js
it("keeps every self-hosted job away from untrusted triggers", ...);
it("hands no secrets to self-hosted jobs", ...);
it("rejects a pull_request trigger beside a self-hosted job", ...);   // feed the parser an inline YAML string; expect a violation
it("rejects a workflow that calls a self-hosted workflow from pull_request", ...);
```

The last two run the guard's internal function on inline fixtures, so the guard is proven able to
fail. Export that function as a named helper from the test module itself, or put it in
`scripts/self-hosted-workflow-guard.mjs` if you want a non-test module; that is your choice.

- [ ] **Step 4: Run the guard and expect PASS (no workflow uses self-hosted yet)**

Run: `npx vitest run scripts/selfHostedWorkflowContract.test.js`

- [ ] **Step 5: Write `.github/workflows/capture-acceptance.yml`**

- `on: workflow_dispatch` with a required input `commit_sha` (string). No other trigger yet.
- `permissions: contents: read`. `concurrency: { group: capture-acceptance-${{ inputs.commit_sha }}, cancel-in-progress: false }`.
- One matrix job with `fail-fast: false`. Include entries
  `{ platform: windows, labels: [self-hosted, plvs-rig, windows] }`,
  `{ platform: macos, labels: [self-hosted, plvs-rig, macos] }`,
  `{ platform: linux, labels: [self-hosted, plvs-rig, linux] }`, and
  `runs-on: ${{ matrix.labels }}`. Set `timeout-minutes: 90`.
- Steps:
  1. Validate that `commit_sha` matches `^[0-9a-f]{40}$`.
  2. `actions/checkout@v7` with `ref: ${{ inputs.commit_sha }}` and
     `persist-credentials: false`.
  3. `npm ci`.
  4. `npm run ffmpeg:fetch`.
  5. The harness build: the exact `BUILD_HARNESS` command string from `scripts/capture-rig.mjs`.
  6. `npm run smoke:capture -- --wait`.
  7. `node scripts/verify-capture-evidence.mjs --sha ${{ inputs.commit_sha }} --platform ${{ matrix.platform }}`.
  8. `actions/upload-artifact` with name `capture-evidence-${{ matrix.platform }}` and only the
     verified `result.json` (capture the path from step 7 via `$GITHUB_OUTPUT`).
     Use `if: always()` only on a separate step that uploads the smoke log, never on the verify step.
- No `secrets` anywhere.

Rerun the guard test. Expected: PASS. Add one assertion that `capture-acceptance.yml` contains all
three platform entries and `--wait`.

- [ ] **Step 6: Verify and commit, then push**

Run: `npm run format:check && npm run lint && npm test`, then `npm run check:changes`.

```bash
git add scripts/verify-capture-evidence.mjs scripts/verify-capture-evidence.test.mjs scripts/selfHostedWorkflowContract.test.js .github/workflows/capture-acceptance.yml
git commit -m "feat(release): add dispatch-only capture acceptance on home runners"
git push origin main
```

The workflow must be on `main` before the home session, because GitHub only offers dispatch for
workflows on the default branch. With no runner registered, nothing runs.

---

## Phase 0 — the home session (with the maintainer, at home)

### Task 5: Install runners and measure

Manual, guided by the agent. No product code. Output: a record at
`docs/history/notes/2026-10-xx-home-runner-measurements.md`, using the actual date.

- [ ] **Step 1: Check the repository setting.** Settings → Actions → General → "Approval for running
      fork pull request workflows from contributors" is at least "Require approval for first-time
      contributors". Record the value.
- [ ] **Step 2: Ubuntu.** Register a repository runner with labels `plvs-rig,linux`. First try a
      dedicated non-admin user, running as a `systemd --user` service with `loginctl enable-linger`.
      Confirm `pactl info` works in that user's session. If it does not, fall back to the maintainer's
      account. Dispatch `capture-acceptance.yml` for the current `main` SHA, limited to Linux by letting
      the other two jobs queue, then cancel them. Record the account, the launch mode and the
      result.
- [ ] **Step 3: Home Windows PC.** Labels `plvs-rig,windows`. Answer "no" to running as a service.
      Start the runner from a logon task in the maintainer's own session, unless a dedicated user with
      its own logged-in session reaches VB-Cable. Prerequisites: VB-Cable and VLC. Dispatch and record.
- [ ] **Step 4: Mac.** Labels `plvs-rig,macos`, installed as a LaunchAgent (`./svc.sh install` in
      the user session). Prerequisites: BlackHole 2ch and VLC. Settings: no system sleep while the
      display is off. Dispatch once unlocked, then once locked. Record both results.
- [ ] **Step 5: Lease check.** On any one machine, start `npm run smoke:capture` by hand in the
      maintainer's clone, then dispatch. The job log must show "Waiting for the capture rig" and then
      pass.
- [ ] **Step 6: Write the record and commit**

```bash
git commit -m "docs(release): record home runner measurements"
```

If the Mac fails while locked, stop and bring the trade-off to the maintainer before Task 7. If any
machine cannot reach its rig as a runner at all, stop and bring it back to the spec.

---

## Phase 2b — the gate and the docs

### Task 6: Wire capture acceptance into release.yml

**Files:**

- Modify: `.github/workflows/capture-acceptance.yml` (add `workflow_call` with the same `commit_sha` input)
- Modify: `.github/workflows/release.yml` (new job, `prepare-draft.needs`)
- Modify: `scripts/releaseWorkflowContract.test.js`

**Interfaces:**

- Consumes: `capture-acceptance.yml` from Task 4.

- [ ] **Step 1: Write failing contract tests**

```js
it("requires three-platform capture acceptance before the draft", () => {
  expect(releaseWorkflow).toMatch(
    /capture-acceptance:\s*\n\s*needs: validate\s*\n\s*uses: \.\/\.github\/workflows\/capture-acceptance\.yml/
  );
  expect(releaseWorkflow).toMatch(
    /prepare-draft:\s*\n\s*needs: \[build-windows, build-macos, build-linux, capture-acceptance\]/
  );
});
it("never lets capture acceptance be skipped", () => {
  const job = releaseWorkflow.split("capture-acceptance:")[1].split(/\n  \S/)[0];
  expect(job).not.toMatch(/continue-on-error|^\s*if:/m);
});
```

Run: `npx vitest run scripts/releaseWorkflowContract.test.js`. Expected: FAIL.

- [ ] **Step 2: Implement**

In `release.yml`, add the `capture-acceptance` job with `needs: validate`,
`uses: ./.github/workflows/capture-acceptance.yml` and
`with: { commit_sha: ${{ inputs.commit_sha }} }`. It has no `secrets:` key. Add it to
`prepare-draft.needs`. In `capture-acceptance.yml`, add `workflow_call` with an input
`commit_sha` of type string, required.

- [ ] **Step 3: Run the release contract and self-hosted guard tests, and expect PASS**

Run: `npx vitest run scripts/releaseWorkflowContract.test.js scripts/selfHostedWorkflowContract.test.js`

- [ ] **Step 4: Verify, commit, push and dispatch a standalone run**

Run: `npm test && npm run check:changes`.

```bash
git commit -am "feat(release): require three-platform capture acceptance before the draft"
git push origin main
gh workflow run capture-acceptance.yml -f commit_sha=$(git rev-parse HEAD)
```

Expected: all three jobs succeed and upload `capture-evidence-<platform>`.

### Task 7: Documentation and release skill

**Files:**

- Modify: `CONTRIBUTING.md` (new section "Home capture runners", placed before "## CI")
- Modify: `.agents/skills/plvs-release/SKILL.md` (Step 6 table, Step 8 "Smoke Gates" table, an interim manual step)
- Modify: `AGENTS.md` ("Testing")
- Modify: `docs/pitfalls.md` (runner traps from Task 5)

- [ ] **Step 1: CONTRIBUTING "Home capture runners"**

Cover spec §7, using the measured facts from Task 5's record, not guesses:

- per OS: account, launch mode, labels, rig prerequisites;
- the Mac sleep and lock settings;
- manual dispatch for checking a runner;
- disk use;
- the offline-machine behaviour: a queued job eventually fails and is never skipped;
- the public-repository rule and the fork-approval setting.

- [ ] **Step 2: plvs-release skill**

- Step 6 check list: local capture smoke stays conditional.
- Step 8 "Smoke Gates" table: add a row "`capture-acceptance` | home Windows PC, Mac, Ubuntu |
  `smoke:capture` for the exact SHA; blocks the draft".
- Before Step 7's dispatch, add the interim manual step: "Open the stable-candidate app on the Mac
  and on Ubuntu, open Settings once, close it. Remove this step once agent-control smoke runs on
  those runners."
- Note that the home PC, Mac and Ubuntu must be on and logged in.

- [ ] **Step 3: AGENTS.md "Testing"**

Add one sentence after the `release:preflight` paragraph: releases also run `smoke:capture` on all
three platforms through home self-hosted runners (`capture-acceptance.yml`, see `CONTRIBUTING.md`);
a runner that is off makes the release wait and then fail.

- [ ] **Step 4: pitfalls**

Add each trap Task 5 hit, in the style of the existing entries.

- [ ] **Step 5: Verify and commit**

Run: `npm test`. `scripts/documentationStructure.test.js` must stay green; if it rejects a
spelling, follow its message. Then `npm run check:changes`.

```bash
git commit -am "docs(release): document home capture runners and the release gate"
git push origin main
```

---

## Follow-ups recorded, not planned here

- A Linux producer for packaged update acceptance (version-notice path), then add `linux` to
  `PLATFORMS` in `scripts/report-update-acceptance.mjs`.
- `smoke:agent-control` on the Ubuntu runner, then on the Mac; this removes the interim manual step.
- Scheduled `soak:capture` on all three runners.
- Packaged update acceptance on runners. It has guided UI checkpoints, so it is not unattended
  today.
- Bad-release runbook and signing-secrets inventory in `CONTRIBUTING.md`.
