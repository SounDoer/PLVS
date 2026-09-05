# Dock Control

Status: Approved design contract

Dock Control owns the running application's Dock window form, ordered Dock panel layout, panel
sizes, and the public controls rendered in the strip. It does not own the LIVE/FILE source or
capture lifecycle; those remain Transport Control responsibilities.

## Commands

```powershell
npm run desktop:control -- dock describe --json
npm run desktop:control -- dock inspect --json
npm run desktop:control -- dock enter --expected-revision 12 --json
npm run desktop:control -- dock enter --edge top --monitor <monitor-id> --height 72 --expected-revision 12 --json
npm run desktop:control -- dock exit --expected-revision 12 --json
npm run desktop:control -- dock layout apply <file|-> --expected-revision 12 --json
npm run desktop:control -- dock panel describe <panel-id> --json
npm run desktop:control -- dock panel update <panel-id> <file|-> --expected-revision 12 --json
npm run desktop:control -- dock panel reset <panel-id> --expected-revision 12 --json
```

Every mutation supports `--dry-run` and requires `--expected-revision`. Dock entry also accepts
`--reserve-space true|false`. App Control uses the normal Workspace and Dock persistence paths; it
does not edit either store from Rust behind the running frontend.

The verbs deliberately separate configuration from window-mode transitions. `layout apply` may
prepare the strip while the normal window is visible, but never enters or exits Dock. `enter` and
`exit` never replace the panel layout.

## Description and inspection

`dock.describe` returns platform support, current option availability, the dynamic monitor choices,
height constraints, the canonical module catalog, per-module width constraints, and the input
schema for layout apply. It does not expose legacy persisted module IDs or React component details.

`dock.inspect` remains available even when Dock is unsupported and returns:

- top-level revision and compact active-Preset relationship;
- `supported`, `enabled`, `edge`, resolved monitor, reserve-space setting, height, and read-only
  height mode (`compact`, `standard`, or `expanded`);
- ordered Dock panels with ID, canonical module ID, resolved title, optional custom title, effective
  width, complete public Dock controls, and compact analysis status;
- read-only runtime state such as temporary suspension while the application window is hidden.

Suspension, resize previews, accessory-window state, raw geometry, native window handles, and
internal legacy `modules`/control records are not writable public state.

## Enter and exit

Dock is supported on Windows and Linux and unavailable on macOS. Unsupported mutation fails with
`controlUnavailable`; describe and inspect still explain the condition. Reserve-space control is
available only on Windows. Supplying it elsewhere is an error rather than silently coercing it.

`dock enter` uses saved values for omitted options. Submitted edge is exactly `top` or `bottom`.
Height is an integer from 56 through 160 CSS pixels; App Control rejects values outside this range
instead of applying the GUI drag handle's clamp. If a monitor ID is explicitly submitted and no
longer exists, entry fails with `monitorNotFound`. When it is omitted, PLVS deliberately resolves
the saved monitor, then the current/primary monitor, and reports any fallback as a warning.

Entry is refused before mutation when:

- the selected source is FILE (`fileModeActive`);
- a shared blocking editor such as Loudness Profile or Theme editor is open (`editorActive`); or
- another Dock window-form transition is in progress (`transitionInProgress`).

There is no flag to discard an editor draft and no implicit switch to LIVE. Entering an already
enabled Dock with the same resolved form is a no-op. Supplying different valid form options updates
the active Dock through the same serialized native transition path.

`dock exit` restores the normal window's saved decorations, always-on-top value, and bounds in the
required order. It is a no-op when already outside Dock. Exit is never editor-blocked and does not
change source, capture state, LIVE history, FILE results, or the Dock panel layout.

A successful enter or exit is returned only after native acknowledgement and persistence of the
Dock form. A native failure does not claim the requested mode; the error reports the observable
current form and the caller should inspect before retrying.

## Layout replacement

`dock layout apply` atomically replaces the ordered strip layout without changing whether Dock is
enabled. Its document has one ordered `panels` array:

```json
{
  "panels": [
    {
      "panelId": "transport",
      "customTitle": null,
      "width": 120,
      "controls": {}
    },
    {
      "key": "new-spectrum",
      "moduleId": "spectrum",
      "width": 360,
      "controls": {
        "speedPercent": 40
      }
    }
  ]
}
```

The public module IDs are `transport`, `levelMeter`, `loudness`, `stats`, `vectorscope`, `spectrum`,
`spectrogram`, `waveform`, and `stereo-map`. Legacy storage names such as `level`, `correlation`, or
`stereoMap` are not accepted. Multiple instances of a module and an empty layout are valid.

