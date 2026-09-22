# Multi-Instance Architecture Audit

Date: 2026-09-22  
Status: Audit complete; first-release product direction approved; implementation not started

## Purpose

PLVS users may need several independent metering instances at the same time, each capturing a
different application or audio source. PLVS therefore cannot solve its current concurrency risks by
becoming a global single-instance application. Future community file associations and `plvs://`
requests must also be able to discover several running instances and let the user choose a target.

This audit records the current implementation facts, the risks that prevent PLVS from claiming
multi-instance support, the architecture alternatives, and a recommended direction. It does not
authorize implementation and does not freeze detailed schemas or UI designs.

The related community portability direction is recorded in
`docs/history/specs/2026-09-22-community-sharing-foundation-design.md`.

## Executive conclusion

Formal multi-instance support is feasible.

PLVS already has the most important foundation: each process owns its own Rust `AppState`, audio
engine, React tree and windows. The principal blocker is persistence, not capture. Two processes of
the same application identity load independent in-memory copies of the same
`plvs-settings.json`, and any save rewrites the complete file. There is no cross-process lock,
transaction, compare-and-swap revision or change notification. Lost updates are therefore expected,
including when the two instances change unrelated settings.

Agent Control, the global shortcut, Tray, Open at Login, Dock reservation and Updater also assume
one running instance or one owner per application identity.

The recommended model is:

> Multiple metering processes, each with an independent Workspace Profile, sharing transactional
> Preset, Theme and Loudness Profile libraries, with a small coordination plane for discovery and
> operating-system-wide resources.

An approachable analogy is:

- each running instance is an independent workbench;
- Presets, Themes and Loudness Profiles live on a shared bookshelf;
- a common front desk manages the instance list, Tray, global shortcuts, updates and incoming files.

## Audit baseline and verification

The audit was performed against `main` commit
`270dc7cbc7216fcba12486fa0945c0978ead1dd2`.

No PLVS GUI instance was started. No Development, Preview or Release user configuration was read or
modified. The audit used source inspection and existing automated tests.

The relevant test selection completed with 193 passing tests:

- 150 frontend tests covering persistence, Workspace, Presets, Themes, Loudness Profiles, capture
  preferences, Tray, shortcuts, autostart and close behavior;
- 10 Agent Control discovery tests;
- 9 Windows named-pipe transport tests;
- 6 Profile tests;
- 18 window-state tests.

These tests validate the current single-process contracts. There are no tests for two application
processes writing concurrently, multiple discoverable instances, multiple Docks, or coordination of
Updater, Tray and global shortcuts.

## Current behavior facts

### Process and audio ownership

The startup path contains no single-instance plugin, global mutex or second-launch forwarding.
Windows can start the executable more than once. macOS launch behavior may normally activate an
existing application, but a second process can still be forced and PLVS contains no guard against it.

Every process creates its own main WebView, Dock accessory WebViews, background workers and Rust
`AppState`. `AppState` intentionally holds one active `EngineSource`; that invariant is per process.
This makes the existing engine substantially closer to a multi-process design than to a single
process hosting several live metering Sessions.

Windows application capture uses WASAPI shared mode and has no repository-level cross-process
exclusive lock. The macOS capture implementation creates private process taps and gives aggregate
devices random UUIDs. Static inspection found no deliberate cross-process capture exclusion, but
the capture layer is not exercised in CI. Concurrent capture of the same and different sources must
therefore be verified on real Windows and macOS machines before support is claimed.

### Identity isolation

The three shipping contexts use distinct Tauri identifiers:

| Context     | Identifier                  |
| ----------- | --------------------------- |
| Release     | `com.soundoer.plvs`         |
| Development | `com.soundoer.plvs.dev`     |
| Preview     | `com.soundoer.plvs.preview` |

The identifier scopes application data and Agent Control discovery, so Development, Preview and
Release do not normally share configuration or endpoints. This does not isolate two instances of
the same identity.

Preview compiles the Updater plugin out. Development uses a separate application identity but still
compiles the Updater and inherits the stable update endpoint; this needs an explicit safety decision
before update behavior is tested in a multi-instance development build.

### Persistence

The frontend exposes four logical domains over one plugin-store backend:

