# Three-platform capture acceptance on home runners — design

Date: 2026-10-20
Status: draft for review

## Intent

PLVS now ships Windows, macOS and Linux as equal, first-class platforms, all three released on the
same day. Until now, real audio capture was verified before a release only on whichever machine ran
`npm run release:preflight`, which in practice is the maintainer's company Windows PC. CI and
`release.yml` build and package-test all three platforms, but no runner has a sound card, so the
capture layer on macOS and Linux reached users with no verification at all.

The maintainer's machines are split by a network boundary. The company PC (daily development) and a
company laptop cannot reach the home machines. At home there is a Windows PC, a Mac (used in the
evenings, auto-locks) and an Ubuntu box in a rack (always on, reached over RDP from the Mac, where
Linux features are currently being developed). The company PC can push to and use GitHub freely.

This design closes the gap without inbound access to the home network. The three home machines run
GitHub Actions self-hosted runners. The runners connect outward to GitHub and pick up jobs, so a
release dispatched from the company PC runs real capture smoke on all three platforms before
anything is published.

## Goals

1. A stable release cannot publish unless `smoke:capture` passed on Windows, macOS and Linux for
   the exact release commit.
2. Setup is automated end to end: dispatching `release.yml` is the only action needed; no manual
   evidence copying between machines.
3. The same capture acceptance can be dispatched on its own, without a release, to check a commit or
   a newly set-up runner.
4. Linux is a base platform in acceptance evidence, equal to Windows and macOS.
5. A runner and the maintainer's own work on the same home machine never drive the capture rig at
   the same time.

## Non-goals

- `smoke:agent-control` on macOS and Linux. It stays in local preflight (Windows only) for now; see
  "Later phases". Its absence is an accepted, temporary risk: an app that installs but shows a blank
  window, or a CLI that cannot connect, on macOS or Linux would pass every automated check. Until it
  is automated, the release skill gains a manual step (below).
- Testing the published package bytes on home machines. The runners build the capture harness from
  source; package integrity, signing and notarization stay covered by the existing package smoke
  jobs in `release.yml`. Home evidence means "this source captures correctly on this platform", not
  "this installer was tested on real hardware".
- A manual approval step before publication. The maintainer decided that a release which passes the
  `plvs-release` skill and `release.yml` publishes without a reviewer on the `release` environment.
- Scheduled soak, multichannel or device-switching checks (later phases).
- Replacing local `release:preflight` capture smoke. It still runs on the preflight machine when
  capture dependencies changed, because it fails earlier and costs nothing extra.

## Anti-goals

These would make the work a failure even if releases still went out:

- **Any path by which a fork or a pull request runs code on a home machine.** The repository is
  public. A self-hosted job reachable from `pull_request`, `pull_request_target`, `issue_comment`
  or any event an outsider can trigger hands a stranger a shell at home.
- **Secrets or the key material in runner logs.** Public repositories have public logs. The capture
  jobs need no secrets and must be given none.
- **A gate that can be waved through.** Like capture smoke today, there is no bypass input. A
  runner that is offline means the release waits or fails; it never means "skip that platform".
- **Two runs on one rig.** The 2026-10-15 soak read +6.02 dB because two processes played the test
  tone at once. A runner must not be able to repeat that alongside a manual run.
- **Evidence that cannot be traced to the commit.** Every accepted result names the exact SHA and
  platform it came from.

## Constraints

- Repository is public (`SounDoer/PLVS`).
- Home machines are personal and in use. A runner job may appear on the Mac while the maintainer is
  using it; they accepted this. Test audio goes to BlackHole, VB-Cable or a private null sink and is
  not audible.
- The capture rig needs a real audio session: VB-Cable on Windows, BlackHole 2ch plus VLC on macOS,
  a PulseAudio or `pipewire-pulse` null sink on Linux (`scripts/capture-rig.mjs`). This normally
  means the runner process must live in the logged-in user's session, not a system service.
- The Mac auto-locks. Whether `smoke:capture` passes while the screen is locked is unknown and must
  be measured (Phase 0).
- `smoke:capture` evidence requires a clean worktree (`resolveEvidenceSourceSha` in
  `scripts/acceptance-evidence.mjs`) and writes
  `artifacts/capture-smoke/<sha8>/<runId>/result.json` with `sourceSha`, `platform` and `summary`.
- ADR 0028 placed the rig lease in the Git common directory. ADRs are never edited, so moving it
  needs a new ADR that supersedes that part of 0028.
- `holderIsAlive` in `scripts/rig-lease.mjs` checks process start time only on Windows (its comment
  says the rig is Windows-only, which is no longer true).
- A self-hosted job waits in the queue until a matching runner is online. GitHub fails it after a
  long queue time (about a day); the workflow cannot shorten that queue wait itself.
