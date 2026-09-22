# Multi-Instance Architecture Design

**Date:** 2026-09-22

**Status:** Proposed

**Scope:** Desktop application, persistence, native lifecycle, Agent Control and CLI

## Summary

PLVS will support several concurrently running metering instances as separate operating-system
processes. Each process owns one audio engine and one workbench. The processes share a
transactional Preset, Theme and Loudness Profile Library, while source selection, active items,
Workspace, window and Dock state remain independent.

A lightweight coordinator role is elected from the running PLVS processes for each application
identity. It owns resources that the operating system permits PLVS to register only once, maintains
the live instance registry and routes requests. It is a role, not a separate always-running daemon:
if its process exits while peers remain, another process takes over.

The first release adds no profile manager, user naming or manual profile creation. A durable
`workspaceId` exists internally so that normal Quit, update restart and relaunch can restore the
previous workbenches. The name shown to the user is derived from the selected Source.

This design selects architecture A from the audit: multiple processes with a shared global Library
and separated instance state. It does not assume that concurrent capture is already safe; Windows
and macOS desktop validation remains a release gate.

## Context

The read-only audit is recorded in
`docs/history/notes/2026-09-22-multi-instance-architecture-audit.md`. Its relevant findings are:

- PLVS has no global single-instance guard. Starting it twice already creates two independent Rust
  audio engines and two frontend runtimes.
- Both processes currently read and write one `plvs-settings.json` through independent in-memory
  snapshots. The store saves an entire map and has no cross-process lock or compare-and-swap.
  Concurrent processes can therefore overwrite committed changes or produce a malformed file.
- Agent Control, the Tray, global shortcuts, the updater, Open at Login and Dock reservations are
  designed around one running instance or have no cross-process owner.
- The Windows named pipe and macOS Unix socket discovery names are identity-wide, so only one
  Agent Control service can currently bind them.
- Development, Preview and Release already have different application identifiers, but all new
  discovery and coordination names must preserve that boundary.

The existing process-per-engine shape is valuable isolation for a real-time audio application. The
design keeps it and removes the unsafe shared state.

## Goals

- Run several independently controllable PLVS metering instances at the same time.
- Preserve today's single-instance interaction when only one instance is open.
- Give every workbench independent source, Workspace, active items, window and Dock state.
- Share reusable Preset, Theme and Loudness Profile Library items safely.
- Eliminate lost updates, whole-blob overwrite and malformed shared persistence.
- Provide deterministic ownership for identity-wide operating-system resources.
- Discover, list and explicitly select live instances through Agent Control and `plvs-cli`.
- Restore the open instance set after normal application Quit and coordinated update restart.
- Migrate existing users without changing their current one-instance setup or Library IDs.
- Keep Development, Preview and Release data and discovery namespaces isolated.

## Non-goals for the first release

- User-defined instance names.
- A Workspace Profile manager or explicit Create Profile flow.
- Synchronization between computers or user accounts.
- Simultaneous collaborative editing of one Library item with automatic field-level merging.
- A Global Clear All shortcut.
- A permanent background daemon after the last PLVS process exits.
- Multiple measurement sessions hosted by one Rust audio engine or one frontend runtime.
- Promising unlimited instance counts. Resource limits will be documented from desktop testing.

## Product model

The model can be pictured as several workbenches, one shared bookshelf and one front desk:

- A **workbench** is one visible PLVS instance. It owns its Source, Workspace, active Preset,
  active Loudness Profile, active Theme, window and Dock.
- The **bookshelf** is the shared Library. A Preset, Theme or Loudness Profile imported by one
  instance becomes available to the others, but is not automatically applied to them.
- The **front desk** is the coordinator. It knows which workbenches are open and owns the Tray,
  global shortcut, update installation and other identity-wide resources.

Internally, a durable Workspace Profile means only “the saved state behind one workbench.” The term
does not appear as a first-release product object.

### Opening and naming instances