- `plvs:settings`;
- `plvs:workspace`;
- `plvs:presets`;
- `plvs:themes`.

The same `plvs-settings.json` also contains Rust-owned sibling keys including window bounds, capture
device, Dock state, shortcut preferences and the Agent Control permission.

At boot, Rust loads those values and injects `window.__PLVS_INITIAL_STATE__`. The frontend backend
then keeps a synchronous in-memory cache and never rereads disk. Its subscription implementation is
a no-op because it was designed for a single main window and single writer.

The locked dependency is `tauri-plugin-store` 2.4.4. Each process holds its own in-memory `HashMap`.
Its save operation serializes the entire map and calls `fs::write` on the store path. Its mutex is
process-local; there is no cross-process lock, atomic replace or optimistic concurrency check.

Consequences:

1. A save in either process can overwrite every key written by the other process, even when the
   processes changed unrelated domains.
2. Read-modify-write operations on Library arrays or objects lose one writer's update.
3. Simultaneous whole-file writes may leave truncated or malformed JSON.
4. A running instance does not observe another process's successful write.
5. A headless configuration import can later be overwritten by an already-running GUI's stale
   cache.

Keeping `windowBounds` as a sibling key protects it from a stale nested settings object inside one
process. It does not protect it from another process saving its complete stale store map.

### Current ownership of important product state

The current persisted shapes mix Library content with active-instance selections:

- Workspace layout, panels, controls and axis viewports are in `plvs:workspace`.
- Dock strip layout is also in the Workspace domain.
- Preset documents, `activeId` and `dirty` are together in `plvs:presets`.
- Theme documents are in `plvs:themes`, while `appearance` and `themeId` are in settings.
- Loudness Profile documents and the active selection are together in
  `plvs:settings.loudnessProfiles`.
- Capture Device or App Source is a top-level `captureDeviceId` sibling.
- Window bounds and Dock monitor/form are top-level sibling state.
- Fullscreen, measurement history, editor drafts and hover state are already transient.

As a result, the current file shape cannot express two instances with independent Workspaces,
sources, active Presets, active Loudness Profiles, Themes, windows or Docks.

### Agent Control and `plvs-cli`

Agent Control currently provides one endpoint per application identity:

- the descriptor is always `agent-control.json`;
- the Windows pipe is derived only from the app identifier;
- the macOS socket name is derived only from the app identifier;
- the CLI reads that one descriptor and has no instance listing or selector.

Windows creates the first pipe with `FILE_FLAG_FIRST_PIPE_INSTANCE`. A second same-identity process
cannot bind it. macOS uses an identity-scoped non-blocking `flock`, with the same one-owner result.
The second PLVS process continues running, but its Agent Control start fails and the CLI cannot
discover or control it.

### Operating-system resources and lifecycle

The current multi-process behavior is not coordinated:

| Capability            | Current result                                                                                |
| --------------------- | --------------------------------------------------------------------------------------------- |
| Tray                  | Every process creates the same process-local Tray ID and may show an indistinguishable icon.  |
| Global Clear shortcut | Every process attempts to register the same accelerator; normally only one succeeds.          |
| Open at Login         | Every process reads and modifies the same application-level autostart entry.                  |
| Dock                  | Every process may restore the same monitor, edge and reserve-space state.                     |
| Window bounds         | Every process restores and writes the same bounds key.                                        |
| Updater               | Every Release process independently checks, downloads, installs and relaunches.               |
| Crash reports         | Processes share the identity's log and pending-report directories and global retention count. |
| Quit                  | Quit exits the calling process only.                                                          |
| Relaunch              | Profile and update relaunch affect the calling process only.                                  |

Windows AppBar state is process-local, so one instance cannot reason about another instance's Dock
reservation. Multiple overlay or always-on-top Docks can also occupy the same screen edge on either
platform.

## Reproducible conflict scenarios

### Disjoint-key lost update

1. Start A and B from the same store snapshot.
2. A changes its Workspace and saves.
3. B moves its window or changes Theme and saves.
4. B serializes its complete stale store map, replacing A's Workspace with the boot-time value.

The issue does not require both processes to edit the same domain.

### Library lost update