- Workflow and documentation rules in `AGENTS.md` apply: no edits to `docs/history/` records after
  the fact, user-visible changes update `docs/user/`, contract tests rather than sentence tests.

## Design

### 1. Machine-wide rig lease (prerequisite)

The lease moves from the Git common directory to one location per machine, so every clone,
worktree and OS user on that machine sees the same lease. A runner works in its own clone, which
today would hold a separate lease and could run alongside the maintainer's manual smoke.

- One well-known directory per platform, writable by every local user who may run the rig.
  Candidates: `%ProgramData%\PLVS` on Windows, `/Users/Shared/PLVS` on macOS, a shared directory such
  as `/var/tmp/plvs` on Linux. The builder picks and justifies the exact paths, and handles creation
  and permissions.
- Liveness checks work for a holder owned by another OS user. `process.kill(pid, 0)` returning
  `EPERM` already counts as alive; the Windows start-time query may fail for another user's process
  and must not misjudge a live holder as dead.
- The PID-reuse protection that is Windows-only today extends to macOS and Linux, where the rig now
  also runs.
- New ADR, superseding the lease location in ADR 0028 and keeping the rest of 0028 in force. It
  answers "why not leave it per repository": a runner clone is a second repository on the same
  machine and the same rig.
- `docs/pitfalls.md` and the AGENTS.md "Capture rig" pitfall are updated to say the lease is per
  machine.

### 2. Capture acceptance workflow

A new workflow, for example `.github/workflows/capture-acceptance.yml`:

- Triggers: `workflow_call` (from `release.yml`) and `workflow_dispatch` with a `commit_sha` input.
  No other triggers.
- One job per platform, as a matrix or three jobs, each with `runs-on: [self-hosted, <OS label>]`.
  Builder's choice of exact labels; they must not match GitHub-hosted runners.
- Each job:
  1. checks out the exact `commit_sha` with `persist-credentials: false`;
  2. installs dependencies and fetches FFmpeg sidecars as `smoke:capture` needs on that platform;
  3. builds the capture harness (`BUILD_HARNESS` in `scripts/capture-rig.mjs`);
  4. runs `npm run smoke:capture` with `--wait` semantics on the lease, so a manual run in progress
     delays the job rather than failing it, bounded by the job timeout;
  5. verifies its own `result.json`: `sourceSha` equals `commit_sha`, `platform` is the job's
     platform, `summary` is `complete`;
  6. uploads `result.json` (and nothing secret) as an artifact named by platform.
- Workflow permissions: `contents: read` only. No `secrets:` are passed, not even inherited.
- The same command runs on all three platforms. On Linux this assumes `smoke:capture` drives the
  null-sink route through `capture-rig.mjs`; the separate `smoke:capture:linux` script writes no
  acceptance evidence. The builder confirms which one is correct in Phase 0 and documents the
  choice.

### 3. Release integration

- `release.yml` gains a `capture-acceptance` job that calls the workflow above with the release SHA.
  It `needs: validate` and runs in parallel with the three package builds.
- `prepare-draft` gains `capture-acceptance` in its `needs`. No draft, and therefore no
  publication, exists unless all three platforms passed.
- In `release.yml`, capture acceptance runs on every release, unconditionally. Local preflight keeps
  its "only if capture dependencies changed" rule. (Builder's call, recorded here: in CI the
  maintainer does nothing extra, and the unconditional rule also catches OS or driver drift on the
  home machines between releases.)
- No bypass input is added.

### 4. Public-repository safety

- A contract test (next to `scripts/releaseWorkflowContract.test.js`) fails if any workflow that a
  self-hosted job lives in, directly or through `workflow_call`, can be triggered by anything other
  than `workflow_dispatch`, `workflow_call` or `schedule`. In particular, any `pull_request*`,
  `issue_comment`, `push` from forks, or `repository_dispatch` trigger alongside a self-hosted job
  fails the test.
- The repository setting that requires approval before running workflows from outside
  contributors stays at its default or stricter; the runner setup guide tells the maintainer to
  check it.
- Runner identity: a dedicated, non-administrator OS account is preferred. On macOS and Windows,
  audio and session requirements may make this impossible, because the rig needs the logged-in
  session. Phase 0 measures this per machine. Where a dedicated account cannot reach the rig, the
  runner runs as the maintainer's own account. That is an accepted risk which rests on the
  trigger restriction above, and the setup guide states it plainly.
- No environment approval gate on the capture jobs. The maintainer prefers no manual clicks in the
  release path, and the trigger restriction already limits who can start these jobs to accounts
  with write access, which is only the maintainer.

### 5. Linux as a base acceptance platform

