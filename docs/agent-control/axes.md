# Axis Control

Status: Approved design contract

Axis Control changes the linked frequency and time viewports used by Workspace charts. It is
separate from Panel Control because one linked-axis edit may intentionally move several panels at
once. Dock panels do not participate in Workspace linking; their independent ranges remain Dock
panel controls.

## Commands

```powershell
npm run desktop:control -- axis describe --json
npm run desktop:control -- axis inspect --json
npm run desktop:control -- axis shared update frequency <file|-> --json
npm run desktop:control -- axis shared update time <file|-> --json
npm run desktop:control -- axis shared reset frequency --json
npm run desktop:control -- axis shared reset time --json
npm run desktop:control -- axis panel update <panel-id> frequency <file|-> --json
npm run desktop:control -- axis panel update <panel-id> time <file|-> --json
npm run desktop:control -- axis panel reset <panel-id> <frequency|time> --json
```

Every mutation supports `--dry-run` and `--expected-workspace-revision`. There is no generic screen
coordinate, wheel, drag, or zoom command; App Control expresses the final semantic viewport.

## Public model

Field types, defaults and bounds are generated from the schema:
[`generated/axes.md`](generated/axes.md). Spectrum, Spectrogram, and Stereo Map share the frequency
axis even though its visual orientation differs in each panel.

`windowSec` is the visible duration; `offsetSec` is the non-negative distance back from the newest
available sample, where zero means the live edge or the end of a FILE result. The maximum valid
window and offset are dynamic, bounded by current history retention and available LIVE/selected FILE
data, and `axis describe` reports the bounds that currently apply. App Control rejects an
out-of-range request instead of silently clamping it, while an ordinary no-data state still accepts
the default viewport for future samples.

## Shared viewport

`axis shared update` changes the stored Workspace viewport for that kind. Every currently linked
member immediately uses it; unlinked members keep their local ranges. `shared reset` restores
frequency to 20–20000 Hz and time to 60 seconds at offset zero. Reset does not link or unlink any
panel.

These commands target the shared viewport even when zero or one panel is currently linked. This is
intentional preparation, is visible in inspection, and is not treated as a no-op when the stored
shared value changes.

## Panel membership and local viewport

`axis panel update` accepts:

```json
{
  "linked": false,
  "range": { "minHz": 200, "maxHz": 5000 }
}
```

For time, `range` uses `windowSec` and `offsetSec`. The target panel must support the named axis.
Both fields are optional, but at least one is required.

- `linked: false` leaves the group while preserving the effective shared range, then applies an
  optional local range in the same atomic commit.
- `linked: true` joins the group. If another panel is already linked, the joiner adopts the existing
  shared viewport. If it is the first participant, its local viewport seeds the group.
- A local `range` is valid only when the panel is unlinked in the final state. Supplying it with
  `linked: true` is an error; callers use `axis shared update` when they intend to move the group.
- Omitting `linked` retains current membership, so `range` is refused if the panel is currently
  linked rather than unexpectedly moving other panels.

`axis panel reset` restores that panel's dormant local viewport to the module default and links the
panel. Joining still follows the group-seeding rule above. This is the axis portion of the full
`panel reset`; it does not reset any other public panel control.

## Description and inspection

`axis.describe` returns the two axis schemas, defaults, dynamic time bounds, current source, and the
canonical modules that may participate. `axis.inspect` returns Workspace revision, both stored
shared viewports, and for every participating panel: ID, module ID, linked state, effective source
(`workspace` or `panel`), effective range, and dormant local range. It returns values rather than
schema metadata.

The axis objects embedded in `app.inspect` and panel snapshots use the same effective shape and set
`writable: true` once Axis Control is implemented. `panel.describe` continues to identify the
matching axis and constraints, but `panel update` does not accept axis fields.

## Effects, revision, and persistence

Frequency and time viewport edits change display navigation only. They do not restart capture,
reanalyze a FILE session, rebuild an analysis request, clear data, or allocate a history slab.
Changing time range never changes Transport source or lifecycle.

An effective shared/local range or membership change increments `revisions.workspace` once, marks
an active Preset dirty, and persists through the normal Workspace path. The committed end of a GUI
axis gesture follows the same rule; high-frequency pointer previews and the naturally moving LIVE
edge do not increment revision. A no-op does none of these things.

Results contain `dryRun`, Workspace revision, deterministic changed paths, warnings, the complete
resulting axis snapshot, and compact Preset relationship. Normal success implies persistence; there
is no `persisted` field.

Dry-run performs the same target, revision, membership, dynamic-bound, final-state, warning, and
diff checks but does not change viewports, membership, revision, Preset state, or persistence.
Validation is atomic. Failures use stable reasons including `axisNotFound`, `axisUnavailable`,
`panelNotFound`, `revisionConflict`, and `invalidAxis`, with all independently discoverable input
issues returned together.
