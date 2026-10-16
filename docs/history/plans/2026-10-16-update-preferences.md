# Update preferences implementation plan

Date: 2026-10-16
Status: Windows packaged success and installer-exit failure paths verified; remaining acceptance below
Design: [Update Preferences and Deferred Installation](../specs/2026-10-16-update-preferences-design.md)
Worktree: `.codex/worktrees/update-preferences`
Branch: `codex/update-preferences`
Starting point: `74f6f0df` (update spec committed; Dock spec and plans are pending documents)

## Current acceptance status

This summary supersedes earlier execution checkpoints below. Windows signed, isolated offline
upgrades, two-workbench restoration, Dock startup/skip/reopen, and 125%/200% display-scale checks
have passed. A signed installer returning exit code 42 also restored the old app/settings and
suppressed automatic retry; current installed UI screenshots were captured from `aee74d40`.
Those results do not certify macOS, independent Windows text-size scaling, long-session
clocks, or recovery after partial replacement/forced interruption. Earlier unchecked items combine
multiple scenarios; do not treat the whole item as either unimplemented or fully accepted.

The later design review keeps update preferences at the bottom of Settings without a heading,
followed by Ask To Send Crash Reports. First-launch setup uses the shared dialog with content-based
width, standard typography, and compact text. Details fit their content and display the frozen
target version separately from release notes. Dock control-area design review remains open.


## Delivery order and shared ownership

Implement in this order: U1 feasibility, U2 preferences, U3 durable staging, U4 shared controller and
details, U5 confirmed installation, U6 integration/validation. Dock work can establish its baseline
and layout independently, but must consume U4's controller and U5's guarded actions rather than
implementing another updater. Complete the Dock details surface before considering Dock startup
offers finished. Neither plan authorizes publishing a release.

Final behavior is automatic download followed by an explicit installation offer on a later launch.
No unattended installation on launch, countdown, or automatic downgrade is included.

## U1. Prove the platform seams before building the feature

- [x] Read persistence, coordinator, Dock geometry, and Agent Control contracts. Prepare this
      worktree with locked dependencies (`npm ci`) and verified sidecars (`npm run ffmpeg:fetch`).
- [x] Inspect the pinned updater 2.13.2 Rust API and build a bounded probe for installing verified
      cached bytes without a live network check. The Update object includes private fields: do not
      assume it can be deserialized or reconstructed from saved JavaScript metadata.
- [x] Select and record the smallest supported adapter: public updater APIs where possible; a
      narrowly scoped native adapter or maintained dependency change only if required. Do not fake a
      remote update response or bypass signature verification to manufacture an Update object.
- [x] Prove Windows installer destination, relaunch arguments, and handoff behavior in an isolated
      test installation. Specify how exclusive installation survives the old app's exit and how a
      launch during installation waits or defers safely. A process-local lock is insufficient.
- [ ] Prove macOS cached archive replacement/relaunch, read-only bundle handling, authorization
      cancellation, and failure recovery on a Mac. Record unavailable platform testing honestly.
- [x] Define installed/Portable detection using current executable location plus installation
      evidence, including side-by-side copies and unknown classification. Examine release workflow
      staging and installer registry hooks; preserve generated sections.
- [x] Record adapter decisions and evidence in a dated investigation note; write an ADR if the
      selected approach has a durable non-obvious constraint. Do not expose auto-download before
      offline installation, verification, and the startup gate have a viable design.

Primary files: `src-tauri/src/lib.rs`, `coordinator/{mod,registry,commands}.rs`,
`src-tauri/nsis/installer-hooks.nsh`, `.github/workflows/release.yml`, pinned updater sources.

## U2. Persist preferences and gate all automatic requests

- [x] Add normalized identity-wide checking/downloading/setup-choice fields through
      `src/settings/{defaults.js,SettingsContext.jsx}` and the settings persistence domain.
- [x] In `src-tauri/src/persistence/{bootstrap,migration,hydration}.rs` and frontend hydration,
      distinguish preexisting user data from fresh initialization before defaults erase that distinction.
      Existing users get checking on/downloading off; fresh users make no request before a choice.
- [x] Add first-launch choices and Settings toggles through `SettingsPanel.jsx` and the existing
      overlay composition. Skip records both off. A first launch restored into Dock must still have
      an accessible choice surface; coordinate its window hosting with the Dock work.
