# Device Control

Device Control operates the same requested capture-source selection as the header and tray in the
running PLVS app. It lists the current cached inventory and the running applications, inspects the
requested and effective selection, and selects one exact device, one application, or the Automatic
policy. It never starts PLVS, bypasses the
React owner, or exposes native backend handles.

## Commands

Command syntax and arguments are in [`generated/commands.md`](generated/commands.md).

There is no `device describe` command. `device list` is the dynamic selection schema and returns
the exact IDs accepted by `device select`. The singular `device` family is live-app control; it is
unrelated to the removed standalone `devices` command and to capture-harness internals.

## Inventory and Automatic

`device list` returns one coherent snapshot:

```json
{
  "revision": 12,
  "generation": 3,
  "observedAt": "2026-09-07T10:12:40.000Z",
  "automatic": {
    "id": "default",
    "label": "Automatic",
    "available": true,
    "resolved": {
      "label": "Speakers",
      "sampleRateHz": 48000,
      "channelCount": 2
    }
  },
  "devices": [
    {
      "id": "lb-0123456789abcdef0123456789abcdef",
      "label": "Speakers",
      "kind": "systemOutput",
      "direction": "output",
      "loopback": true,
      "sampleRateHz": 48000,
      "channelCount": 2
    }
  ],
  "applications": [
    {
      "id": "app-00112233445566778899aabbccddeeff",
      "label": "QuickTime Player",
      "kind": "application",
      "sampleRateHz": null,
      "channelCount": null
    }
  ],
  "truncated": false
}
```

System-output rows precede physical or virtual input rows in the GUI's order. Each row contains an
opaque stable ID, display label, `kind`, `direction`, loopback classification, default sample rate,
and channel count. Unknown numeric capabilities are `null`. Results contain at most 256 rows and
each label contains at most 512 Unicode scalar values; `truncated: true` means the internal
inventory was longer.

`applications` lists the running applications offered in the Sources menu's Applications group.
`device list` refreshes them first, as opening Sources does, so an application that has just
started or stopped is reflected. Each row carries only the stable application ID, which survives an
application restart, and its label. Process IDs and window titles stay inside PLVS. Application
capture follows the current default output, so its format is reported as `null` here; read the
measured topology from `measurement inspect`. The list is empty when the platform offers no
application capture or no application is connected to the audio system. Application changes do not
advance the device `generation`. `truncated: true` also covers an application list longer than 256
rows. `app.capabilities.features.device.applications` advertises this support.

`default` means Automatic selection, not a physical row. Its `resolved` summary identifies the
current system-output route when preview succeeds. Automatic remains a valid persisted policy when
no default output can currently be resolved; in that case `available` is false and `resolved` is
null.

## Inspection

`device inspect` returns the same `revision`, `generation`, and `observedAt`, plus:

```json
{
  "selection": {
    "requestedId": "default",
    "mode": "automatic",
    "available": true,
    "resolved": {
      "id": null,
      "label": "Speakers",
      "kind": "systemOutput",
      "sampleRateHz": 48000,
      "channelCount": 2
    },
    "transition": null
  },
  "live": {
    "running": false,
    "transition": null,
    "usingRequestedSelection": false
  }
}
```

`requestedId` is the durable user choice. A newly created additional workbench opens Stopped with
Automatic selected and reports `requestedId: "default"`, `mode: "automatic"`, and
`resolved: null`. An exact selection reports `mode: "exact"` and includes its exact ID in
`resolved`; Automatic reports a null resolved ID because it is a policy. A selected application
also reports `mode: "exact"`, with `kind: "application"` and null format fields in `resolved`. The Live summary says
whether capture is running, whether a device restart is settling, and whether the running engine
has acknowledged the requested selection.

If an exact input or output disconnects, capture stops and `requestedId` stays selected.
While it is missing, `available` is false and `resolved` is null. A selected application that
exits is reported the same way while Sources shows **Selected Application Unavailable**. Reconnecting makes the
device available again. Use `transport live start` to begin a fresh measurement.

## Exact selection and concurrency

`device select` accepts only the literal `default` or one exact, case-sensitive device or application
ID returned by the current `device list`. An application must be running when it is selected. It never accepts a label, index, substring, legacy `out:N`/`in:N` ID, or
fuzzy match. Both concurrency guards are required:

