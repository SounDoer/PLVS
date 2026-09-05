# Settings Control

Status: Approved design contract

Settings Control exposes persistent application preferences from the existing GUI Settings surface.
It does not treat every value stored in the settings persistence domain as a public setting.

## Commands

```powershell
npm run desktop:control -- settings describe --json
npm run desktop:control -- settings inspect --json
npm run desktop:control -- settings update <file|-> --expected-revision 12 --json
```

- `describe` reports the public schema, defaults, options, current effective values, and dynamic
  availability.
- `inspect` reports current effective public values without schema metadata.
- `update` applies an atomic direct-field patch with expected revision, dry-run, no-op,
  boolean changed status, warnings, and durable persistence settlement.

There is no generic `settings reset` in the first version. Individual GUI resets and the destructive
whole-configuration reset do not share one semantic boundary, and explicit updates can restore
ordinary defaults. Configuration export, import, and whole-configuration reset belong to future
`app config` control; no existing public command provides them.

## First-version public scope

Fields, types, defaults and options are generated from the schema:
[`generated/settings.md`](generated/settings.md). Current values and dynamic availability are
runtime state, reported by `settings inspect` rather than documented here.

The public fields correspond to Open at Login, Close Behavior, the configurable Clear shortcut,
Interface Size, Appearance and active Theme selection, History Length, Dialogue Detection, and
channel-role labels.

The following are intentionally outside Settings Control:

- Theme library creation, editing, duplication, and deletion; these belong to future Theme Control.
- Loudness Profile library and selection; these belong to future Loudness Profile Control.
- Workspace, panels, and axes.
- Focus View, panel opacity, glass, window geometry, and Dock; these are working-scene state captured
  by Presets rather than ordinary global Settings.
- Configuration export, import, and whole-configuration reset.
- Fixed, non-configurable keyboard shortcuts.

`settings update` is atomic. If any included field is invalid or unavailable, including an
Appearance change blocked by an active Theme Editor, no other field in the patch may change.

## Behavior

`openAtLogin` accepts only a JSON boolean. Inspection reports it as null with
`availability.openAtLogin.reason: autostartUnavailable` when the operating-system integration is
not ready or cannot be queried; it must not present the hook's temporary false initialization as a
real value. Mutation waits for operating-system confirmation, and unavailable mutation fails with
`controlUnavailable`. Dry-run checks availability without registering or unregistering autostart,
and a no-op does not call the operating system. The App Control setter must expose errors currently
swallowed by the GUI-oriented hook.

`closeBehavior` accepts exactly `ask`, `tray`, or `quit`, with `ask` as the default. It changes only
what a future close request does and never immediately hides or quits the app. Both fields remain
available while a draft editor is open. If a larger atomic patch also contains a blocked Appearance
change, the whole patch is refused before either Behavior field changes.

## Clear shortcut

`clearShortcut` is a merge-patched object with `accelerator` and `global`; omitted members retain
their current values. The default is `{ "accelerator": "CmdOrCtrl+K", "global": false }`.
Accelerators use the same canonical, cross-platform Tauri form produced and validated by the GUI:
at least one modifier plus exactly one non-modifier key. Display-form strings, bare modifiers,
invalid chords, and conflicts with fixed PLVS shortcuts are rejected through shared validation.

Inspection separates requested configuration from runtime registration. Runtime
`globalRegistration` is `active`, `notRequested`, or `unavailable`. A global registration failure is
a command failure, not a warning. Replacing an active global chord registers the new chord before
persisting it and releasing the old one; failure preserves the old configuration and registration.
Dry-run cannot reserve a chord and therefore cannot guarantee that another application will not
claim it before real execution. A no-op performs no registration work.

While the GUI is displaying `Press a combo...`, only patches containing `clearShortcut` are
temporarily unavailable; the recorder is not a global blocking editor. Loudness Profile and Theme
editors do not block this field. The App Control implementation must expose persistence and
registration errors currently swallowed by the GUI-oriented shortcut hook.

## Interface size

