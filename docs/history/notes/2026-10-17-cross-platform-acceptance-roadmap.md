# Cross-platform Acceptance Roadmap

**Date:** 2026-10-17

**Status:** Active planning sequence

## Direction

Implement the accepted cross-platform acceptance design one domain at a time. Share contracts,
receipts, safety guards, and report vocabulary; keep native runners independent. Do not produce all
detailed implementation plans upfront. Each later plan should incorporate evidence from the earlier
adapters and required platform spikes.

Cross-platform evidence is advisory at this stage. Stable release review must explicitly list
missing or incomplete evidence, but its absence alone does not stop publication. A later decision
may promote reliable domains to blocking gates.

## Sequence

### 1. Packaged update acceptance

Current plan:
`../plans/2026-10-17-cross-platform-update-acceptance.md`.

Deliver the shared receipt/safety library, preserve the existing Windows acceptance behavior, add
the Apple Silicon macOS builder and writable-path runner, then cover feed faults, read-only DMG,
rollback, Dock/workspace restoration, and manual authorization checkpoints.

Completion evidence:

- real old-to-new offline cached upgrade on Windows and macOS;
- isolated identity, data, feed, installation, and ephemeral updater key;
- matching shared scenario IDs and evidence envelope;
- explicit manual or release-only status for authorization and notarization;
- cleanup proving no process, mount, feed, reservation, or test identity remains active.

### 2. Live capture acceptance

Run a macOS routing spike before writing the final design and implementation plan. Prefer a native
system-output route; use a dedicated virtual audio device on the acceptance Mac if the native route
cannot guarantee deterministic channel identity and level.

The spike records device discovery, left/right routing, sample rate, contamination isolation,
restart behavior, unattended playback, teardown, and restoration. Its conclusion selects the macOS
adapter and prerequisites.

The later design and plan will preserve the current Windows VB-Cable rig while sharing signal
generation, tolerances, smoke/soak verdicts, lease behavior, resource samples, and evidence format.

### 3. Native Dock acceptance

Use the passing macOS reservation smoke as the first adapter. Add a Windows host-window probe for
AppBar behavior and move shared scenarios into a platform-neutral runner:

- top and bottom reservation;
- requested versus measured strip height;
- non-overlapping, minimized, minimum-size, and user-moved windows;
- multi-workbench ownership;
- DPI/interface-size behavior;
- quit/restart persistence;
- work-area restoration and process cleanup.

Write the Dock design and plan after update acceptance establishes the shared evidence helpers, so
Dock reuses contracts rather than inventing a second receipt format.

### 4. Desktop performance acceptance

Run a macOS observability spike before committing to a runner. Determine which WKWebView, process,
frame-drop, audio-drop, memory, and recovery signals can be collected reliably without private or
unstable automation APIs.

Then write a design and plan that preserves the Windows WebView2 implementation behind an adapter
and shares normal/stalled/recovered phases, heavy/default scenarios, soak summaries, and cleanup.

### 5. Package verification evidence

Keep the existing Windows NSIS/Portable and macOS signed/notarized DMG checks. Add a shared command
shape and evidence envelope only after the earlier domains have stabilized those helpers.

Unify claims such as exact SHA, identity, version, package hash, required binaries/resources, CLI
doctor result, updater payload, native signature state, install or mount result, and cleanup. Do not
weaken platform-specific security checks to make the reports look identical.

## Documentation cadence

For each domain:

1. record a spike first when a native mechanism is unknown;
2. write a design spec defining claims, scenarios, evidence, safety, and non-goals;
3. obtain approval for material product/release/tooling decisions;
4. write an implementation plan naming files, tests, sequencing, and recovery;
5. implement and preserve run evidence under ignored artifacts;
6. record run-specific findings in a new history note;
7. update living contributor or architecture documentation only when the implemented workflow
   becomes current repository behavior.

## Decisions already approved

- The macOS acceptance machine may install a dedicated virtual audio device when a native route is
  not deterministic enough.
- Missing or incomplete dual-platform acceptance evidence is initially advisory, not release
  blocking.
- Release review must call out evidence gaps prominently and specifically.
- Routine macOS automation does not store credentials or bypass authorization UI.
- Initial macOS acceptance claims Apple Silicon only.
- Shared contracts do not imply one universal domain runner.
