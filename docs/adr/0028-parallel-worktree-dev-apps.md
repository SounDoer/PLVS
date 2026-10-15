# ADR 0028: Linked worktrees run isolated dev apps; the capture rig is leased

## Status

Accepted (2026-10-15)

## Context

Agents work on PLVS in parallel, one linked Git worktree each. Every dev app shared port 1420 and
the one `com.soundoer.plvs.dev` app-data directory, so a second worktree could not start its dev
app, and when it could have, a branch that changes a persisted format would have written it where
every other branch's app reads. Run from a worktree, the dev CLI also discovered the main
checkout's app and could inspect or change an app built from different code without noticing.

The capture rig (VB-Cable and the VLC test tone) exists once per machine. On 2026-10-15 two agents
played the rig tone at once and a soak read +6.02 dB; nothing had detected the overlap.

Debug builds already accepted `--plvs-test-app-data-root`, and the debug CLI already honoured
`PLVS_TEST_IDENTITY_ROOT`, for isolated test runs.

## Decision

The main checkout keeps port 1420 and the ordinary dev app data. In a linked worktree, the dev
tooling scripts:

- give the dev app a port derived from the worktree path in 1430–1499;
- start it with `--plvs-test-app-data-root <worktree>/.dev-data`, beginning from a genuine first
  run with no copy of the main dev profile;
- point the dev CLI at that root, so it sees only the worktree's own app.

Data isolation is the default with no opt-out. Shared data was the obvious simpler choice and is
exactly what made parallel branches unsafe: the damage it does (a migrated or malformed store read
by another branch) surfaces far from its cause.

The isolation argument and the CLI variable are also accepted by `dev-identity` release builds,
so `desktop:dev-optimized` can isolate too. Stable and Preview builds never enable that feature
and still reject both.

The capture rig is taken through an exclusive lease file in the Git common directory, acquired
where the test tone starts. A live holder makes every other run fail, or wait with `--wait`. There
is no flag to take a live lease: a rig shared by two runs measures neither, and capture smoke
already has no bypass.

## Consequences

- Each worktree's first dev build costs its own target directory (6.5 GB and about two minutes on
  the machine it was measured on).
- A worktree's dev app does not see the user's dev presets or themes. Files copied into `.dev-data`
  by hand are the way to test with them.
- The lease is advisory. Driving VB-Cable or the test tone outside the smoke, soak and
  multi-instance scripts bypasses it.
- A run killed outright leaves its lease behind; the next run removes it once the holder's process
  is gone, checked by PID and, on Windows, process start time.