- `ACCEPTANCE_BASE_PLATFORMS` in `scripts/acceptance-evidence.mjs` includes `linux`.
- The builder audits every consumer of that list, notably `scripts/report-update-acceptance.mjs`
  and the update, Dock and agent-control domains. Expected consequence: when update dependencies
  change, a release will require complete Linux update evidence (on Linux, the version-notice path,
  because Linux never installs updates; see `docs/architecture.md`). Scenarios that do not apply on
  Linux, such as Dock, are marked `unsupported` rather than left `missing`.

### 6. Pinned hosted runner images

`release.yml` replaces `macos-latest` and `windows-latest` with explicit image names: whatever those
labels resolve to on the day the change lands, so nothing changes now. Image upgrades then become
deliberate commits. The same treatment for other workflows is optional; the builder decides and
says which ones.

### 7. Runner setup guide

A durable section in `CONTRIBUTING.md` (or a document it links), written for a maintainer who has
never set up a runner. Per platform:

- registering the runner on the repository with the correct labels;
- running it inside the logged-in session: a LaunchAgent on macOS, a logon task rather than a
  Windows service on Windows, a user service with lingering or the desktop session on Ubuntu,
  whichever Phase 0 shows works;
- rig prerequisites on that machine (VB-Cable / BlackHole / `pactl` + `paplay`, VLC);
- macOS sleep: the machine must not sleep or log out. Display sleep and screen lock stay on if
  Phase 0 shows capture smoke passes while locked; otherwise the guide documents the measured
  requirement and leaves the security trade-off to the maintainer;
- how to dispatch `capture-acceptance.yml` by hand to check a runner;
- disk use: each runner keeps its own Rust target directory (several GB);
- what happens when a machine is off: the release job waits in the queue, then fails.

### 8. Documentation and release skill updates

- `.agents/skills/plvs-release/SKILL.md`: Step 8 lists the capture acceptance gate, and an interim
  manual step before dispatch: open the app on the Mac and on Ubuntu and open Settings once, until
  agent-control smoke is automated on those platforms.
- `AGENTS.md`, "Testing": state that releases verify capture on all three platforms through home
  runners, and keep the soak reminder.
- `docs/pitfalls.md`: runner traps found in Phase 0.
- `docs/user/` is unaffected; no user-visible behaviour changes.

## Delivery order

- **Phase 0 — measurement on real machines (throwaway, with the maintainer at home).** Install a
  runner on each home machine and dispatch a minimal workflow that runs `smoke:capture` for `main`.
  Record for each machine: which account and launch mode reaches the rig, and, on the Mac, whether
  it passes while locked. These results decide the open points in §2, §4 and §7. No gate is wired
  in this phase. GitHub only offers `workflow_dispatch` for workflows on the default branch, so this
  minimal workflow lands on `main` and must already obey the trigger restriction in §4.
- **Phase 1 — prerequisites in the repository:** machine-wide lease and its ADR (§1), Linux as a
  base platform (§5), pinned images (§6).
- **Phase 2 — the gate:** capture acceptance workflow, release integration and the safety contract
  test (§2–§4), then documentation (§7–§8). Verified by a standalone dispatch on all three runners,
  and by the first real release.

## Later phases (recorded, not in scope)

- `smoke:agent-control` on home runners: Ubuntu first, because its RDP session is unlocked, then the
  Mac once screen-lock behaviour is understood. This removes the interim manual step.
- Scheduled 4-hour `soak:capture` on all three home machines (for example weekly, via `schedule`,
  which only runs code from `main`), compared with each platform's own baseline spread in
  `artifacts/soak/`.

Out of scope here but agreed separately: a bad-release runbook and a signing-secrets inventory in
`CONTRIBUTING.md`.

## Left to the builder

- Exact lease paths, permissions and the cross-user liveness implementation.
- Runner labels, job layout (matrix or separate jobs), timeouts, and whether the runner workspace
  keeps build caches between runs, provided evidence still sees a clean worktree.
- Whether `smoke:capture` or `smoke:capture:linux` is the Linux entry point (Phase 0).
- How the contract test parses workflows, as long as it covers `workflow_call` chains.
- The exact pinned image names.

## Decisions recorded

Made by the maintainer in conversation on 2026-10-20: one trunk, no platform branches; Linux equal
tier; same-day releases; self-hosted runners on the home PC, Mac and Ubuntu; capture smoke only in
this phase; no reviewer on the `release` environment; accepting runner jobs on the Mac in use.

Made by the author of this design, open to the maintainer's veto: unconditional capture acceptance
in `release.yml`; no environment approval on capture jobs; falling back to the maintainer's own OS
account where a dedicated runner account cannot reach the rig; keeping local preflight capture
smoke; supersede rather than edit ADR 0028.
