# ADR 0034: The capture rig lease is machine-wide

## Status

Accepted (2026-10-20). Supersedes the lease location in ADR 0028; the rest of ADR 0028 stands.

## Context

ADR 0028 put the capture rig lease in the Git common directory, which every worktree of one
repository shares. Releases now also run `smoke:capture` on self-hosted GitHub Actions runners on
the maintainer's home Windows PC, Mac and Ubuntu machine. A runner works in its own clone: a second
Git common directory driving the same VB-Cable, BlackHole or Pulse rig. With a per-repository lease,
a runner and a manual run on the same machine would not see each other, which is how the
2026-10-15 soak read +6.02 dB.

A runner may also run as a different local user from the maintainer. Its process start time can
then be unreadable, and ADR 0028 treated an unreadable start time on Windows as a dead holder.

## Decision

The lease lives in one shared directory per machine:

- Windows: `%ProgramData%\PLVS` (`C:\ProgramData\PLVS` when the variable is absent);
- macOS: `/Users/Shared/PLVS`;
- Linux: `/var/tmp/plvs`.

On macOS and Linux the directory is made mode `0777`, so any local user can create and remove the
lease. The PID-reuse check (process start time against the recorded one) now applies on all three
platforms, and a start time that cannot be read counts as a live holder.

A lease per repository was the obvious simpler choice and is exactly what fails here: a runner
clone is another repository on the same machine and the same rig.

## Consequences

- A checkout on the machine that still has the older scripts uses the old path until it is updated,
  so during the transition the two do not see each other.
- A holder that really is dead but whose start time cannot be read, such as another user's process
  on Windows after PID reuse, blocks the rig until its lease file is deleted by hand. Taking a live
  rig by mistake would be worse.
- Linux sinks are already private per process (`plvs_rig_<pid>`), so on Linux the lease serialises
  the harness runs rather than preventing summed tones.