- The first ordinary launch opens or restores the default workbench.
- Launching PLVS again while it is running creates another workbench.
- A newly created additional workbench starts Stopped with no Source selected. It guides the user
  to choose a Source instead of silently capturing Automatic output again.
- The visible name is derived from the selected Source, such as `Spotify`, `VLC`, `System Output`
  or a device name. Runtime duplicates receive a suffix such as `Spotify (2)`.
- If a Source disconnects, the instance retains its last useful Source label and adds a disconnected
  status until the user selects another Source.

The Source-derived name appears only where disambiguation is needed:

- native window title and operating-system app switcher, for example `PLVS — Spotify`;
- the shared Tray menu;
- file and URL target pickers;
- multi-instance confirmation dialogs;
- Agent Control and CLI instance listings.

It does not add a permanent name field to the main workspace, panels or a profile manager.

### Quit and restoration

- `Quit Instance` closes one workbench and removes that workbench from the next restore set.
- `Quit PLVS` asks every instance to flush, records the open ordered set and closes them all.
- An update restart uses the same coordinated flush and restore set.
- Closing or minimizing a window affects only that instance. A hidden instance that is still
  measuring remains listed as Running in the Tray.
- The first release restores the prior instance set by default. A user-facing “Reopen Windows at
  Launch” preference may be added later without changing the storage model.

## State ownership

| State                                            | Ownership            | Persistence                                             | Writer                                                        |
| ------------------------------------------------ | -------------------- | ------------------------------------------------------- | ------------------------------------------------------------- |
| Preset documents and ordering                    | Shared Library       | Shared database                                         | Any instance through transactional repository                 |
| Theme documents and ordering                     | Shared Library       | Shared database                                         | Any instance through transactional repository                 |
| Loudness Profile documents and ordering          | Shared Library       | Shared database                                         | Any instance through transactional repository                 |
| Library item and collection revisions            | Shared Library       | Shared database                                         | Transactional repository                                      |
| Global shortcut accelerator and enabled state    | Global preference    | Shared database                                         | Coordinator-mediated                                          |
| Open at Login                                    | Global preference    | Shared database and OS                                  | Coordinator-mediated                                          |
| Crash reporting consent                          | Global preference    | Shared database                                         | Coordinator-mediated                                          |
| Updater state and install operation              | Coordinated resource | Runtime only, except existing updater metadata          | Coordinator only                                              |
| Source selection                                 | Workbench            | Workspace state file                                    | Owning instance                                               |
| Workspace layout and modules                     | Workbench            | Workspace state file                                    | Owning instance                                               |
| Active Preset and dirty state                    | Workbench            | Workspace state file                                    | Owning instance                                               |
| Active Loudness Profile                          | Workbench            | Workspace state file                                    | Owning instance                                               |
| Active Theme and appearance choice               | Workbench            | Workspace state file                                    | Owning instance                                               |
| Window bounds and display association            | Workbench            | Workspace state file                                    | Owning instance                                               |
| Dock layout and desired reservation              | Workbench            | Workspace state file                                    | Owning instance                                               |
| Capture engine, meters and analysis history      | Process session      | Not persisted                                           | Owning process                                                |
| Draft editors, dialogs and transient UI          | Process session      | Not persisted                                           | Owning frontend                                               |
| Focus, visibility and running/stopped status     | Process session      | Runtime registry                                        | Owning instance publishes; coordinator indexes                |
| Source-derived display name and duplicate suffix | Process session      | Recomputed; last useful label may be in workspace state | Coordinator and owning instance                               |
| Tray                                             | Coordinated resource | Not persisted                                           | Coordinator only                                              |
| OS global shortcut registration                  | Coordinated resource | Not persisted                                           | Coordinator only                                              |
| Dock work-area reservation per monitor and edge  | Coordinated resource | Lease only                                              | Coordinator arbitrates; owning instance applies native change |
| Agent Control discovery descriptor               | Coordinated resource | Runtime descriptor                                      | Coordinator only                                              |