1. A and B both read Preset list `[P0]`.
2. A appends `PA`; B appends `PB`.
3. Each writes a complete `list` field.
4. The final list contains either `PA` or `PB`, not reliably both.

### Headless import rollback

1. Keep a GUI open.
2. Run a headless configuration import, which directly rewrites the disk store.
3. Change any persisted value in the running GUI.
4. The GUI saves its stale in-memory map and can undo the import.

### Resource conflicts

- two enabled Agent Control instances: only the first binds;
- two Global Clear owners: one registration fails or becomes platform-dependent;
- two reserved Docks on one monitor edge: no PLVS-level allocation policy;
- two update confirmations: no installation lock or all-instance shutdown protocol.

## Target ownership model

### Shared global Library and preferences

The following should be available to all instances:

- Preset documents;
- Theme documents;
- Loudness Profile documents;
- Library ordering and metadata;
- community import records;
- true user-wide defaults such as crash-report consent and default interface preferences.

Shared defaults and effective instance values should be separate concepts. A global default may seed
a new Workspace Profile without forcing all existing instances to change.

### Durable Workspace Profile state

The following should belong to one Workspace Profile:

- Workspace layout and panel controls;
- selected Capture Device or App Source;
- active Preset and dirty relationship;
- active Loudness Profile;
- current Theme and appearance mode;
- window bounds and monitor;
- Dock edge, monitor, height, reserve mode and strip layout;
- Always On Top, Focus View, panel opacity and Glass;
- other effective scene or measurement choices.

Theme, Preset and Loudness Profile selections are instance state; the corresponding documents are
shared Library state.

### Runtime-only state

The following should not be persisted as a Workspace Profile:

- running/stopped transport and current native engine handle;
- accumulated measurement and visual history;
- resolved application PIDs and inventory generation;
- frame acknowledgements and diagnostics;
- fullscreen, hover, notices and open sheets;
- unsaved editor drafts;
- current Agent Control revision and pending requests;
- visual recording operations.

### Coordinated or exclusive resources

One coordination owner should manage or arbitrate:

- the runtime instance registry;
- the compatibility Agent Control descriptor;
- the global shortcut registration;
- the top-level Tray experience;
- Open at Login;
- update installation;
- file associations and `plvs://` routing;
- conflicting Dock/AppBar reservations;
- shared Library schema migrations.

## Architecture alternatives

### A. Multiple processes, shared Library, separated instance state

This is the recommended architecture.

It preserves the existing one-process/one-engine/one-React-tree boundary. Capture failures and
crashes remain isolated. Shared Library storage must become transactional, and the application needs
instance discovery and a lightweight coordination plane.

Migration cost is medium to high, concentrated in persistence, discovery and operating-system
resource ownership. Audio and most Workspace rendering can remain structurally familiar.

### B. Multiple processes, fully independent Profiles

This is the quickest safe isolation model: every instance gets a separate data directory containing
both its Workspace and its libraries.

It is a poor default product model. Importing a community Theme into A would not make it available
in B; users would need to copy and merge libraries; file routing would have to decide which private
library receives every item. It is useful as an optional advanced isolation mode, but it does not
serve the shared community Library direction well.

### C. One process, multiple measurement Sessions and windows

This centralizes Tray, updates, shortcuts and storage, but conflicts with the current core design.

Rust would need `sessionId -> EngineState` instead of one `EngineSource`, with every IPC command,
frame stream, acknowledgement and analysis request routed by Session. React providers for Workspace,
Preset, Theme, Loudness Profile, Dock and runtime would need independent Session ownership. Agent
Control currently targets the main WebView, and Dock accessories and visual capture also assume one
primary surface.

The migration and regression risk are much higher than A, and one process crash would terminate all
measurements. It is not recommended for the first supported multi-instance architecture.

## Recommended architecture

Use two identities with different lifetimes:

- `workspaceProfileId`: stable and persisted; identifies a restorable workbench such as
  “Spotify Monitoring” or “VLC QC”.
- `instanceId`: generated for each run; identifies a PID, runtime endpoint, start time and current
  status.

A conceptual identity-scoped directory is:

