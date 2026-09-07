# Agent Control Device Control — Design

Date: 2026-09-07
Status: Approved design contract

## 1. Goal

Add a bounded, scriptable Device Control surface for the same audio-source picker used by the
running PLVS GUI. A caller must be able to discover currently visible system-output and physical
input sources, inspect the persisted and effective selection, and select an exact device or the
Automatic route without learning backend handles or manipulating persistence directly.

The family is intentionally live-app control. It does not revive the removed headless `devices`
command, launch PLVS, or expose the capture harness.

## 2. Scope

In scope:

- bounded discovery of the running app's current selectable device inventory;
- inspection of the requested selection, Automatic resolution metadata, availability, and Live
  relationship;
- exact-ID selection and the special `default` Automatic route;
- selection persistence through the existing capture-device preference owner;
- explicit confirmation and settlement when changing a running Live measurement restarts capture;
- deterministic revision, dry-run, race, failure, and device-hotplug semantics;
- Windows implementation on the current Agent Control transport with platform-independent command
  and result contracts.

Out of scope:

- starting, stopping, or clearing Live capture; those remain Transport Control operations;
- selecting by label, substring, index, backend handle, Core Audio UID, or WASAPI endpoint path;
- changing an audio device's channel layout, sample rate, buffer size, gain, routing, or OS default;
- aggregating multiple devices or selecting separate input/output devices simultaneously;
- exposing microphone permission management;
- carrying device choice in Presets or Theme/Profile libraries;
- changing the capture backend, device-ID algorithm, callback thread, DSP, or measurement model;
- macOS Agent Control transport implementation, which is a separate foundation milestone.

## 3. Product vocabulary

PLVS presents one list of monitorable signals:

- `systemOutput` rows monitor an operating-system playback endpoint through loopback/tap;
- `input` rows monitor a physical or virtual capture input;
- `default` means Automatic: follow the operating system's current default playback route.

`default` is a policy, not a physical device record. It remains a valid persisted choice even while
no output is currently available. Selecting it must never pin the concrete endpoint that happened
to be default at command time.

The public API uses `device`, singular, because commands operate on the app's one requested capture
source. The removed standalone `plvs-cli devices` command and internal capture-harness device
matching are not aliases.

## 4. Existing semantic owner

`useAudioDevices` currently owns the cached `DeviceInfo` list, persisted `captureDeviceId`, default
route preview, hotplug subscription, and legacy-ID migration. `useAudioEngine` observes the selected
ID and format signature; while Live is running, a change tears down the current session, clears the
Live measurement state, and starts a new session. `App.jsx` composes those owners for the header,
tray, runtime, and Agent Control transport snapshot.

Agent Control must not call `saveCaptureDeviceId` behind `useAudioDevices` or invoke the audio
engine directly. The reusable split is:

1. a pure Device Control model normalizes inventory and plans selection against one coherent
   snapshot;
2. an asynchronous controller owned by the existing hooks persists the selection and, when
   required, observes the Live restart through the normal engine lifecycle;
3. Agent Control owns JSON-RPC validation, optimistic concurrency, inventory generation checks,
   confirmation, settlement, and result shaping.

GUI header and tray selection must use the same controller as Agent Control. A CLI-only device
switch path would otherwise disagree about restart, failure, migration, and persistence.

There is one existing boundary mismatch to fix before exposing Control: the native inventory now
emits stable `lb-<32 hex>` / `cap-<32 hex>` IDs, while `capturePrefs` still validates only
`default` and legacy `out:N` / `in:N` values. Consequently a concrete GUI choice can remain live in
React but be normalized to Automatic during persistence. The shared owner must accept current
stable IDs, continue reading legacy values for migration, and test a real save/load round-trip. This
is prerequisite correctness work, not a new public ID format.

## 5. Public commands

```text
plvs-cli device list --json
plvs-cli device inspect --json
plvs-cli device select <device-id|default> \
  --expected-revision <n> \
  --expected-generation <n> \
  --json \
  [--allow-measurement-restart] \
  [--dry-run]
```

Wire methods are:

```text
device.list
device.inspect
device.select
```

There is no `device describe` in the first slice. `list` is the dynamic selection schema and
`inspect` explains current state. Capabilities and public documentation describe the fixed command
contract.

Every command requires the running PLVS app and the existing authenticated local Agent Control
transport. The schema is platform-independent even though the transport currently makes the
family Windows-only in practice.

## 6. Inventory model

`device list` returns one coherent cached inventory snapshot owned by the GUI:

