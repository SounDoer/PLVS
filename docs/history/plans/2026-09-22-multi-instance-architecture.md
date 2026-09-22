# Multi-Instance Architecture Implementation Plan

**Date:** 2026-09-22

**Status:** Proposed

**Design:** `docs/history/specs/2026-09-22-multi-instance-architecture-design.md`

## Objective

Implement supported multi-instance PLVS operation using one process per metering workbench, a shared
transactional Library, per-workspace persistence and an elected coordinator. Preserve today's
single-instance behavior and do not advertise support until concurrent desktop capture and lifecycle
acceptance pass.

This is a staged program, not one large switch. Each phase must leave a working single-instance
application and should land with its tests before the next phase depends on it.

## Delivery principles

- Tests use injected temporary identity roots; they never read or write installed Development,
  Preview or Release data.
- New storage is introduced behind repository interfaces before old plugin-store paths are removed.
- The migration reads `plvs-settings.json` once and creates a backup; there is no long-lived dual
  write.
- Shared Library writes use SQLite transactions and expected revisions from their first production
  use.
- A workspace has one process writer. High-frequency meter state is never placed in shared storage.
- Coordinator loss must not stop an existing capture.
- Every user-visible phase updates the matching `docs/user/` content in the same implementation
  change. Generated Agent Control documents are updated through their generator only.
- Changes to the capture layer require real capture smoke and a reminder to run the four-hour soak.

## Phase 0 — Test seams and observability

### Task 0.1: Add identity-root and process-launch test seams

- [ ] Introduce a test-only/integration-only application data root override in the Rust startup path.
- [ ] Reject the override in packaged Release builds.
- [ ] Add helpers that launch two and four real PLVS backend processes with distinct temporary roots.
- [ ] Record PID plus process-start identity so tests can detect PID reuse.
- [ ] Prove Development, Preview, Release and temporary-test namespaces generate distinct endpoint,
      lock and data paths.

Likely areas: `src-tauri/src/lib.rs`, `src-tauri/src/profile.rs`, new Rust integration-test support,
identity configuration and packaging tests.

### Task 0.2: Add multi-instance diagnostic context

- [ ] Generate `instanceId` at process start and carry it through structured logs and crash context.
- [ ] Add an internal `workspaceId`, initially fixed to `default` with no UI change.
- [ ] Include both IDs in native/frontend diagnostic snapshots without exposing a profile manager.
- [ ] Add tests that the IDs have the specified lifetimes.

Gate: one ordinary development launch behaves exactly as before, and tests can safely run multiple
isolated processes.

## Phase 1 — Persistence foundations

### Task 1.1: Define storage-domain repositories

- [ ] Replace callers' dependency on one generic settings blob with explicit interfaces for shared
      Library, global preferences, workspace state and runtime state.
- [ ] Keep conversion and validation at domain boundaries; do not expose raw SQLite rows to React.
- [ ] Add contract tests that classify every existing key and fail if an unclassified persistent key
      is introduced.

Likely areas: `src/persistence/index.js`, domain persistence modules, frontend hydration hooks and
new IPC wrappers under the existing boundaries.

### Task 1.2: Implement the shared SQLite repository

- [ ] Select and document the Rust SQLite/migration crate.
- [ ] Create schema migrations for items, ordering, item/collection revisions, global preferences,
      restore set and migration journal.
- [ ] Enable WAL, foreign keys and a bounded busy timeout.
- [ ] Implement transactional list/read/create/update/delete/reorder/import operations.
- [ ] Require expected item and collection revisions and return typed busy/conflict errors.
- [ ] Test two and four real writer processes, forced termination and recovery.

Likely areas: new `src-tauri/src/persistence/` modules, `src-tauri/Cargo.toml`, Tauri command
registration in `src-tauri/src/lib.rs`, `src/ipc/` and persistence contract tests.

### Task 1.3: Implement single-writer workspace storage

- [ ] Define the versioned workspace state schema.
- [ ] Persist Source, Workspace, active Preset/dirty state, Loudness Profile, Theme, window and Dock
      state under `workspaceId`.
- [ ] Implement temporary-file, flush and atomic-replace writes with an acknowledged flush command.
- [ ] Add workspace lease acquisition and refusal before state hydration.
- [ ] Test crash recovery and two workspaces writing at the same time.