- [x] Separate manual checking from scheduled checking in `useUpdateCheck.js`; manual remains
      available with checking off. Clear timers on disable and prevent duplicate coordinator checks.
- [x] Make toggle changes cancel in-flight background jobs and invalidate their completion tokens.
      Disabling checking also disables downloading; re-enabling checking does not restore downloading.
- [x] Expose appropriate availability for Portable and Preview without writing a global preference
      off merely because the current copy cannot install. Treat browser/test behavior explicitly.
- [x] Review reset/import/export behavior so importing configuration cannot accidentally count as
      first-run consent or silently enable new downloads. Document the chosen settings-domain policy.
- [x] Synchronize Agent Control settings schema/read/patch/capabilities and contract tests if these
      settings are exposed, or explicitly classify them as unavailable/internal under existing rules.
      Never add CLI installation as an incidental extension of this feature.

Validate fresh/existing migration, skip, cross-window synchronization, dependency normalization,
manual checks while disabled, and real persistence after a full process restart. Do not validate
durability through a Vite reload.

## U3. Implement native staging and cancellation

- [x] Introduce a focused Rust updater service/module (final module name chosen in U1), with
      commands for capability/state inspection, download, cancellation, and confirmed installation.
- [x] Store partial files, verified ready packages, and atomic metadata under application-managed
      storage. Bind state to identity, installation, architecture, and version; never trust a caller's
      arbitrary path or executable arguments as an installation target.
- [x] Verify signatures on download and immediately before installation using the trusted key.
      Bind displayed metadata/version to the verified package; assess the plugin's signed-version
      support against existing artifacts rather than assuming latest.json itself is signed.
- [x] Keep one ready candidate while downloading its replacement, atomically replace it after
      verification, clean obsolete data, and discard incomplete/corrupt state after interruption.
- [x] Enforce one owner per installation, bounded retry/backoff, and cancellation generations that
      prevent late results from recreating canceled offers. Serialize cleanup with installation entry.
- [x] Retain enough data for offline details and installation; cached resource IDs are not durable.

Use isolated temporary directories and injected download/install boundaries for tests covering
tampering, wrong target/version, partial writes, low-space/write failures, cancellation races,
candidate replacement, and stale state. No test should invoke the user's installed stable updater.

## U4. Share controller state and details content

- [x] Refactor `useUpdateCheck.js`, `useApplyUpdate.js`, and update composition into one authoritative
      controller with serializable view state and guarded actions. Define available/downloading/ready/
      failed/installing states and manual versus automatic request reasons.
- [x] Refactor `UpdateDialog.jsx` only as needed to share details content between its normal-window
      host and Dock accessory host. Keep changelog rendering and action selection in one implementation.
- [x] Preserve the frozen version/target behavior in `AppSettingsOverlays.jsx`; checks completing
      while details are open cannot change what confirmation installs.
- [x] Add ready state, explicit Update and Restart, and startup Skip This Time. Dismissal consumes
      the offer for this process session without deleting the package. No countdown or automatic accept.
- [x] Publish view data to Dock through its bridge; retain native handles in the owner. Provide an
      explicit availability response for secondary instances rather than creating a second updater.
- [x] Manual downloads and ready-package installs share the same controller; background completion
      never opens details in an already working session.

Test state transitions, stale actions, duplicate clicks, target freezing, and skip/dismiss behavior.
Coordinate the serializable state/action contract with D3 in the Dock plan.

## U5. Integrate startup offers and confirmed installation

- [x] Detect eligible launches before normal workspace activity can race installation, using the
      registry and native startup gate. Do not call prepareGlobalOperation merely to discover peers:
      it stops capture. Existing peers mean defer the automatic offer.
- [x] Load preferences and reconcile package/attempt state before deciding to offer; never install
      before confirmation. Offer through the correct normal or Dock details host.
- [x] Recheck peers and target state under the installation gate when the user confirms. A peer
      launched while the offer was open must cause safe deferral, not automatic interruption.
- [x] Preserve explicit in-session update safeguards: blocking editors refuse before mutation,
      persistence flush succeeds before handoff, and workspace restoration remains intact.
- [x] Persist attempt state before Windows handoff; use U1's mechanism across process exit. On
      relaunch reconcile actual running version, clear successful pending state, and avoid retry loops.