```text
<identity-root>/
  shared/
    library.db
    global-preferences.json
  workspaces/
    <workspaceProfileId>/
      state.json
  runtime/
    <instanceId>.json
```

SQLite in WAL mode, or a store with equivalent transactions and compare-and-swap semantics, is a
reasonable shared Library foundation. The recommendation is about required semantics rather than a
mandatory database product.

Every mutable Library item should have at least an ID, revision and content hash. A save carries the
revision it was based on. If another process has already committed a newer revision, the save must
return a visible conflict rather than overwrite it.

After a Library transaction commits, the coordinator broadcasts a compact change event. Other
instances reread the affected item. An open local draft is never overwritten: it is marked stale and
the user can reload, save as a copy or explicitly resolve the conflict.

An instance using a Theme or Loudness Profile should remain bound to the revision it selected during
its current work. A Library edit in another process must not silently change an active measurement
rule set or appearance.

## Approved first-release product decisions

### Instance creation and naming

Workspace Profile is an internal persistence concept, not a first-release management UI. A single
instance remains completely transparent to the user. The first release has no user naming, explicit
profile creation, profile picker or profile-management page.

Launching PLVS again creates another metering window directly. A new secondary instance starts
Stopped with no selected Source and guides the user to choose one; it must not silently start a
second Automatic capture. Selecting a Source supplies the instance's display name. Examples are
`Spotify`, `VLC`, `System Output` and a device name. Simultaneous duplicate labels receive a
run-local suffix such as `Spotify (2)`.

The display name appears only where instances need to be distinguished:

- the native window title and operating-system window switcher, as `PLVS — Spotify`;
- the shared Tray's instance list, as `Spotify`;
- incoming-file or URL target selection;
- multi-instance confirmation dialogs;
- Agent Control instance discovery.

It does not require a new instance list in the main Workspace, repeated labels on panels, or a
Workspace Profile editor. A disconnected Source retains its last useful label and exposes the
disconnected state separately.

### Persistence and restoration

PLVS transparently remembers the instance set on a normal all-app exit and restores each instance's
Source, Workspace, window and Dock state on the next launch. An update restart restores the same
set. If the user explicitly quits one instance, that instance is removed from the set to restore.
An optional “Reopen Windows at Launch” preference may be added later; it is not required for the
first release.

Several instances may capture the same Source without a warning. This supports different layouts,
Loudness Profiles and analysis views for one program.

### Theme and shared Library behavior

Theme, Preset and Loudness Profile documents are shared Library items. The selected Theme,
appearance mode, active Preset and active Loudness Profile remain instance state. One instance may
therefore use Light and another Dark while both see the same custom Theme library.

An import commits to the shared Library and notifies all instances, but does not automatically apply
the item anywhere. “Add to Library without applying” is the safe default for community downloads
and file associations. Concurrent edits never silently overwrite one another; the first release may
resolve a conflict with Reload or Save as Copy and does not need a force-overwrite action.

### Tray, close and update behavior

PLVS exposes one shared Tray containing every instance, identified by its Source-derived name and
running state. Each instance entry can Show, Start or Stop, and Quit that instance. The Tray also
provides Quit PLVS, which exits all instances. Closing or minimizing a window affects that instance
only. A hidden instance that is still measuring must remain visibly marked Running in the Tray.

Update installation is coordinated once for the application identity, safely stops every instance,
and restores the previous instance set after relaunch.

### Global Clear shortcut

The current behavior, in which every process attempts to register the same accelerator and later
instances report a shortcut conflict, must be removed. The coordinator owns exactly one operating-
system registration for Global Clear and routes each activation to the most recently focused PLVS
instance. If no PLVS window is currently focused, it uses the last active instance.

The first release does not add a Global Clear All shortcut. An explicit Clear All Instances action
may be added later, but must not replace the safe single-target default.

### Dock coordination

Several instances may use Dock. Overlay Docks may coexist. For one monitor and one edge, only one
instance may reserve operating-system work area. A second request for the same reservation is
refused without changing the first instance; the user can choose another edge, another monitor or
overlay mode.

### Incoming file and URL routing

- with no running instance, start the default instance when an instance is required;
- with one instance, offer or use it where immediate application is requested;
- with several instances, display a Source-named target chooser;
- for Library-only import, let the coordinator commit without choosing a metering instance.