Gate: new repositories pass stress tests, but production users still run from the legacy store.

## Phase 2 — Legacy migration and single-instance cutover

### Task 2.1: Build an idempotent legacy migrator

- [ ] Snapshot and validate the entire existing `plvs-settings.json`.
- [ ] Create a recoverable timestamped backup beside identity-local migration metadata.
- [ ] Preserve all Library IDs, order, active selections, Source, bounds, Dock and shortcut values.
- [ ] Create the `default` workspace and a one-entry restore set transactionally.
- [ ] Write the committed migration marker last.
- [ ] Inject failures at each step and prove retry leaves either the old or new store authoritative,
      never a mixed state.

### Task 2.2: Cut frontend hydration and saves to the new domains

- [ ] Hydrate shared Library, global preferences and `default` workspace through their new
      repositories.
- [ ] Replace plugin-store writes for migrated domains.
- [ ] Keep business mutations flowing through the owning React functions and safety guards.
- [ ] Remove the shared-store external-subscription no-op from migrated Library domains.
- [ ] Leave the old settings file read-only after migration; do not add dual write.

### Task 2.3: Verify single-instance compatibility

- [ ] Run persistence, workspace, Preset, Theme, Loudness Profile, window and Dock test suites.
- [ ] Test current Pack V1 and configuration import/export fixtures.
- [ ] Restart the real Tauri app to validate persistence; do not use Vite reload as evidence.
- [ ] Update recovery and downgrade documentation.

Gate: a normal user sees no new controls, naming or setup and retains the same saved state.

## Phase 3 — Coordinator and process lifecycle

### Task 3.1: Implement election, descriptor and authenticated control channel

- [ ] Acquire one identity-scoped coordinator lock with generation fencing.
- [ ] Atomically publish the coordinator descriptor and private authentication material.
- [ ] Implement orderly handoff and crash election.
- [ ] Ensure an existing capture continues through coordinator loss.
- [ ] Test stale descriptors, PID reuse, simultaneous startup and coordinator crash storms.

Likely areas: `src-tauri/src/profile.rs`, startup modules, new coordinator/transport modules and
platform-specific current-user pipe/socket code.

### Task 3.2: Implement the live instance registry

- [ ] Publish per-instance descriptors and authenticated endpoints.
- [ ] Track heartbeat, process-start identity, Source label, focus, visibility and capture status.
- [ ] Remove stale entries and release their coordinator leases.
- [ ] Assign Source-derived duplicate suffixes.
- [ ] Broadcast versioned registry and Library invalidation events.

### Task 3.3: Implement launch, workspace allocation and restoration

- [ ] Distinguish ordinary, internal restore and incoming file/URL launches.
- [ ] Make a second ordinary launch allocate a workspace that starts Stopped and unselected.
- [ ] Protect internal restore with a short-lived coordinator nonce.
- [ ] Restore the ordered set after ordinary app launch and prevent duplicate workspace ownership.
- [ ] Implement `Quit Instance` removal/recovery retention and `Quit PLVS` flush barriers.
- [ ] Add integration tests for two/four launches, crash, individual Quit and full restoration.

Gate: several blank/test workbenches can start, quit and restore without yet claiming full native
resource coordination.

## Phase 4 — Shared Library behavior

### Task 4.1: Connect all Library editors and imports to revisioned commits

- [ ] Carry base item and collection revisions through Preset, Theme and Loudness Profile editors.
- [ ] Preserve existing blocking-editor rules before any mutation.
- [ ] Map conflicts to Reload and Save as Copy; do not add Force Overwrite.
- [ ] Commit imports atomically with existing collision/fresh-ID behavior.
- [ ] Test same-item conflicts, independent items, reorder conflicts and import races.

### Task 4.2: Refresh peers without changing active runtime state

- [ ] Subscribe each frontend owner to versioned invalidation events.
- [ ] Reread committed records and ignore duplicate/older revisions.
- [ ] Keep active Theme/Profile/Preset runtime snapshots unchanged until explicit apply or restore.
- [ ] Keep open drafts and display stale-base state rather than replacing draft contents.
- [ ] Add tests covering imports and edits while peer instances are Running, hidden and editing.

Gate: a Library import appears everywhere without applying itself or destroying a draft.