- [ ] Integrate macOS replacement/relaunch and system authorization; cancel/failure returns a useful
      state without repeated prompts. Do not claim guaranteed rollback from partial filesystem damage.
- [x] Route every Portable update entry to the ZIP path and never to NSIS. Leave Preview disabled.

## U6. Documentation, integration checks, and completion

- [x] Update `docs/user/{getting-started,system-settings}.md`, durable architecture details, and
      relevant CLI documentation in the same commits that introduce behavior.
- [x] Review `website/privacy/index.html` and `docs/privacy-review.json` for background downloads,
      local retention, cancellation, recipients, and effective-date decision. Do not just regenerate
      a fingerprint. Update documentation contract checks for code-owned facts where needed.
- [ ] Validate new-user, existing-user, disabled, manual-only, staged-offline, corrupted-cache,
      changed-version, multi-instance, blocked-editor, and failed-install paths.
- [ ] Perform real Windows and macOS package upgrades, including nondefault install locations,
      offline installation, authorization cancellation, repeated launches, and side-by-side Portable.
      Use isolated fixtures and test signing keys; do not alter the user's stable installation.
- [ ] Capture the new settings/setup/details states and verify UI using Agent Control. Include Dock
      launch offers after D3 lands. Record evidence and remaining platform limitations in this plan.
- [x] Before each implementation commit: `npm test`, frontend format/lint/typecheck when touched,
      and `npm run rust:check` for Rust. Run relevant native tests for new non-audio modules. Before
      push/merge use `npm run check:changes`; this mixed feature requires the full gate.

Completion requires U1's feasibility evidence, all applicable acceptance cases, both window forms,
and passing required checks. A passing unit suite alone does not prove native upgrade recovery.

## Proposed controller contract

These names are implementation targets, not a new public API. Finalize them during U1/U4 before
connecting either window host. Keep the controller outside React presentation components.

| Data         | Required meaning                                                                             |
| ------------ | -------------------------------------------------------------------------------------------- |
| capabilities | Can check, download, and install; distribution kind and a reason for unavailable actions.    |
| preferences  | Automatic checking, automatic downloading, and resolved first-launch choice.                 |
| checkState   | Idle/checking/error and last result; independent of whether a ready package exists.          |
| candidate    | Latest discovered version, release notes, and approved external release/download link.       |
| pending      | Verified staged version and opaque package ID, or absent.                                    |
| transfer     | Candidate ID, operation generation, phase, bytes received, optional total, and retry state.  |
| attempt      | Attempt ID, target package, prepared/handed-off/reconciled outcome and recovery information. |
| revision     | Monotonic controller revision for rejecting actions based on stale presentation.             |

Do not encode all these dimensions in one enum: a ready package can coexist with a check or a
replacement download. A failed replacement download must not falsely report that the ready package
is unavailable. Native service state is authoritative for files/attempts; React settings retain
their established persistence ownership. Document the synchronization direction for each field.

Actions carry an operation ID and, where relevant, expected revision and opaque target ID:

- `check(reason)` distinguishes manual requests from automatic scheduling.
- `setPreferences(patch)` validates the dependency and synchronizes cancellation atomically from
  the user's perspective. It does not pretend that already-transmitted requests can be recalled.
- `download(candidateId, reason)` stages a chosen candidate; unknown/stale IDs fail safely.
- `openDetails(targetId, origin)` pins display data; origin distinguishes startup from manual entry.
- `dismissDetails(offerId)` consumes a startup offer only for that application session.
- `confirmInstall(targetId, expectedRevision, origin)` revalidates eligibility and guards, then
  invokes the single native installer path. Accessory windows never submit a filesystem path.

Automatic preference cancellation affects automatic work. Define explicit manually initiated
work separately so turning off automatic checking does not unexpectedly abort a manual update the
user has just confirmed. Once installation enters its irreversible phase, cancellation is refused
with current state rather than silently accepted.

## Transition and race checklist