An active Library selection stores the item ID in workspace state. It is not a second editable copy
of the Library document. If another instance updates that item, the Library view refreshes, but a
currently active runtime configuration is not silently replaced. The instance applies the new
revision only after an explicit selection/apply action or its next restoration. Open drafts remain
intact and show a conflict if their base revision is stale.

## Identifiers and application identities

Two identifiers have different lifetimes:

- `workspaceId` is a generated UUID that durably identifies one saved workbench. The migrated
  original workbench receives a well-known `default` ID. It is internal in the first release.
- `instanceId` is a random UUID generated for each process run. It identifies a live endpoint and
  must never be reused as persistent state identity.

One `workspaceId` may have at most one live lease. A restore attempt that finds a live owner focuses
that owner instead of opening a second writer.

Every lock, descriptor, pipe/socket, database and runtime directory is rooted in the current Tauri
application data identity. Release, Preview and Development therefore use distinct namespaces.
Tests additionally inject an isolated temporary identity root and never use an installed user's
application data.

## Persistence layout

The conceptual layout under the identity-specific application data directory is:

```text
shared/
  library.sqlite3
workspaces/
  default/state.json
  <workspace-id>/state.json
runtime/
  coordinator.json
  instances/<instance-id>.json
```

Exact platform paths remain the responsibility of Tauri path resolution. Runtime files are removed
or repaired on startup and are not backup material.

### Shared database

The shared database is SQLite in WAL mode with a bounded busy timeout. It contains at least:

- Library items keyed by `(kind, itemId)`, including a monotonically increasing item revision,
  schema version, canonical document JSON and content hash;
- ordering metadata and a collection revision per Library kind;
- identity-wide preferences with revisions;
- the ordered restore set and workspace registry;
- a schema migration journal.

All writes use transactions. Updating or deleting an existing item requires its expected revision.
Inserting, importing, deleting or reordering items also advances the relevant collection revision.
The operation returns the committed revision or a structured conflict. A busy database returns a
retryable error; it never falls back to an unguarded file write.

SQLite protects the durable transaction. The coordinator broadcasts the resulting change event to
live instances, but is not the sole database writer and is not required for correctness of item
compare-and-swap. Events contain IDs and revisions, not authoritative documents; receivers reread
the committed records.

When two instances edit one item from the same base revision, the first commit wins. The second
keeps its draft and offers:

- **Reload**, which discards the local draft only after explicit confirmation; or
- **Save as Copy**, which commits a fresh ID and preserves both versions.

The first release does not offer Force Overwrite. Independent imports of different IDs both commit.
An import whose content or ID collides follows the existing merge-only/fresh-ID rules within one
transaction.

### Workspace files

Each workspace directory is single-writer because of the live workspace lease. Its state file
contains the instance-owned domains listed above and a schema version. Writes use a temporary file,
flush and atomic replacement. Coalescing may remain for high-frequency UI changes, but normal Quit,
coordinated update and handoff require an acknowledged flush barrier.

The shared database never stores live meter values or high-frequency analysis data. This keeps
audio and rendering activity away from a contended shared write path.

Newly created secondary workspaces have a nullable Source. The migrated `default` workspace keeps
the existing Source/Automatic behavior so a single-instance user sees no unexpected setup screen.

### Removal and retention

`Quit Instance` removes the workspace from the restore set. For an additional unnamed workspace,
its state directory is moved to an internal recovery area and later expired rather than immediately
destroyed. This makes an interrupted Quit recoverable without exposing profile management. The
`default` workspace is never deleted. A future profile manager can define longer-term retention.

## Coordinator

### Election and handoff

The first process to acquire an identity-scoped coordinator lock becomes coordinator. It writes an
atomic descriptor containing its generation, endpoint and process identity. Other processes connect
and register themselves.

The coordinator is a role embedded in a normal PLVS process to avoid shipping and servicing a new
daemon. Before an orderly coordinator exit, it nominates a peer, releases ownership and waits for a
higher coordinator generation to be published. After a crash, peers use the lock and liveness checks
to elect a replacement. The winner reconstructs state from live per-instance registrations and
re-registers identity-wide resources.