## Phase 5 — Instance identity in the product surface

### Task 5.1: Derive and publish Source names

- [ ] Map App Source, device and Automatic output selections to useful display labels.
- [ ] Retain the last useful label while a Source is disconnected.
- [ ] Publish label changes to the registry and apply coordinator duplicate suffixes.
- [ ] Add deterministic tests for same-name Sources and peer removal.

### Task 5.2: Update only disambiguating UI surfaces

- [ ] Set native titles to `PLVS — <Source>` and verify operating-system switchers.
- [ ] Use Source names in target pickers, confirmations and CLI listing.
- [ ] Do not add a name control, profile manager or permanent instance header to the workspace.
- [ ] Add accessibility coverage for every chooser and status.

Gate: single-instance workspace layout remains visually unchanged.

## Phase 6 — Native singleton resources

### Task 6.1: Replace per-process Trays with one coordinator Tray

- [ ] Build menu snapshots from the registry.
- [ ] Route Show, Start, Stop and Quit Instance to explicit targets.
- [ ] Add one `Quit PLVS` command using the coordinated barrier.
- [ ] Rebuild after coordinator handoff without leaving duplicate Tray icons.

### Task 6.2: Centralize the global shortcut and Open at Login

- [ ] Move operating-system shortcut registration to the coordinator.
- [ ] Route Global Clear to focused or last-active surviving instance.
- [ ] Remove the current inter-PLVS shortcut conflict notification.
- [ ] Keep genuine conflicts with another application as one global error.
- [ ] Make Open at Login one coordinator-owned identity setting that restores the set.
- [ ] Test process launch order, focus changes, hidden windows, crashes and handoff.

Likely areas: global shortcut hook/native commands, Tray construction, autostart integration,
frontend preference ownership and coordinator routing.

### Task 6.3: Add Dock reservation leases

- [ ] Define a stable monitor-and-edge reservation key.
- [ ] Acquire the coordinator lease before native work-area mutation.
- [ ] Refuse a second claimant without altering the holder.
- [ ] Release on disable, monitor/edge change, Quit and stale cleanup.
- [ ] Restore a visible non-reserving Dock state when a saved lease cannot be reacquired.
- [ ] Cover physical-pixel bounds, webview scale, mixed DPI and Accessibility Text Size.

Gate: two PLVS processes expose exactly one Tray and shortcut registration, and Dock conflicts are
deterministic.

## Phase 7 — Agent Control and CLI

### Task 7.1: Version the Agent Control instance contract

- [ ] Add instance-list schemas, registry revision, candidate summary and
      `instanceSelectionRequired` error.
- [ ] Give each instance a unique current-user pipe/socket endpoint.
- [ ] Make the identity-wide descriptor point to the coordinator compatibility broker.
- [ ] Keep per-instance mutation revision checks and existing safety/business-function routing.
- [ ] Update capability declaration, mappings, generators and contract tests together.

### Task 7.2: Add CLI discovery and selection

- [ ] Implement `instance list --json` and `--instance <id>`.
- [ ] Support `PLVS_INSTANCE_ID` for one automation process.
- [ ] Preserve selector-free behavior with exactly one target.
- [ ] Return candidates and never guess with several targets.
- [ ] Test old CLI/new app and new CLI/old app compatibility.
- [ ] Update `docs/user/cli.md` and `docs/agent-control/README.md`; regenerate generated docs.

Gate: automation can enumerate and deterministically control every live workbench.

## Phase 8 — Global operations and inbound routing

### Task 8.1: Coordinate updater lifecycle

- [ ] Ensure only the coordinator checks and installs.
- [ ] Implement prepare, blocking-editor check, stop, flush, abort and close phases.
- [ ] Persist the restore set before installation and restore it afterward.
- [ ] Verify Preview remains updater-free and Development cannot use the Release feed.
- [ ] Test participant timeout, crash during barrier and failed installation recovery.

### Task 8.2: Make crash handling instance-aware

- [ ] Use unique per-instance log and pending-record names.
- [ ] Include instance/workspace correlation without leaking endpoint secrets.
- [ ] Release coordinator leases after a crash and retain recoverable workspace state.
- [ ] Prove one crash does not request shutdown of peers.

### Task 8.3: Coordinate configuration import/export