- `--expected-revision` protects the durable requested selection and other controllable app state.
- `--expected-generation` proves the target came from the current inventory observation.

Hotplug, label/capability changes, and Automatic resolution changes advance only the process-local
device `generation`; they do not advance the global revision or wake unrelated `app.wait` calls.
Changing the requested selection advances the global revision once but does not itself advance the
inventory generation. After any inventory change, list or inspect again and issue a new explicit
selection rather than retrying blindly.

A no-op returns `changed: false` without persistence, restart, or revision increment. An effective
stopped selection is persisted through the same owner as the GUI and returns only after the new
selection is observable and durable. If saving the current selection previously failed, selecting
it again retries the write without restarting Live or advancing the revision.

## Live restart and dry-run

Changing the selection while Live is running restarts measurement. A real switch therefore
requires `--allow-measurement-restart`; without it, the command fails with
`confirmationRequired` before preview or mutation. The restart clears the current measurement in
the same way as the GUI device picker. Device Control does not start or stop a File analysis and
does not change the selected LIVE/FILE source.

Use a dry run to validate the current target and preview the restart. Dry-run returns `changed`, `effects`, `warnings`, `confirmationsRequired`, the plan, and predicted
selection/Live state. It performs no restart, persistence, or revision increment. Availability is
still only an observation; the command rechecks generation, presence, preview, global revision,
and runtime availability immediately before a real commit.

While Live is stopped, selecting unavailable Automatic is allowed, persists `default`, and returns
the warning `automaticCurrentlyUnavailable`. The same selection is refused while Live is running
because the engine cannot restart on an unresolved route. An unavailable exact device always
fails.

## Results, settlement, and failures

A successful selection returns `dryRun`, `changed`, `revision`, `generation`, `effects`, `warnings`,
`plan`, and the resulting `state.selection` and `state.live`. Successful non-dry-run completion
means persistence settled and, when required, Live acknowledged the restarted capture.

Stable Device-specific failures are:

- `deviceNotFound` (exit 3): the exact ID is absent.
- `deviceInventoryChanged` (exit 4): `expectedGeneration` is stale.
- `deviceUnavailable` (exit 4): the target cannot currently be previewed or restarted.
- `deviceStartFailed` (exit 1): the new selection committed, but Live restart failed.

`revisionConflict`, `confirmationRequired`, `transitionInProgress`, and `persistenceFailed` retain
their common Agent Control meanings. A selection is refused while Live is starting, stopping, or
already restarting, and while an application update blocks runtime changes.

If persistence or Live restart fails after the React selection committed, the error contains
`stateCommitted: true`, the resulting revision/generation, and current selection/Live state. The
new selection is not silently rolled back and PLVS never substitutes another device. Inspect and
reconcile the partial result.

## Copyable workflows

List devices, then select a USB input using the returned revision and generation:

```powershell
$inventory = npm run --silent desktop:control -- device list --json | ConvertFrom-Json
$usb = $inventory.result.devices | Where-Object { $_.kind -eq "input" -and $_.label -match "USB" } | Select-Object -First 1
npm run --silent desktop:control -- device select $usb.id --expected-revision $inventory.result.revision --expected-generation $inventory.result.generation --json
```

Switch back to Automatic from a fresh inspection:

```powershell
$device = npm run --silent desktop:control -- device inspect --json | ConvertFrom-Json
npm run --silent desktop:control -- device select default --expected-revision $device.result.revision --expected-generation $device.result.generation --json
```

Preview a running Live switch, then explicitly allow the restart with freshly inspected tokens:

```powershell
$device = npm run --silent desktop:control -- device inspect --json | ConvertFrom-Json
npm run --silent desktop:control -- device select <device-id> --expected-revision $device.result.revision --expected-generation $device.result.generation --dry-run --json
npm run --silent desktop:control -- device select <device-id> --expected-revision $device.result.revision --expected-generation $device.result.generation --allow-measurement-restart --json
```

After hotplug, discard old tokens and inspect again:

```powershell
$inventory = npm run --silent desktop:control -- device list --json | ConvertFrom-Json
$inventory.result.generation
```

Use `transport live start/stop` for capture lifecycle. Use `doctor --json` and its
`device-enumeration` check for installation/rig diagnostics; Doctor does not select the running
app's device.