| Situation                                            | Expected outcome                                                           | Evidence                                                                               |
| ---------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Fresh user, setup still open                         | No scheduled network request                                               | Network adapter spy plus startup integration test                                      |
| Check disabled during an active request              | No follow-up auto-download or future timer; late result cannot revive work | Deferred promise and generation tests                                                  |
| Replacement download fails                           | Old verified ready package remains usable                                  | Native staging test                                                                    |
| Details shows A while B becomes ready                | Never install B from A's confirmation                                      | Controller test; retain A while pinned or explicitly require reopening if A is removed |
| Auto-download turned off while ready details is open | Revoke staged target, refresh allowed actions, reject stale confirmation   | Controller and accessory tests                                                         |
| Two instances confirm the same package               | One handoff at most                                                        | Native gate and isolated multi-process test                                            |
| A peer starts after the startup offer opens          | Confirmation safely defers; peer capture is untouched                      | Real two-instance scenario                                                             |
| Process dies after handing off installer             | Next launch reconciles version/attempt; no automatic loop                  | Isolated package harness                                                               |
| New version installed externally                     | Old staged state is discarded after version comparison                     | Restart integration test                                                               |
| Coordinator disappears during a download             | No duplicate writer or permanent busy state                                | Ownership-recovery test                                                                |

Pinning details must not force retention of an unlimited number of packages. Prefer deferring ready
package replacement while its confirmed target is pinned, or marking the dialog stale with an
explicit reopen action. Select one during U4 and cover it; do not silently switch target versions.

## Native probe exit criteria and fallback decisions

U1 produces a short decision record with these fields for each platform:

1. Exact pinned API used for offline cached installation, and any code the application must own.
2. Signature and version verification boundary, including legacy published artifact compatibility.
3. Installer destination and launch argument handling.
4. Lock ownership before handoff, during replacement, and after restart; how stale state is recovered.
5. Evidence from successful upgrade, rejected package, canceled/failed upgrade, and racing launch.

Do not infer installation success from elapsed time or delete an installation lock because a timeout
expired. Use verifiable process/attempt ownership and actual version reconciliation. A recovery path
must distinguish an abandoned attempt from an installer still operating.

If the stock plugin cannot support offline reconstruction, implement and test the narrow adapter
before connecting the UI. If the handoff cannot be made safe, record the exact unresolved mechanism
and continue independent preference/layout work; do not replace the approved behavior with forced
quit-time installation, an online-only next-launch flow, or silent installation without discussion.

## Suggested reviewable commits

Each row includes its tests and matching living documentation where behavior becomes visible.
Intermediate commits must keep existing manual updates working; do not expose unfinished controls.

| Order | Suggested subject                                                | Completion boundary                                                            |
| ----- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1     | `docs(updater): record cached install feasibility`               | U1 evidence and selected adapter design                                        |
| 2     | `feat(updater): add guarded native update staging`               | U3 cache/verification/cancellation and native tests, not yet advertised in UI  |
| 3     | `refactor(updater): share update state and details presentation` | U4 controller/content seam with existing behavior preserved                    |
| 4     | `feat(updater): add update preferences and first-launch choice`  | U2 plus fully wired background staging, migration, policy review, and guide    |
| 5     | `feat(updater): offer staged updates on application launch`      | U5 normal host and shared startup contract; Dock integration completed with D3 |
| 6     | `test(updater): verify staged installation and recovery`         | Real isolated package scenarios and final integration evidence                 |

This is review grouping, not a requirement to create placeholder commits. Move U2 persistence work
earlier if needed by native state initialization. Combine dependent UI/startup commits when necessary
to avoid shipping a state that cannot offer updates to users restoring Dock sessions.

## Verification commands and evidence record

During development run focused existing suites and new tests beside their source files. Examples:

```powershell
npx vitest run src/hooks/useUpdateCheck.test.js src/hooks/useApplyUpdate.test.js src/components/UpdateDialog.test.jsx src/components/AppSettingsOverlays.test.jsx
npx vitest run src/settings src/persistence src/agentControl/settingsControlContract.test.js
npm run format:check
npm run lint
npm run typecheck
npm test
npm run rust:check
```

Run `npm run docs:agent-control` only when schema changes require regeneration; review generated
diffs. Native package probes are an additional requirement, not replaced by `rust:check`.

Record platform/build SHAs, current/target version, distribution, install location, scenario,
expected/observed result, and artifact path. Keep generated logs/screenshots/packages under ignored
`artifacts/`; never place signing keys in tracked evidence. Use an isolated update test identity or
harness with production-equivalent installer behavior; Preview cannot serve as the updater test
vehicle because its updater is compiled out.