- [ ] Keep the current versioned export shape for one selected workbench plus shared Library.
- [ ] Quiesce peers for a full import that replaces shared data.
- [ ] Require an explicit target workbench for instance-owned imported fields.
- [ ] Normalize dangling selections in peer workspaces and relaunch as one transaction boundary.
- [ ] Test failure and cancellation without partial replacement.

### Task 8.4: Add the inbound target router when associations ship

- [ ] Route file and `plvs://` requests through the coordinator.
- [ ] Commit Library-only imports without a workbench picker.
- [ ] Use the only target when one exists and show a Source-named picker when several exist.
- [ ] Validate requests before starting or selecting a process.
- [ ] Test zero, one and many running instances in every application identity.

Gate: identity-wide actions affect exactly the intended scope and survive interruption.

## Phase 9 — Desktop qualification and release gate

### Task 9.1: Add multi-process automated stress coverage

- [ ] Run long concurrent Library and workspace write loops with deterministic audit logs.
- [ ] Kill processes at database commit, file replace, election and handoff boundaries.
- [ ] Assert no committed revision disappears and every recovered file/database validates.
- [ ] Add Windows named-pipe and macOS Unix-socket collision and permission tests.
- [ ] Add a CI job where supported; keep hardware capture outside normal CI.

### Task 9.2: Execute real Windows and macOS acceptance

- [ ] Test two and four instances with different and identical App Sources.
- [ ] Test physical input, Automatic output, source restart, default change and hot plug.
- [ ] Test multimonitor mixed-DPI bounds and reserved/overlay Docks.
- [ ] Test Tray, shortcut, Open at Login, sleep/wake, RDP where applicable and sign-out.
- [ ] Test individual crash/Quit/restart and coordinated update restoration.
- [ ] Test zero/one/many incoming routing if associations are in the release.
- [ ] Record CPU, memory and practical instance-count guidance.

### Task 9.3: Run capture smoke and soak

- [ ] Extend `npm run smoke:capture` or add a dedicated multi-instance smoke harness for concurrent
      engines without weakening the existing release gate.
- [ ] Run the Windows and macOS concurrent-capture smoke rigs.
- [ ] Run a four-hour multi-instance soak.
- [ ] Compare drift and resource behavior with the distribution recomputed from
      `artifacts/soak/`, not only the 0.01 dB script limit.

### Task 9.4: Finish product and release documentation

- [ ] Update the relevant `docs/user/` chapters, `docs/architecture.md` and `docs/prd.md` only when
      the product promise is ready to ship.
- [ ] Record durable “why” decisions in ADRs; do not link living docs to history records.
- [ ] Run `npm run check` and all Agent Control generation/contract checks.
- [ ] Do not advertise multi-instance support until every acceptance item in the design is complete.

## Suggested change sequence

Keep changes reviewable and reversible in roughly this order:

1. test seams and identifiers;
2. storage repositories and stress harness;
3. legacy migration and one-instance cutover;
4. coordinator election and registry;
5. launch/restore and per-workspace state;
6. Library conflicts and notifications;
7. Source naming and product surfaces;
8. Tray, shortcut, autostart and Dock leases;
9. Agent Control and CLI compatibility;
10. updater, crash, configuration import and inbound routing;
11. desktop qualification and documentation.

Do not combine storage migration, process orchestration and native resource ownership in one pull
request. Each boundary needs failure-injection tests before another subsystem relies on it.

## Rollback and recovery

- Before migration ships, rollback is ordinary code rollback because the legacy store remains
  authoritative.
- After migration, the application can disable creation of additional instances while continuing
  to run the `default` workspace from the new stores.
- The migration backup supports an explicit recovery/export tool; the application must not silently
  copy new multi-instance state back into the old blob.
- A failed coordinator feature flag must not bypass SQLite revisions or allow several processes to
  resume writing `plvs-settings.json`.
- Release notes must warn that downgrading across the storage migration loses changes made only in
  the new format unless the user exports first.

## Definition of done

The implementation is complete only when the acceptance gate in the design is satisfied. In
particular, a UI that can open two windows is not completion: transactional persistence, explicit
CLI targeting, deterministic native-resource ownership, identity isolation, coordinator recovery
and real concurrent-capture qualification are all required.