```json
{
  "revision": 31,
  "generation": 7,
  "observedAt": "2026-09-07T10:12:40.000Z",
  "automatic": {
    "id": "default",
    "label": "Automatic",
    "available": true,
    "resolved": {
      "label": "Speakers (USB Interface)",
      "sampleRateHz": 48000,
      "channelCount": 2
    }
  },
  "devices": [
    {
      "id": "lb-…",
      "label": "Speakers (USB Interface)",
      "kind": "systemOutput",
      "direction": "output",
      "loopback": true,
      "sampleRateHz": 48000,
      "channelCount": 2
    },
    {
      "id": "cap-…",
      "label": "Microphone (USB Interface)",
      "kind": "input",
      "direction": "input",
      "loopback": false,
      "sampleRateHz": 48000,
      "channelCount": 2
    }
  ],
  "truncated": false
}
```

The public record deliberately omits backend-specific keys, Core Audio UIDs, endpoint paths, array
indexes, and migration internals. Device IDs are opaque exact-match tokens returned by this API.
Labels are presentation only and are neither unique nor accepted for selection.

The result is bounded to 256 device rows and 512 Unicode scalar values per label. If the internal
inventory exceeds the row limit, `devices` contains the first 256 GUI-order rows and
`truncated: true`. Exact selection still checks the complete internal inventory. Duplicate public
IDs are an internal error rather than silently de-duplicated choices.

The ordering matches the GUI: system outputs first, then inputs, retaining the native order within
each group. Automatic is separate and always first conceptually.

## 7. Inventory generation

`generation` is a process-local monotonic token for the normalized device inventory and Automatic
preview. It increments when the visible IDs, labels, kinds, order, format metadata, or Automatic
availability/resolution metadata changes.

Device hotplug and OS-default changes are environmental observations. They do not increment the
global Agent Control revision and do not wake `app.wait`. Mixing them into the global revision would
turn unrelated Settings, Preset, Theme, and Workspace optimistic-concurrency tokens stale whenever
a USB device appears or disappears.

`device select` therefore requires both:

- `--expected-revision` to protect controllable application state;
- `--expected-generation` from `device list` or `device inspect` to prove the caller selected from
  the inventory it actually observed.

A generation mismatch returns `deviceInventoryChanged` before no-op detection or mutation. The
caller lists again and makes a new decision; the CLI never retries or picks a replacement.

Generation resets when PLVS restarts and is meaningful only with that process's descriptor, just
like the global revision.

## 8. Inspection

`device inspect` returns the current selection and Live relationship:

```json
{
  "revision": 31,
  "generation": 7,
  "observedAt": "2026-09-07T10:12:40.000Z",
  "selection": {
    "requestedId": "default",
    "mode": "automatic",
    "available": true,
    "resolved": {
      "id": null,
      "label": "Speakers (USB Interface)",
      "kind": "systemOutput",
      "sampleRateHz": 48000,
      "channelCount": 2
    }
  },
  "live": {
    "running": true,
    "transition": null,
    "usingRequestedSelection": true
  }
}
```

For an exact selected ID, `resolved.id` is that ID. For Automatic, `resolved.id` may remain `null`
when the existing native preview can prove label and format but not expose a stable concrete ID.
The API must not guess one by label.

`selection.available` is false when an exact requested ID is absent or Automatic cannot currently
resolve. During persisted legacy-ID migration, inspection reports the last requested ID plus a
bounded transition state rather than claiming a successful fallback before the owner commits it.

`usingRequestedSelection` is true only after the Live engine has settled on the current requested
selection. It is false during restart, after a start failure, or when Live is stopped.

## 9. Selection semantics

`device select` accepts only literal `default` or one exact current device ID. It never matches
labels or accepts legacy `out:N` / `in:N` indexes that are absent from the current public list.

Selection is a global persisted preference. It is not captured by Presets and does not dirty an
active Preset.

Behavior by current state:

| State                                 | Effective ID change | Behavior                                                                                      |
| ------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------- |
| Live stopped                          | yes                 | persist selection; do not start Live                                                          |
| Live running                          | yes                 | require confirmation; clear Live measurement/history and restart capture on the new selection |
| File source selected, no Live capture | yes                 | persist selection for the next Live start; do not alter any File session                      |
| Any state                             | no                  | successful no-op; no confirmation, restart, write, or revision increment                      |

Selecting `default` while no default output currently resolves is allowed only when Live is stopped.
It persists the future-facing policy and returns warning `automaticCurrentlyUnavailable`. If Live
is running, an unavailable target fails before the current session is stopped.

Selecting an unavailable exact ID always fails. Device presence is revalidated immediately before
commit even after generation validation; hotplug can race any snapshot.

## 10. Live restart and confirmation

A changed selection while Live is running has effect `measurementRestart`. It clears Live history,
statistics, maxima, and the current timeline before starting the new session, matching the existing
engine dependency behavior. The real command requires `--allow-measurement-restart`.

Dry-run does not require the flag. It reports:

```json
{
  "effects": ["measurementRestart"],
  "confirmationsRequired": ["allowMeasurementRestart"]
}
```

The controller must preflight the target with the existing native preview before stopping the
current session. A real success is not returned merely because React accepted the new string: it
waits for selection persistence and, when restarting, the normal Live lifecycle to confirm native
startup and frame-channel readiness on the requested selection.