An instance continues metering during a short coordinator outage. Shared Library writes may still
commit transactionally, but coordinator-owned actions report temporarily unavailable until election
completes. No process independently creates a second Tray or shortcut registration as a fallback.

### Instance registry

Each process publishes an atomic runtime descriptor with `instanceId`, `workspaceId`, PID/process
start identity, endpoint, Source label, capture status, visibility, focus sequence, capability
version and heartbeat. The coordinator verifies endpoint reachability and removes stale entries.
PID alone is never sufficient because operating systems reuse it.

The coordinator assigns duplicate Source suffixes using the current live set and publishes a
registry revision. Suffixes are session disambiguators and need not remain stable after peers close.

### Launch protocol

Ordinary launch has three paths:

1. With no coordinator, the process acquires leadership, opens the default workspace and restores
   additional workspaces by spawning the same executable with an authenticated internal restore
   request.
2. With a coordinator, an ordinary second launch requests a newly allocated `workspaceId`, starts
   Stopped with no Source and registers as a new instance.
3. File, URL and internal restore launches first contact the coordinator. They forward the request
   or claim the assigned workspace and must not accidentally create an extra blank workbench.

Internal launch arguments include a short-lived nonce issued through the private current-user
endpoint. Public command-line arguments alone cannot claim another workspace.

## Shared Library notifications

After a successful commit, the repository publishes a versioned Library-change message through the
coordinator. Every frontend persistence owner subscribes and rereads the affected records. The
current no-op external subscription in the plugin-store backend is removed for shared domains.

Importing a Theme, Loudness Profile or Preset therefore:

1. validates and commits the item to the shared Library;
2. refreshes Library lists in every live instance;
3. leaves every instance's active selections unchanged;
4. leaves open drafts unchanged and marks stale drafts when applicable.

The default community-sharing action is **Add to Library**. Applying to a workbench is a separate,
targeted action.

## Native resource policies

### Tray

The coordinator owns one Tray. It lists Source-derived instance names and status. Each submenu can
Show, Start, Stop or Quit that instance. `Quit PLVS` appears once at the bottom and runs the global
flush/quit protocol. Coordinator handoff rebuilds the menu from registry snapshots.

### Global shortcut

Only the coordinator registers Global Clear with the operating system. It tracks the currently
focused instance and the most recently active surviving instance. Activation is routed to that one
target. A stale target is resolved again before delivery. If no live target exists, the action is a
no-op.

This removes the current false conflict between PLVS processes. A registration error still appears
when another application owns the accelerator, but it is reported once as a global setting problem.

### Open at Login

Open at Login remains one identity-wide registration owned by the coordinator. Login starts an
ordinary PLVS launch, which restores the saved instance set. Individual workbenches do not create
autostart entries.

### Dock

Overlay Docks may coexist. A Dock that reserves operating-system work area must acquire a runtime
lease keyed by stable monitor identity and edge before applying native geometry. Only one live
instance may hold a key. A conflicting request is refused without moving or changing the current
holder; the user can select another edge, another monitor or overlay mode.

Leases are released on Dock disable, monitor change, instance exit and stale-instance cleanup.
Persisted Dock intent does not itself grant a lease. Restoration reacquires it and falls back to a
visible non-reserving state with an explanation if the lease is unavailable.

Window bounds remain physical pixels and keep the current display/DPI rules. They are stored under
`workspaceId`, so two workbenches do not overwrite each other's monitor and bounds.

### Updater

Only the coordinator checks and installs an update. Installation starts a barrier:

1. stop accepting new instance and Library mutations;
2. ask each instance to resolve or refuse for a blocking editor, stop capture and flush state;
3. persist the ordered restore set;
4. abort safely if any participant cannot acknowledge;
5. close all instances and install once;
6. launch normally and restore the set.