## Execution evidence — 2026-10-16

Implementation commits: `5b92a15a`, `7670212d`, and `1e3f9b41`, followed by the final
recovery/validation changes on this branch. Runtime ownership now lives in
`updateController.js` / `useUpdateController.js`; the old hook names above describe the
refactoring inputs, not a second active updater.

- U2–U5 are integrated: identity-wide preferences, first-launch blocking choice, native staging,
  frozen details, explicit startup acceptance, peer fencing before workspace preparation, and
  offline helper handoff. macOS code is integrated but its platform acceptance remains unchecked.
- Full process restart persistence was observed between dev instances `e8de4460…` and `9a372dfb…`.
  The shared SQLite row retained `choiceMade: true, autoCheck: false, autoDownload: false` after
  Skip; no Vite reload was used as durability evidence.
- `scripts/probe-cached-updater.mjs` successfully installed the signed 2.0.0 NSIS fixture offline
  into a nondefault directory containing spaces. It proved destination handling, waited exit,
  signature/tamper rejection, and waiting even when the spawn callback fails. The canonical
  Windows `\\?\` path case initially failed and passed after adapter normalization.
  Evidence: `artifacts/update-controls/installer-probe-1792153599749/result.log`.
- Native tests cover corrupt metadata, orphan cleanup, cancellation generations, independent-process
  startup exclusion, abandoned attempts, and one-use restoration argument removal. Controller tests
  cover revoked consent, no background modal, frozen/repeated targets, active-peer refusal before
  preparation, editor refusal, failed-target suppression, late activity, and partial-commit recovery.
- Setup/settings and normal/Dock details were captured through Agent Control under
  `artifacts/update-controls/`. Development fixtures cannot install and do not prove a native upgrade.
- The semver dependency was already in the runtime closure; making it direct adds no new native
  component or license. Inventory fingerprints and the reviewed Cargo manifest input were refreshed.

### Remaining acceptance boundaries

Do not interpret checked implementation items as release certification. The standalone NSIS probe
is not a complete packaged PLVS upgrade: the copied helper, real application replacement, coordinator
restoration, and installer failure must still be exercised together with an isolated signed app.
The follow-up copied-helper probe also passed: a dev-identity binary compiled with the isolated
public key acknowledged its ticket, waited for the commit nonce, installed the signed fixture with
an unreachable endpoint, persisted the installer PID/start identity and finished result, then
relaunched the isolated executable with its expected argument. Evidence is
`artifacts/update-controls/installer-probe-1792153599749/handoff-result.log`; the target is a
small relaunch-marker executable, not a packaged PLVS workspace. The first probe configuration
with an empty endpoint list was rejected by updater construction before installation; a valid
but unreachable endpoint proves the offline seam without bypassing config validation.
No production signing key or installed stable app was used. At that checkpoint, Windows end-to-end acceptance and
macOS bundle replacement, authorization cancellation, read-only installation, and native Dock checks
remain open. This task's executable environment is Windows; no Mac execution surface is available.
A release must keep those gates visible rather than infer success from unit tests.


Final local gates: `npm run check` passed (5,653 Vitest tests across 526 files; Rust library
779 passed, 3 intentionally ignored, plus workspace integration/CLI tests; format, lint,
typecheck, version, licenses, website, build and Clippy). The final regression run after
documentation/license-source updates is recorded in `artifacts/update-controls/final-regression.log`.
The new vendored updater exposed a hardcoded license source URL; the generator now derives each
local dependency's repository path instead of labeling all local crates as the VAD dependency.

Final follow-up regression: 5,655 Vitest tests passed across 527 files, including late-listener
cleanup and native-window fallback. Frontend format, lint and typecheck passed again.

### Packaged Windows follow-up

Real signed, isolated PLVS 0.21.0 → 0.21.1 NSIS upgrades now pass with the feed offline,
including a path containing spaces, two-workbench restoration, and a separate Dock startup/skip/
reopen/install run. Dock configuration and settings compare equal before and after the upgrade.
The installed stable app remained untouched. See
`../notes/2026-10-16-packaged-update-acceptance.md` for exact source identities, evidence, and
startup defects found during this acceptance. macOS acceptance and packaged installer-failure
injection remain outside this Windows success-path evidence.