If restart fails after the new preference is visibly committed, the selection remains inspectable
and persisted, Live settles stopped/failed, and the command returns `deviceStartFailed` with
`stateCommitted: true` and the resulting revision. It does not silently roll back to the old device
or retry another one. Automatic fallback would hide which source the user asked PLVS to monitor.

If the target disappears before any state change or the preflight fails, return a side-effect-free
availability error with the old Live session untouched.

## 11. Result and dry-run

Selection returns:

```json
{
  "dryRun": false,
  "revision": 32,
  "generation": 7,
  "changed": true,
  "effects": ["measurementRestart"],
  "warnings": [],
  "plan": {
    "from": "default",
    "to": "cap-…",
    "restartLive": true
  },
  "state": {
    "selection": {},
    "live": {}
  }
}
```

Dry-run performs request validation, revision/generation checks, exact target resolution,
availability checks, effect computation, and target preview. It performs no state update, Live
stop/start, measurement clear, persistence write, notification, revision increment, or inventory
generation change.

A dry-run is a statement about the observed moment, not a reservation. The device may disappear or
change format before the real command, which must repeat every dynamic check.

## 12. Revision and settlement

The persisted requested device ID is controllable state and participates in the global Agent
Control revision. GUI header/tray selection, CLI selection, and automatic committed legacy-ID
migration increment it once when the effective requested ID changes.

Inventory, Automatic resolution, labels, and device format changes affect only Device generation.
A format change for the currently selected running device may independently trigger the existing
Live restart, but does not pretend the user changed their requested selection.

A real stopped-Live selection settles React ownership and persistence before success. A running-Live
selection additionally settles native stop/start and engine synchronization. One command produces
one global revision even though several lifecycle states may render while restart is in progress.

Persistence failure after visible selection commit returns `persistenceFailed` with
`stateCommitted: true`. Native restart failure uses `deviceStartFailed` as described above. Callers
inspect rather than blindly retrying either partial outcome.

## 13. Concurrency and blocking

Device selection is refused with `transitionInProgress` while the Live engine is already starting,
stopping, or restarting. It is also refused while update installation/restart makes runtime changes
unavailable. Query commands remain available and expose the transition.

Theme and Loudness Profile draft editors do not block device operations. Device selection neither
closes those editors nor alters their drafts. The scene-operation editor guard used by Presets and
Dock does not apply.

File analysis in progress is not stopped or restarted by Device Control. Selection changes the
future/current Live device only. If the architecture allows Live capture to remain active behind a
selected File session, confirmation follows actual Live running state rather than visible source
mode.

## 14. Errors

- `deviceNotFound` — exact target ID is absent; exit 3.
- `deviceInventoryChanged` — expected generation is stale; exit 4.
- `deviceUnavailable` — target exists or is Automatic but cannot currently be previewed; exit 4.
- `confirmationRequired` — running Live would restart without the required flag; exit 4.
- `transitionInProgress` — Live is already changing lifecycle; exit 4.
- `deviceStartFailed` — selection committed but restarted capture failed; exit 1 with
  `stateCommitted: true`.
- `persistenceFailed` — visible selection could not be durably saved; exit 1 with
  `stateCommitted: true`.
- `revisionConflict` — global expected revision is stale; exit 4.

Malformed IDs, unsafe integer values, unknown flags, and missing required arguments are CLI-side
`invalidArguments` failures and never reach the app.

## 15. Acceptance criteria

- list, inspect, and select appear in capabilities, root/family help, protocol tests, and public
  documentation.
- public inventory contains only bounded semantic fields and never backend handles.
- exact IDs and Automatic behave identically across GUI, tray, and Agent Control paths.
- stable `lb-*` / `cap-*` selections survive persistence and legacy IDs retain their existing
  migration path.
- device hotplug advances only generation; requested selection changes advance global revision.
- stale generation and last-moment disappearance fail before any mutation.
- Live-running selection requires explicit confirmation and success awaits real restart readiness.
- stopped/File-only selection persists without starting, stopping, clearing, or reanalyzing.
- no-op needs no confirmation and performs no write, restart, or revision increment.
- dry-run performs no observable mutation and repeats all dynamic checks on real execution.
- persistence and post-commit restart failures truthfully report committed state.
- focused tests, `npm run check`, and real desktop device-switch verification pass.

## 16. Proposed decisions to confirm

This draft proposes:

1. first slice is exactly `device list/inspect/select`; there is no `device describe`;
2. selection uses exact IDs only, plus literal `default`; labels and substrings are never accepted;
3. select requires both global `expectedRevision` and device `expectedGeneration`;
4. inventory/hotplug changes advance a dedicated generation, not the global revision;
5. selecting unavailable Automatic is allowed while Live is stopped, with a warning;
6. a post-commit restart failure preserves the requested selection and stops Live rather than
   silently rolling back or choosing another source.