A per-instance Restart command is not an update operation and restarts only its workspace. Preview
retains its current no-updater policy; Development must not contact or install the Release feed.

### Crash reporting

Crash records include application identity, `instanceId` and `workspaceId`. Runtime log and pending
record names are unique per instance, while consent is global. A crashing instance does not request
peer shutdown. The coordinator removes its leases and may offer recovery of that workspace on the
next ordinary launch.

## Agent Control and CLI

The identity-wide discovery descriptor becomes a coordinator descriptor. The coordinator endpoint
supports instance listing and routes identity-wide operations. Every live instance exposes a
current-user authenticated endpoint whose Windows pipe or macOS socket name includes `instanceId`.
Endpoint files and authentication material keep the current private permissions.

The public model includes:

```text
plvs-cli instance list --json
plvs-cli inspect --instance <instance-id> --json
plvs-cli start --instance <instance-id> --expected-revision <revision>
```

The list response contains the live ID, Source-derived label, Source summary, capture state,
visibility, workspace ID for automation correlation, per-instance revision and capabilities. An
instance mutation uses that instance's revision. Registry/list mutations use a separate registry
revision.

Compatibility behavior is deterministic:

- zero instances returns the existing unavailable outcome;
- one instance lets selector-free existing commands continue to target it;
- several instances return `instanceSelectionRequired` with candidates and never guess;
- `PLVS_INSTANCE_ID` may provide a selector for one automation process;
- a new CLI treats an old application descriptor as one synthetic instance;
- an old CLI can use the compatibility broker only while exactly one new instance is live.

Development, Preview and Release use different descriptor names, coordinator locks, endpoint
prefixes and environment-variable namespaces.

## Files, URLs and configuration import

Incoming future association or `plvs://` requests go to the coordinator:

- no live instance: start the default instance when application is required;
- one live instance: use it or offer it according to the action;
- several live instances: show a Source-named target picker for an apply/open action;
- Library-only import: commit without choosing a metering target.

The picker includes Source, Running/Stopped state and window visibility. It never exposes unnamed
Workspace Profile management.

Existing configuration export remains a compatibility boundary. Export from an instance produces
the existing versioned shape using that workbench's effective state and the shared Library. A full
configuration import is application-wide because it replaces shared content: the coordinator
quiesces all instances, requires an explicit target workbench for instance-owned fields, commits the
shared replacement transactionally, normalizes dangling selections in other workspaces and performs
a coordinated relaunch. It must not partially replace the Library while peers continue writing.

## Migration from `plvs-settings.json`

Migration is identity-local and runs once under an exclusive schema lock:

1. close or reject older concurrently running binaries;
2. make a recoverable copy of the current `plvs-settings.json`;
3. read and validate all frontend domains and Rust sibling keys from one snapshot;
4. insert Presets, Themes and Loudness Profiles into the shared database while preserving IDs and
   ordering;
5. create the `default` workspace with the current Source, Workspace, active selections, Theme,
   window and Dock state;
6. write global preferences and a one-entry restore set;
7. commit the migration journal and then switch the application to the new repositories.

There is no long-term dual write. The old file and backup remain readable for recovery, but the new
application stops mutating them after the migration marker commits. A failed migration leaves the
old file authoritative and can be retried. Downgrading to a build that only understands the old
store does not preserve later multi-instance changes; release notes and recovery tooling must state
that boundary.

## Failure handling

- **Concurrent Library conflict:** retain the local draft; offer Reload or Save as Copy.
- **Database busy:** bounded retry for short contention, then a retryable user-facing error.
- **Coordinator crash:** continue capture, elect a successor and reconstruct resources.
- **Instance crash:** expire its registry and Dock leases without stopping peers.
- **Workspace lease conflict:** focus the existing owner; never permit two file writers.
- **Restore Source unavailable:** open the workbench Stopped with the remembered disconnected label.
- **Dock lease unavailable:** preserve the holder and open the contender visibly without reservation.
- **Flush failure during Quit/update:** abort the coordinated action and identify the failing
  workbench; never claim the set is safely saved.