`interfaceSize` accepts exactly `small`, `default`, `large`, or `extra-large`, with `default` as the
default. It immediately changes text and related icon sizing in the normal UI but does not affect
Dock. It is global Settings state, is not captured by Presets, does not dirty a Preset, has no dynamic
availability, and remains writable while either current draft editor is open. A no-op does not
reapply document sizing, and successful mutation waits for persistence.

## Appearance

Appearance has writable `mode` and `themeId` fields plus read-only `resolvedThemeId`. `mode` accepts
exactly `system` or `fixed`. In System mode, `themeId` must be omitted or null. Switching to Fixed
mode requires an explicit currently available Theme ID; App Control does not copy the GUI's implicit
choice of whichever Theme happens to be resolved at that instant. Supplying `themeId` alone does not
implicitly change the mode, and writing `resolvedThemeId` fails with `readOnlyControl`.

`settings describe` dynamically lists built-in and custom Theme IDs with their display names and
kind. A missing ID fails rather than silently selecting another Theme. Theme library mutations are
not part of Settings Control. While Theme Editor is open, every patch containing `appearance` is
refused with `editorActive` before no-op detection or any other field mutation; Loudness Profile
Editor does not block Appearance. An operating-system light/dark change in System mode changes only
the read-only effective `resolvedThemeId`, not the global revision or Preset dirty state.

## History length

`historyRetentionSec` accepts only the numeric enum `1800`, `3600`, `7200`, or `14400`, with `3600`
as the default. It does not accept numeric strings, clamp, or choose a nearest option. Changing it
does not restart measurement or clear current statistics and maxima. Increasing retention cannot
restore history already discarded; reducing it immediately discards rows older than the new limit.

The field is global, is not captured by Presets, does not dirty them, and is unaffected by draft
editors. A reduction requires no extra force flag, matching the GUI, but both real and dry-run
results include `historyRetentionReduced` with the previous and target values. The top-level
`dryRun` value distinguishes a preview from an actual truncation. A no-op performs no trimming.

## Dialogue Detection engine

`dialogueVadEngine` accepts exactly `firered`, `silero`, or `ten`, with `firered` as the default.
There is no Off value: the setting selects the engine, while Stats dialogue-metric demand determines
whether the shared runtime is requested. Inspection separates the configured setting from runtime
`dialogueDetection.requested`, `active`, and effective `engine`.

Changing the setting while no dialogue metrics request the runtime persists the new choice without
starting VAD or restarting measurement. Changing it while Dialogue Detection is running invokes the
existing whole-measurement restart needed to keep dialogue and overall loudness time windows
coherent. A real mutation in that state requires `--allow-measurement-restart`; without it the
side-effect-free command fails with `confirmationRequired`. Dry-run needs no flag and reports both
`effects: ["measurementRestart"]` and the required flag. A successful confirmed result reports the
same effect and waits for backend synchronization, restart, and Settings persistence. A no-op needs
no confirmation. The field is not captured by Presets and is unaffected by draft editors.

## Channel labels

Channel labels are stored per channel count rather than per device. Inspection reports the current
`channelCount`, `mode` (`auto` or `custom`), and the complete effective `roles` array. With no active
channels, the count is zero, roles are empty, and mutation is unavailable with `noChannels`.

A custom update must include the current channel count and one complete role array of that exact
length. Returning to automatic labels uses the same count with `mode: auto` and no roles. A count
that no longer matches fails atomically with `channelConfigurationChanged`; there is no positional
partial patch. Roles accept the GUI vocabulary `generic`, `M`, `L`, `R`, `C`, `LFE`, `Ls`, `Rs`,
`Lb`, `Rb`, `Cs`, `Ltf`, `Rtf`, `Ltr`, and `Rtr`; duplicates remain valid, matching the GUI.

When a live change alters the derived BS.1770 weight vector, it resets loudness accumulation and
requires `--allow-measurement-restart`; success reports `loudnessMeasurementRestart`. A label-only
change between roles with identical weights needs no confirmation. Already completed FILE results
are not recomputed; mutation succeeds with `fileReanalysisRequired` and never starts analysis by
itself. The field is not captured by Presets, is unaffected by draft editors, and successful live
mutation waits for backend weight synchronization and Settings persistence.

