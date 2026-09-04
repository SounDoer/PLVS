# Spectrum Panel Control

Status: Implemented.

## Public controls

Fields, types, units, defaults and bounds are generated from the schema:
[`../generated/panel-spectrum.md`](../generated/panel-spectrum.md). This page carries the
behaviour that a schema cannot state.

## Validation and availability

- `channel` is either `{ "type": "single", "ch": n }` or
  `{ "type": "pair", "x": n, "y": n }`.
- Channel choices must match the choices offered by the product UI for the current topology. Known
  5.1/7.1 topology choices are supported; arbitrary combinations are not.
- Before a device topology is known, PLVS exposes an assumed stereo L/R topology. The schema reports
  `channelTopology.status` as `assumed` or `detected`.
- `view` is `combined`, `lr`, or `ms`. It is only effective for a channel pair. Updating it while a
  single channel remains selected is valid but returns `currentlyInactive`.

The frequency axis is read-only within Panel Control and writable through
[`../axes.md`](../axes.md).

## Analysis

Spectrum and Spectrogram share the Spectrum-like request family. Identical keys share one analysis
request, and there is no request-count cap. Spectrum request identity is affected by channel, view,
speed, and octave smoothing. Tilt, level range, peak labels, and max mode are display-only for
request identity.

The panel reports whether its valid request is active or waiting for channel availability.

## Reset and exclusions

Reset restores the generated defaults and the default linked frequency-axis state. It does not change the
shared Workspace frequency range. Clearing accumulated Max Hold data is a transient chart action and
is outside Panel Control.