- **Stale descriptor or PID reuse:** verify process-start identity and authenticated endpoint before
  routing.

## Security and privacy

- Coordination and instance endpoints accept only the current user and retain the existing request
  authentication and size limits.
- Runtime descriptors expose only routing metadata. Authentication tokens are stored separately
  with private permissions and are never printed in CLI listings.
- Source labels can contain private app or device names. They remain local and are included in crash
  uploads only under the existing diagnostic-data policy.
- File and URL payloads are validated before target selection or Library commit.

## Compatibility

- A one-instance user retains the existing launch, window, CLI and configuration behavior.
- Existing Library IDs, ordering and active selections survive migration.
- Pack V1 and current document schemas remain accepted; storage transport changes do not force a
  content-format version.
- Old CLI commands work against exactly one new instance through the compatibility broker.
- New CLI commands can control an old application as a synthetic single instance.
- Development, Preview and Release cannot discover, route to or migrate one another's data.

## Verification and acceptance

Automated coverage must include real child processes rather than only mocked stores:

- two and four processes writing separate workspaces;
- different-item concurrent Library commits and same-revision conflicts;
- imports, ordering changes, migration locking and forced termination at transaction boundaries;
- registration, heartbeat, PID reuse, stale cleanup, coordinator crash and handoff;
- zero/one/many CLI routing and old/new compatibility combinations;
- one Tray, shortcut registration, autostart owner and updater owner;
- Dock lease acquisition, conflict, release and crash cleanup;
- Development, Preview and Release namespace isolation using temporary data roots.

Real desktop acceptance must cover Windows 11 and supported macOS, two and four processes, different
and identical Sources, physical input, Automatic output, source restart and hot plug, mixed-DPI
multimonitor Dock behavior, Tray and shortcut routing, sleep/wake, RDP where applicable, crash,
Quit, Open at Login, update restoration and future file/URL routing.

The capture layer is not covered by normal CI. Before support is claimed, concurrent capture smoke
must pass on both operating systems and a four-hour multi-instance soak must show no cross-instance
control, leak or abnormal metric drift compared with the existing artifact baseline distribution.

PLVS may advertise supported multi-instance operation only after:

- no stress test loses a committed Library revision or produces malformed persistence;
- all shared writes are transactional and conflict-aware;
- workbench state is proven independent;
- cross-instance Library refresh preserves active runtime state and drafts;
- ambiguous CLI and incoming requests never guess a target;
- Tray, shortcut, updater and Open at Login have one deterministic owner;
- Dock reservation conflicts follow the specified policy;
- one instance can crash, quit and restart without stopping another's capture;
- coordinated Quit and update safely restore the prior instance set;
- all identity-isolation tests pass;
- desktop capture smoke and soak gates pass;
- `npm run check`, user documentation and Agent Control contract checks pass together.

## Alternatives considered

### Separate process with a fully independent Profile

This is operationally simple but turns every shared Preset, Theme and Loudness Profile into manual
copy/import work. It is useful as an internal test mode, not the default product model.

### One process with several sessions or windows

This centralizes persistence, Tray and updates, but requires the Rust engine, React store, IPC event
model, Dock hooks and every singleton to become session-keyed. A crash or blocking operation can
affect all captures. It is a much larger and riskier migration from today's one-engine process.

### One permanent coordinator daemon

A daemon simplifies ownership but adds packaging, login, update, crash and uninstall lifecycle that
PLVS does not otherwise need. An elected in-process role provides the required coordination without
remaining after all workbenches close.

## Open implementation questions

The following are engineering choices to settle during implementation without changing the product
contract:

- the exact Rust SQLite crate and migration framework;
- the IPC transport used for coordinator-to-instance events on each operating system;
- the recovery-area retention duration for explicitly quit additional workspaces;
- practical instance-count guidance derived from CPU, memory and audio tests;
- whether file/URL association ships in the first multi-instance release or immediately afterward.
