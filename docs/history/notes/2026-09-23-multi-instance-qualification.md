# Multi-Instance Implementation Qualification

Date: 2026-09-23  
Status: Windows implementation qualification passed; cross-platform desktop acceptance remains
open

## Scope and conclusion

This record qualifies the first implementation of the architecture in ADR 0008: one PLVS process
per metering workbench, a shared revisioned Library, per-workspace state, and an elected
coordinator for singleton operating-system resources.

The implementation and Windows qualification passed. PLVS must not yet make an unqualified
cross-platform support claim because the macOS and several physical desktop scenarios listed below
were not available on this host. Those are environment gates, not known code failures.

All destructive and desktop tests used an isolated Codex worktree and explicit temporary identity
roots. No installed Development, Preview, or Release user data was read or modified. The worktree
was `C:\Users\shenxichen\repos\PLVS\.codex\worktrees\multi-instance-architecture-audit` on branch
`codex/multi-instance-architecture-audit`.

## Delivered behavior

- Ordinary additional launches allocate independent internal workspaces. The existing default
  workspace keeps the single-instance Automatic-source behavior; a newly allocated workbench starts
  stopped with no Source until the user explicitly chooses one. Repeated Sources remain allowed.
- Source-derived names, with deterministic duplicate suffixes, identify windows, Tray entries and
  CLI targets without user-created profile names.
- Presets, Themes and Loudness Profiles live in a shared SQLite Library. Writes are transactional,
  revision checked and observable by peer workbenches without silently replacing their active
  runtime snapshots or open drafts.
- Source selection, active Preset/Profile/Theme snapshots, Workspace layout, window bounds and Dock
  state are workspace owned. Ephemeral capture and editor state are not persisted.
- Tray, global shortcut, Open at Login, updater and coordinated identity-wide operations are owned
  by the elected coordinator. Surviving processes can promote after coordinator failure.
- Windows Agent Control uses a distinct current-user named pipe per instance. macOS code uses a
  distinct private Unix socket per instance. `plvs-cli instances` discovers all live targets and
  `--instance` or `PLVS_INSTANCE_ID` selects one.
- Full configuration import quiesces peers and targets one workbench for instance-owned fields. A
  durable journal rolls back a failed or interrupted multi-store replacement before the target
  workspace is next shown.
- Development, Preview and Release have separate application identities, storage roots, discovery
  namespaces and Agent Control endpoints.

## Automated evidence

The final `npm run check` passed after implementation:

- version and dependency-license inventory checks;
- frontend formatting, ESLint and production Vite build;
- 381 Vitest files and 4,420 tests;
- Rust formatting and Clippy with warnings denied;
- 695 Rust library tests passed with one deliberately ignored test;
- 44 additional Rust integration and CLI tests passed.

The Rust suites include separate-process Library stress, workspace leases, simultaneous first
launch, workspace allocation and restore, instance registry cleanup, PID-reuse protection,
coordinator election and promotion, restore grants, legacy migration, identity isolation and
old-application CLI fallback. Targeted Development/Preview/Release identity and packaging workflow
tests also passed, and both Preview-identity and default Release-profile Rust builds compiled.

Fault-injection tests cover same-item and collection conflicts, failed workspace restoration,
failed instance retirement, partial coordinator preparation, abandoned global barriers, updater
failure recovery, failed configuration commit/abort, mid-import storage failure and startup recovery
from an interrupted configuration import.

## Windows desktop acceptance

Real GUI and CLI acceptance used temporary data roots and covered:

- two and four simultaneous PLVS processes;
- different Source selections and concurrent capture;
- terminating one peer without stopping the others;
- coordinator termination and survivor promotion from generation 1 to generation 2;
- restoring all four saved workbenches;
- Dock reservation fallback when an edge was occupied, followed by reacquisition;
- coordinated full-configuration import and relaunch;
- duplicate Source-derived names;
- an additional source-free, stopped workbench and persistence of its later Source selection;
- CLI refusal with exit 4 when a target has no selected Source, followed by successful capture after
  selecting Automatic;