## Revision, results, and dry run

Settings uses the application's single process-local revision. GUI and App Control changes to
public Settings increment it once per command, regardless of how many fields change.
No-op, dry-run, validation/refusal failure, operating-system appearance resolution, channel-count
changes, and analysis-runtime demand changes do not increment it. These Settings do not increment
a second counter.

Mutation requires `--expected-revision`. Success and dry-run return boolean `changed`, top-level
`revision`, `effects`, `warnings`, and the complete effective or predicted public Settings snapshot
under `state.settings`, with related runtime and availability in `state`. A no-op returns
`changed: false`. Dry-run leaves the real revision unchanged, performs no React, backend,
operating-system, or persistence mutation, and reports any confirmation flag a real execution
would require.

Successful real mutation waits for all relevant backend/OS acknowledgement and durable persistence.
A persistence failure after commit reports `persistenceFailed`, `stateCommitted: true`, and the
resulting revision; the caller must inspect again before continuing.

## Validation

Settings update uses strict write validation rather than the fallback normalization used while
loading old persisted data. Unknown fields, wrong types, invalid enum values, inconsistent nested
objects, and attempts to write read-only fields fail; values are never coerced, clamped, rounded,
or silently replaced by defaults. All statically determinable issues are returned together under
`invalidSettings.details.issues`, with stable code, public path, and message.

Top-level fields are direct patches and supported nested objects use merge semantics, but the final
object must still be self-consistent. An empty object is a successful no-op. Null means reset only
where a field explicitly admits null; it is not a general defaulting operator.

Processing order is request-shape and static validation, expected revision, dynamic
availability and editor guards, effective-diff/effect/confirmation computation, then dry-run or
execution. Editor refusal precedes no-op detection. Measurement-restart confirmation is required
only when the effective change actually causes that effect.

## Execution failure and compensation

Settings atomicity guarantees that predictable request, validation, revision, availability, editor,
and confirmation failures have no side effects. Execution-time failures across operating-system and
audio-backend integrations use best-effort compensation rather than an impossible absolute-atomicity
claim.

Execution first completes every fallible but reversible system/backend transition, then commits
React and durable Settings state, and leaves explicitly authorized irreversible effects until the
latest safe point. Autostart, global-shortcut, VAD-engine, and loudness-weight transitions record
compensating actions. If a later stage fails and compensation restores the original public state,
the error reports `applicationFailed`, `partial: false`, `rollback: completed`,
`error.details.changed: []`, and an unchanged revision.

If compensation fails, the error reports `partial: true`, `rollback: failed`, the observed changed
paths under `error.details.changed`, and the current revision. This string array is distinct from
the boolean `result.changed` on success. History truncation and measurement restarts cannot be
restored; a failure after either reports `rollback: notPossible` and the effects already performed.
Every partial outcome requires a fresh Settings inspection before another mutation.

## Describe, inspect, and global inspection

`settings.describe` returns the top-level revision and the compact PLVS schema used by Panel Control:
type, default, options, unit where relevant, current effective value, dynamic availability, and
unavailable reason. Theme and Channel Role options are generated from the current catalogs;
Dialogue Detection options may include their existing official links. It exposes no persistence
keys, component names, IPC commands, or complete custom Theme documents.

`settings.inspect` omits schema metadata and returns revision, effective `settings`, `runtime`, and
`availability`. `settings.update` returns the same complete focused snapshot plus mutation metadata.
The global `app.inspect` also includes the compact Settings snapshot and top-level `revision`, while
the focused command avoids returning Workspace and panel state. Public CLI consumers discover
Settings support through `app.capabilities` result fields `commands` and `features`; current values
and dynamic option lists are not capability data. The frontend/RPC `methods` list may remain as
internal compatibility data, but public consumers must not use it for capability selection.
