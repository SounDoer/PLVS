# Loudness Panel Control

Status: Implemented.

## Public controls

Fields, types, units, defaults and bounds are generated from the schema:
[`../generated/panel-loudness.md`](../generated/panel-loudness.md). This page carries the
behaviour that a schema cannot state.

When the active Profile provides no loudness reference, `reference` is omitted from both the
public value and the schema's available options.

## Validation and availability

- `layers` is a complete set replacement. It may be empty, contains no duplicates, and is emitted
  in a fixed canonical order.
- Public `reference` maps to the internal `ref` identifier.
- If the active Profile does not provide a reference, submitting `reference` fails with
  `controlUnavailable`. It is not accepted as a dormant setting with a warning.
- The hidden internal reference preference may remain stored so it can reappear when a suitable
  Profile is enabled. Updating visible layers while Profile is off must not accidentally erase it.

The time axis is read-only within Panel Control and writable through
[`../axes.md`](../axes.md).

## Reset

Reset restores the normal layer defaults and loudness range, plus the default time-axis link. The
public response still only includes options available under the current Profile. Reset does not
change the shared Workspace time range or the active Profile.
