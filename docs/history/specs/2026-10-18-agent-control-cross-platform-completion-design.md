# Agent Control cross-platform completion design

**Status:** Active

## Goal

Make the public Agent Control CLI behave consistently on Windows, macOS, and experimental Linux,
while keeping genuine platform limitations explicit. Completion means more than parser and contract
coverage: every public command must have an acceptance disposition, the safe common surface must be
exercised against a real running desktop, and platform-specific refusals must be verified rather
than silently skipped.

## Current state

The command manifest contains 113 public commands, 108 of which address a running application.
Static tests already prove that every running wire method has one frontend handler and that the
generated documentation matches the schema builders. The real-desktop Agent Control smoke is
deliberately smaller: it covers discovery, capability inspection, safe Settings navigation, one
PNG screenshot, and one silent MP4 recording.

Settings Control is internally consistent, but there is no authoritative inventory connecting each
user-writable Settings surface control to its public owner or an explicit exclusion. A newly added
GUI setting can therefore omit Agent Control without failing a coverage test.

Linux now supports the common socket transport, visible-WebView PNG screenshots, and silent H.264
MP4 recording. Linux Dock remains unsupported. Linux recording does not capture the system pointer
or measured-source audio.

## Decisions

### 1. Keep the release smoke small and add a layered acceptance runner

`smoke:agent-control` remains the short release gate. A new real-desktop acceptance runner composes
it with additional bounded scenarios. The runner uses only public `plvs-cli` commands for product
state and records the existing shared `agent-control` evidence envelope.

The acceptance catalogue assigns every public command to exactly one disposition:

- `offline`: exercised without a running app;
- `query`: exercised against the selected workbench;
- `roundTrip`: a mutation or action with owned setup, exact concurrency tokens, restoration, and
  final verification;
- `platformContract`: either exercised or verified as an advertised refusal on that platform;
- `external`: requires a separate rig or a relaunch/package boundary and is linked to the owning
  acceptance domain rather than silently claimed here.

A static coverage test fails when a manifest command has no disposition or appears twice. Real
acceptance scenarios are grouped by product family so evidence remains readable; the catalogue,
not the evidence schema, carries command-level coverage.

The first common runner covers offline schema/completion, discovery, all safe describe/list/inspect
queries, Settings/View reversible mutations, UI navigation, editor draft cancellation, file
analysis/report cleanup, visual capture, and platform capability refusals. Live audio capture,
native Dock behavior, configuration relaunch, updater operations, and installed-package adjacency
remain in their existing specialized acceptance domains.

### 2. Make Settings ownership explicit

Add one Settings surface catalogue containing every user-visible writable control or action. Each
entry declares its owner:

- `settings`, `view`, `theme`, `device`, or another Agent Control family;
- `uiOnly` for an operation intentionally available only through a semantic UI surface;
- `consent` for privacy, update, or Agent Control permission choices that automation must not grant;
- `external` for links and operating-system/package workflows.

Settings Control derives its public top-level field list from entries owned by `settings`. Contract
tests require every catalogue owner to be known, every Settings Control field to come from the
catalogue, and every control binding used by `SettingsPanel` to resolve to one entry. Deliberate
exclusions carry a concise reason.

### 3. Treat platform differences as contract, not drift

The acceptance runner reads `capabilities` and family descriptions before platform-dependent work.
Linux Dock passes its platform-contract scenario only when it reports unsupported and a guarded
entry attempt is refused without mutation. Windows and macOS must advertise the implemented Dock
surface and are covered by their native Dock acceptance producer.

Visual Capture follows the same rule. A platform may expose a smaller closed option set, but the
options it advertises must work. Common screenshot and silent-recording behavior is required on all
three desktop platforms.

### 4. Do not fake Wayland cursor support

WebKitGTK snapshots contain application pixels, not the compositor-owned system pointer. Wayland
does not provide a reliable global-pointer capture path to an ordinary application. Linux therefore
continues to advertise `cursorModes: ["none"]` until a compositor-approved capture API is adopted.

Measured-source recording can be added independently because PLVS already owns the measured PCM
stream. It must reuse the shared 48 kHz stereo timeline, gap accounting, and recording evidence
shape. It is complete only after a real LIVE recording contains one H.264 video stream and one AAC
audio stream and the Agent Control smoke remains green. Until then Linux continues to advertise
only `audioSources: ["none"]`.

## Safety and cleanup

Every real-desktop scenario pins one workbench instance, starts from a visible normal window with no
blocking editor, owns every artifact or temporary resource it creates, and restores in reverse
order. A failed cleanup makes the shared evidence fail. No scenario edits persistence files or
native state behind the running React owners.

Linux Dock unsupported behavior, pointer omission, and any deferred measured-source audio work are
reported explicitly; they are never converted into passed feature scenarios.