- old CLI to new app: the one-workbench path remains compatible, while multiple targets return the
  structured `instanceSelectionRequired` response with exit 2;
- new CLI to old app: one synthetic `legacy` target preserves the old single-endpoint behavior.

One full-GUI CPAL run logged one buffer underrun/overrun diagnostic while both streams continued.
The capture harness smoke and both multi-process soaks below ended with zero dropped chunks. The
isolated diagnostic is retained as an observation, not classified as a multi-instance failure.

## Capture and resource qualification

The standard real-capture smoke passed on the Windows VB-Cable/VLC rig. A 75-second two-process
soak also passed with both processes reporting -22.037477057 LUFS, zero dropped chunks and roughly
15.8-15.95 MiB RSS.

The final two-process soak ran continuously for 14,400 seconds. Its immutable artifacts are in
`artifacts/soak/multi-soak-1790158957798`.

| Metric | Instance 1 | Instance 2 |
| --- | ---: | ---: |
| Final integrated loudness | -22.038181089 LUFS | -22.038184111 LUFS |
| Settled loudness spread | 0.004519100 dB | 0.004507406 dB |
| Dropped chunks | 0 | 0 |
| RSS first sample | 15.906 MiB | 15.887 MiB |
| RSS final sample | 18.207 MiB | 18.137 MiB |
| RSS observed maximum | 18.449 MiB | 18.402 MiB |

The two final loudness values differ by 0.000003022 LU. Both spreads are below the 0.01 dB harness
limit. Nine existing single-process four-hour baselines have a 0.003282-0.004268 dB spread (mean
0.003698 dB), final values from -22.038053 to -22.037194 LUFS, and zero drops. The concurrent run is
about 0.00025 dB beyond the previous maximum spread and about 0.00013 LU below the previous final
range. This is measurable but acoustically negligible, symmetric across both processes, and still
well inside the harness limit. It should remain visible when future baselines are compared rather
than being rounded away.

RSS rose by approximately 2.3 MiB per process during warm-up and then flattened: hourly means for
instance 1 were 17.03, 17.92, 18.09 and 18.13 MiB; instance 2 was 17.08, 17.90, 18.03 and 18.21 MiB.
There was no unbounded growth or asymmetric resource consumption. Two concurrent metering
workbenches therefore cost approximately two independent audio engines plus about 18 MiB steady RSS
per harness process on this rig; higher instance counts remain bounded primarily by device/backend
capacity and normal per-process CPU cost.

## Acceptance still requiring external desktop environments

The following checks are required before an unqualified public claim that multi-instance is
supported on every shipping platform:

- real macOS concurrent capture, per-instance Unix sockets, Dock/menu lifecycle, coordinator
  promotion and ordinary second-launch behavior;
- mixed-DPI multi-monitor window restoration and Dock movement/fallback;
- sleep/wake, RDP detach/reattach or sign-out, and physical device hot-plug/default-device changes;
- an actual Open at Login session launch with a saved multi-workbench restore set;
- a signed updater installation, including failure restoration and relaunch of the saved set.

On macOS, ordinary Dock/app activation may focus an existing process instead of spawning another;
that product interaction must be verified even though the storage and socket architecture supports
multiple processes. A separate **New Workbench** command was not added because the approved first
release design specified ordinary relaunch and did not approve another explicit control.

File associations and `plvs://` routing remain intentionally deferred because PLVS does not ship
those associations yet. The discovery model now exposes all instances and can support a future
target picker without returning to a global single-instance design.

## Qualification decision

The Windows implementation satisfies the agreed architecture and the code-level acceptance gates:
independent capture survives peer failure, shared writes are conflict aware, instance state cannot
overwrite another workspace, singleton resources have one recoverable owner, CLI targeting is
explicit, imports recover from interruption, and identity namespaces do not overlap.

The remaining work is a focused cross-platform and physical-desktop acceptance pass. Until that is
recorded, release communication should say that the multi-instance implementation is qualified on
Windows rather than claiming universal formal support.