An existing entry uses `panelId` and preserves that instance. A new entry uses a request-local,
non-empty, unique `key` plus `moduleId`; PLVS generates an available ID, returns it in the resulting
layout, and maps the key under `createdPanels`. This mirrors Workspace layout apply and avoids
letting callers manufacture persisted IDs. Generated IDs in dry-run are advisory because an
intervening mutation may consume one. List order is display order.

`customTitle` follows the GUI naming behavior: null or a trimmed non-empty string; null restores the
module title. `width` is optional. When present, it must be a finite integer within that module's
described minimum and maximum preferred width; omission restores responsive/default sizing. The
current constraints are:

| Module        | Min | Default | Max preferred | Growth   |
| ------------- | --: | ------: | ------------: | -------- |
| `transport`   |  90 |     120 |           180 | fixed    |
| `levelMeter`  | 140 |     180 |           420 | fixed    |
| `loudness`    | 154 |     200 |           480 | fixed    |
| `stats`       | 160 |     240 |           420 | fixed    |
| `vectorscope` | 160 |     220 |           360 | fixed    |
| `spectrum`    | 180 |     360 |           960 | flexible |
| `spectrogram` | 180 |     320 |           960 | flexible |
| `waveform`    | 160 |     300 |           960 | flexible |
| `stereo-map`  | 180 |     360 |           960 | flexible |

Controls are partial patches over each new or retained panel's current/default controls. They use
the same public names, strict validation, dynamic channel choices, dormant-control warnings, and
analysis-request semantics as the corresponding Workspace panel, but only the subset rendered by
Dock is accepted. `dock.describe` and `dock panel describe` are authoritative for that subset.

Two Dock-only groups are public: Level Meter adds `readout` (`live`, `truePeakMax`, or
`playbackMax`) and `showLabels`; Loudness adds `showReadouts`. The Level Meter readout must be
compatible with its meter mode. Transport has no public Dock controls.

The complete document is validated before one state commit. Unknown fields, duplicate existing
panel references or request keys, unknown modules, invalid controls, invalid channel selections,
and out-of-range widths fail together as `invalidDockLayout` issues. App Control does not
normalize, drop, clamp, or silently repair them.

## Individual panel control

`dock panel describe` returns the selected instance, its Dock-only control schema, current values,
width constraints, and analysis state. `dock panel update` accepts a direct public-control patch,
without a `controls` wrapper. It does not rename, resize, reorder, add, or remove the panel.

`dock panel reset` matches the Reset button in that Dock module's settings: it resets only the
instance's public Dock controls. It does not change width, title, order, measured history, source,
or window form. Unknown or control-less targets use stable `dockPanelNotFound` or
`controlsUnavailable` failures rather than successful false values.

## Revision, persistence, and Preset state

Dock is part of the visible Workspace scene but uses the same global revision as every other public
control domain. Effective form, layout, size, title, or control changes increment it once per
command. They also mark an active Preset dirty through the same GUI path; the result includes the
resulting Preset relationship under `state.preset`.

`--expected-revision` guards every mutation. Any concurrent observable state change, including a
Preset Apply or Preset collection edit, is therefore caught. No-op, dry-run, validation failure,
preview resizing, and internal suspend/resume do not increment revision or dirty the Preset.

Normal success means React state, native Dock state where applicable, Workspace persistence, and
Dock-form persistence have completed. There is no `persisted` boolean. If an unpredictable native
or persistence failure occurs after a partial commit, the error reports `stage`, `partial`, changed
paths under `error.details.changed`, and the current revision; the caller inspects rather than
blindly retrying.

## Results and dry-run

Mutation results contain `dryRun`, boolean `changed`, top-level `revision`, `warnings`, effects,
the complete resulting Dock snapshot under `state.dock`, and compact Preset relationship under
`state.preset`. A no-op has `changed: false` and performs no persistence or native call.
Successful `result.changed` is always boolean; the `error.details.changed` field used for a partial
failure is an array of public path strings.

Dry-run performs the same schema, dynamic option, editor, FILE-mode, revision, monitor, diff,
warning, and analysis-request checks and returns the projected complete Dock snapshot. It does not
change React/native state, allocate panel history, enter/exit Dock, increment revision, dirty a
Preset, or persist. OS behavior that cannot be known until the native transition is attempted is
not guaranteed by a successful dry-run.

Dock analysis requests share and deduplicate matching keys with Workspace panels and other Dock
instances. There is no request-count cap or priority eviction. Layout/panel changes may be prepared
outside Dock and may be made while Dock is active; changing analysis controls does not restart LIVE
capture or retroactively reanalyze completed FILE sessions.