## Agent Control and CLI direction

Add instance discovery and selection, conceptually:

```text
plvs-cli instance list --json
plvs-cli inspect --instance <instance-id> --json
```

Compatibility behavior:

- zero instances retains the current unavailable result;
- one instance lets selector-free legacy commands keep working;
- several instances return `instanceSelectionRequired` with candidate summaries and never guess;
- an optional `PLVS_INSTANCE_ID` may give automation a stable selection mechanism for one run.

The existing identity-scoped `agent-control.json` can become a coordinator descriptor. New clients
use it to list and route to per-instance endpoints. An old CLI continues to work when exactly one
instance exists. A new CLI can treat an old application's single descriptor as one synthetic
instance.

Development, Preview and Release must retain distinct registry, descriptor, pipe/socket and URL
routing namespaces.

## Phased migration path

1. Add multi-process tests, runtime IDs and instrumentation without changing the user-visible model.
2. Split shared Library, global defaults and Workspace Profile state; stop writing instance state to
   one shared blob.
3. Move Preset, Theme and Loudness Profile libraries to transactional, revisioned storage.
4. Migrate existing users into one `default` Workspace Profile while preserving all existing IDs
   and selections.
5. Add the runtime instance registry, per-instance Agent Control endpoints and CLI selectors.
6. Move Tray, global shortcut, Open at Login, update installation and Dock reservation arbitration
   behind the coordinator.
7. Add file association and `plvs://` routing with Library-only import and target selection.
8. Ship as an experimental capability, complete desktop validation and soak, then declare support.

The migration should create a recoverable backup of the old `plvs-settings.json`. Long-term dual
writing is not recommended because it recreates the consistency problem. Existing Pack V1 imports
and configuration exports remain compatibility boundaries and should preserve their IDs and current
semantics unless a separate migration specification changes them.

## Verification matrix

### Automated

- two and four real child processes writing unrelated Workspace Profile state;
- concurrent imports of different Library items;
- concurrent saves of one item from the same base revision;
- forced termination at each transaction boundary;
- schema migration locking and recovery;
- instance registration, heartbeat, stale cleanup and PID reuse;
- zero, one and several CLI targets;
- old CLI with new app and new CLI with old app;
- Development, Preview and Release namespace isolation;
- coordinator crash and ownership handoff;
- external Library changes while a draft is open;
- single ownership of shortcut, Tray, autostart and update installation;
- Dock reservation conflict policy.

### Real desktop

- Windows 11 and macOS 14.2 or later;
- two and four instances;
- different App Sources, the same App Source, physical input and Automatic output combinations;
- source restart, default-output change and hot-plugged devices;
- several monitors, mixed DPI and Windows Accessibility Text Size;
- same-edge and different-monitor Docks, reserved and overlay modes;
- Tray selection, Global Clear and Open at Login;
- crashing, quitting and restarting one instance while others continue;
- coordinated update and restoration of the prior instance set;
- file association and `plvs://` routing with zero, one and several instances;
- RDP detach, sleep/wake and sign-out;
- four-hour capture soak with drift compared against the existing `artifacts/soak/` baseline
  distribution, not only the script threshold.

## Acceptance gate before claiming support

PLVS must not claim supported multi-instance operation until all of the following are true:

- concurrent stress tests produce no malformed store and lose no committed revision;
- every shared Library mutation is transactional and conflict-aware;
- Workspace, source, active selections, window and Dock are demonstrably instance-scoped;
- Library changes propagate without destroying local drafts or silently changing active revisions;
- CLI discovery and explicit selection work, and ambiguous requests never guess;
- Tray, Updater, Open at Login and global shortcuts have one deterministic owner;
- Dock reservation conflicts have a tested product policy;
- crash, quit and restart of one instance do not stop another instance's measurement;
- update installation safely quiesces and restores the instance set;
- all three application identities remain isolated;
- real Windows and macOS concurrent-capture smoke tests pass;
- multi-instance four-hour soak tests show no leak, metric drift or cross-instance control;
- `npm run check`, updated user documentation and the Agent Control contract all pass together.
