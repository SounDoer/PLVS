# Axis And Chart Viewport Interaction Design Spec

**Date:** 2026-06-25
**Updated:** 2026-06-26
**Status:** Draft update

## Overview

Add direct zoom, pan, reset, and lightweight affordance feedback to PLVS chart axes and chart
areas. The design keeps panel settings as the precision entry point, but makes the visual axes
and chart area usable for day-to-day viewport control.

The updated model separates responsibilities:

- **Axis regions** are single-axis controls.
- **Chart regions** are inspect and snapshot surfaces by default.
- **Chart regions with Ctrl held** become viewport editing surfaces.

This keeps existing snapshot behavior predictable while giving advanced users fast, direct
control over both axes.

## Scope

| Panel       | X / Time Axis                 | Y Axis                        | Chart Area                                                            |
| ----------- | ----------------------------- | ----------------------------- | --------------------------------------------------------------------- |
| Spectrum    | Frequency, log zoom/pan/reset | dB, linear zoom/pan/reset     | Inspect, capture snapshot, X zoom, Y zoom, Ctrl-drag viewport pan     |
| Spectrogram | Time pan/zoom/reset           | Frequency, log zoom/pan/reset | Snapshot timeline gestures, time zoom, Y zoom, Ctrl-drag viewport pan |
| Loudness    | Time pan/zoom/reset           | LUFS, linear zoom/pan/reset   | Snapshot timeline gestures, time zoom, Y zoom, Ctrl-drag viewport pan |
| LevelMeter  | N/A                           | dB/LUFS zoom/pan/reset        | No chart viewport gestures                                            |
| Waveform    | Time pan/zoom/reset           | No Y range                    | Snapshot timeline gestures, time zoom, Ctrl-drag time pan             |
| Vectorscope | N/A                           | N/A                           | No change                                                             |
| Stats       | N/A                           | N/A                           | No change                                                             |

## Core Principles

- No modifier on the chart area preserves the current inspect and snapshot mental model.
- Ctrl on the chart area switches into viewport edit mode.
- Axis regions operate on their own axis directly, regardless of chart snapshot state.
- Drag gestures use content-follows-pointer behavior.
- Wheel gestures use browsing semantics: wheel direction changes the visible range or moves the viewport through the data domain.
- UI feedback stays lightweight: cursor changes, rail highlights, and HelpPopover updates. Do not add chart HUD text for Ctrl hover or wheel actions in this version.

## Axis Region Interaction

Axis hit zones are the visible tick-label rails. They may include modest invisible padding so the interaction is forgiving, but no new permanent UI element is added.

### X Axis / Time Axis

| Gesture      | Direction         | Behavior               | User-visible result                  |
| ------------ | ----------------- | ---------------------- | ------------------------------------ |
| Wheel        | up / deltaY < 0   | Zoom in around cursor  | Visible X span gets smaller          |
| Wheel        | down / deltaY > 0 | Zoom out around cursor | Visible X span gets larger           |
| Drag         | right             | Pan earlier / lower X  | Content follows pointer to the right |
| Drag         | left              | Pan later / higher X   | Content follows pointer to the left  |
| Double-click | any               | Reset X range          | Axis returns to default range        |

### Y Axis

| Gesture      | Direction         | Behavior                 | User-visible result                 |
| ------------ | ----------------- | ------------------------ | ----------------------------------- |
| Wheel        | up / deltaY < 0   | Zoom in around cursor    | Visible Y span gets smaller         |
| Wheel        | down / deltaY > 0 | Zoom out around cursor   | Visible Y span gets larger          |
| Drag         | up                | Pan toward lower values  | Content follows pointer upward      |
| Drag         | down              | Pan toward higher values | Content follows pointer downward    |
| Double-click | any               | Reset Y range            | Axis returns to default range       |

## Chart Area Interaction

### History / Timeline Charts

Applies to Loudness History, Spectrogram, and Waveform-style timeline surfaces.

| Gesture            | Behavior                                          | UI feedback                                                       |
| ------------------ | ------------------------------------------------- | ----------------------------------------------------------------- |
| Hover              | Inspect the time point and value under the cursor | Crosshair and existing hover popover                              |
| Left click         | Select snapshot at the clicked time               | Selection line updates                                            |
| Left drag          | Scrub snapshot time                               | Selection line follows pointer                                    |
| Right drag         | Pan timeline                                      | Existing timeline pan behavior                                    |
| Right double-click | Reset time window and offset                      | Existing reset behavior                                           |
| Wheel              | Zoom time around cursor                           | Time axis briefly active                                          |
| Ctrl + wheel       | Zoom Y axis around cursor                         | Y axis briefly active; Waveform ignores this if no Y range exists |
| Ctrl + left drag   | Pan viewport                                      | Cursor changes to grab/grabbing; snapshot line does not move      |
| Double-click       | Return to live / clear snapshot                   | Existing behavior                                                 |

Ctrl + left drag takes priority over snapshot scrub. While viewport dragging, hide or soften the hover data popover so the UI clearly indicates that the user is editing the viewport, not choosing a snapshot.

### XY Analysis Charts

Applies to Spectrum and future charts where both X and Y viewport ranges are editable.

| Gesture                    | Direction | Behavior                        | UI feedback                        |
| -------------------------- | --------- | ------------------------------- | ---------------------------------- |
| Hover                      | any       | Inspect value                   | Crosshair and existing hover guide |
| Click                      | any       | Capture current snapshot        | Existing behavior                  |
| Double-click               | any       | Return to live / clear snapshot | Existing behavior                  |
| Wheel                      | up        | Zoom X in around cursor         | X axis briefly active              |
| Wheel                      | down      | Zoom X out around cursor        | X axis briefly active              |
| Ctrl + wheel               | up        | Zoom Y in around cursor         | Y axis briefly active              |
| Ctrl + wheel               | down      | Zoom Y out around cursor        | Y axis briefly active              |
| Trackpad horizontal scroll | right     | Pan X toward higher values      | X axis briefly active              |
| Trackpad horizontal scroll | left      | Pan X toward lower values       | X axis briefly active              |
| Ctrl + left drag           | left      | Pan X toward higher values      | Cursor grabbing; X axis active     |
| Ctrl + left drag           | right     | Pan X toward lower values       | Cursor grabbing; X axis active     |
| Ctrl + left drag           | up        | Pan Y toward lower values       | Cursor grabbing; Y axis active     |
| Ctrl + left drag           | down      | Pan Y toward higher values      | Cursor grabbing; Y axis active     |
| Ctrl + diagonal drag       | mixed     | Pan both axes                   | Both axes active                   |

For Ctrl + drag, horizontal and vertical deltas are applied independently. Dominant-axis highlighting may emphasize the larger movement, but diagonal pan should remain possible.

## Snapshot Conflict Rules

| Situation                              | Resolution                                                   |
| -------------------------------------- | ------------------------------------------------------------ |
| Plain left click with minimal movement | Snapshot select or capture, depending on panel               |
| Plain left drag on a timeline chart    | Scrub snapshot                                               |
| Plain left drag on Spectrum            | No viewport pan; existing click/hover behavior stays primary |
| Ctrl held before left down             | Enter viewport drag immediately                              |
| Ctrl held during wheel                 | Y zoom, not X zoom                                           |
| Ctrl + drag in progress                | Do not update snapshot selection line                        |

Use a small drag threshold, around 3 to 5 px, before treating ambiguous pointer movement as a drag. Ctrl-initiated drags do not need the same ambiguity delay because the modifier explicitly requests viewport editing.

## Cursor And Visual Feedback

### Cursor

| State                           | Cursor    |
| ------------------------------- | --------- |
| Chart default hover             | crosshair |
| Chart hover with Ctrl held      | grab      |
| Chart Ctrl-drag in progress     | grabbing  |
| X axis hover                    | ew-resize |
| Y axis hover                    | ns-resize |
| Disabled or no interactive data | default   |

### Axis Rails

Axis rails should show that they are live interaction surfaces without becoming noisy.

| State                        | Feedback                                                |
| ---------------------------- | ------------------------------------------------------- |
| Axis hover                   | Clear muted rail background that visibly marks the hit zone |
| Axis active                  | Highlight tick text only; do not light the rail background |
| Chart wheel X action         | X axis active highlight for a short duration            |
| Chart Ctrl + wheel action    | Y axis active highlight for a short duration            |
| Chart Ctrl + drag horizontal | X axis active highlight                                 |
| Chart Ctrl + drag vertical   | Y axis active highlight                                 |
| Chart Ctrl + diagonal drag   | X and Y axes active highlight                           |

Do not add the following HUDs in this version:

- A "Pan viewport" HUD when hovering the chart with Ctrl held.
- A "Zoom X" or "Zoom Y" HUD after wheel actions.

## HelpPopover

HelpPopover should document both the existing gestures and the new viewport gestures. Keep the current visual language: a lucide CircleHelp trigger button, with custom gesture icons inside the popover for mouse buttons, wheel, keyboard modifiers, and axis chips. Do not replace gesture icons with generic lucide action icons; the current custom icons communicate left button, right button, and wheel more precisely.

Recommended structure:

- Optional section headings such as Snapshot, Viewport, and Axes.
- Compact rows with one gesture icon group and one short text label.
- A small Ctrl keycap chip for modifier gestures.
- Optional X and Y axis chips for axis-specific rows.

### Timeline Help Content

Use for Loudness History and Spectrogram, with wording adapted per value domain.

```text
Snapshot
Left click - Select snapshot
Left drag - Scrub timeline
Left double-click - Return to live

Viewport
Mouse wheel - Zoom time
Ctrl + wheel - Zoom level
Ctrl + drag - Pan viewport
Right drag - Pan timeline
Right double-click - Reset timeline

Axes
Time axis wheel - Zoom time
Time axis drag - Pan time
Y axis wheel - Zoom level
Y axis drag - Pan level
Double-click axis - Reset axis
```

For Spectrogram, replace level with frequency in Y-axis rows.

### Waveform Help Content

Waveform has timeline interactions but no editable Y range.

```text
Snapshot
Left click - Select snapshot
Left drag - Scrub timeline
Left double-click - Return to live

Viewport
Mouse wheel - Zoom time
Ctrl + drag - Pan timeline
Right drag - Pan timeline
Right double-click - Reset timeline

Axes
Time axis wheel - Zoom time
Time axis drag - Pan time
Double-click time axis - Reset time
```

### XY Analysis Help Content

Use for Spectrum.

```text
Inspect
Hover - Inspect value
Click - Capture snapshot
Double-click - Return to live

Viewport
Mouse wheel - Zoom frequency
Ctrl + wheel - Zoom dB
Ctrl + drag - Pan viewport

Axes
X axis wheel - Zoom frequency
X axis drag - Pan frequency
Y axis wheel - Zoom dB
Y axis drag - Pan dB
Double-click axis - Reset axis
```

## Per-Panel Axis Parameters

### Spectrum

|                 | X Axis (Frequency) | Y Axis (dB)     |
| --------------- | ------------------ | --------------- |
| Default range   | 20 Hz to 20 kHz    | -96 dB to 0 dB  |
| Absolute bounds | 20 Hz to 20 kHz    | -120 dB to 0 dB |
| Min span        | 1 octave           | 12 dB           |
| Max span        | Full range         | Full bounds     |
| Scale type      | Logarithmic        | Linear          |

### Spectrogram

|                 | Time Axis                       | Y Axis (Frequency) |
| --------------- | ------------------------------- | ------------------ |
| Default range   | Existing history window default | 20 Hz to 20 kHz    |
| Absolute bounds | Available history/file duration | 20 Hz to 20 kHz    |
| Min span        | Existing history minimum        | 1 octave           |
| Max span        | Available history/file duration | Full range         |
| Scale type      | Linear time                     | Logarithmic        |

### Loudness

|                 | Time Axis                       | Y Axis (LUFS) |
| --------------- | ------------------------------- | ------------- |
| Default range   | Existing history window default | -64 to 0 LUFS |
| Absolute bounds | Available history/file duration | -64 to 0 LUFS |
| Min span        | Existing history minimum        | 12 dB         |
| Max span        | Available history/file duration | 64 dB         |
| Scale type      | Linear time                     | Linear        |

### LevelMeter

|                 | Y Axis                                                    |
| --------------- | --------------------------------------------------------- |
| Default range   | Peak: -60 to +3 dBFS; Momentary/Short-term: -64 to 0 LUFS |
| Absolute bounds | Same as current mode bounds                               |
| Min span        | 12 dB                                                     |
| Max span        | Full range                                                |
| Scale type      | Linear                                                    |

On mode switch, if the user has not manually zoomed, follow the mode default range. If the user has manually zoomed, preserve the user's setting when possible.

## State Model And Persistence

Zoom and pan state is stored in panelControls per panel instance and persisted in the workspace store. Panel settings and gestures read/write the same fields.

Representative fields:

```js
// Spectrum
spectrumXMinFreq: 20;
spectrumXMaxFreq: 20000;
spectrumYMinDb: -96;
spectrumYMaxDb: 0;

// Spectrogram
spectrogramYMinFreq: 20;
spectrogramYMaxFreq: 20000;

// Loudness
loudnessYMinDb: -64;
loudnessYMaxDb: 0;

// LevelMeter
levelMeterYMinDb: -60;
levelMeterYMaxDb: 3;
```

Time-axis viewport state continues to use the existing history window and offset state.

State flow:

- Axis gesture -> panelControls or history viewport update -> re-render -> persistence
- Chart viewport gesture -> panelControls or history viewport update -> re-render -> persistence
- Panel settings -> same panelControls fields -> re-render -> persistence
- Double-click reset -> write default values

## Shared Interaction Hooks

### useAxisInteraction

Owns single-axis gestures for axis rails:

```js
useAxisInteraction({
  axis: "x" | "y",
  min,
  max,
  absMin,
  absMax,
  defaultMin,
  defaultMax,
  minSpan,
  scale: "linear" | "log",
  onRangeChange,
});
```

Responsibilities:

- Gesture recognition for axis wheel zoom, drag pan, and double-click reset.
- Mouse-anchored zoom.
- Linear and log pan/zoom math.
- Bounds and minimum-span clamping.
- Axis measurement for tick density and math.

### Chart Viewport Interaction

Chart-area viewport gestures should reuse the same pure math helpers as useAxisInteraction. They can either be added to a new hook, such as useChartViewportInteraction, or composed in panel-specific hooks where snapshot behavior already lives.

Responsibilities:

- Preserve existing inspect and snapshot behavior for unmodified chart input.
- Route plain wheel to X/time zoom.
- Route Ctrl + wheel to Y zoom.
- Route Ctrl + drag to viewport pan.
- Suppress snapshot scrub/capture while Ctrl viewport pan is active.
- Emit transient axis-active state for rail highlights.

### Relationship To useHistoryInteraction

useHistoryInteraction owns timeline snapshot selection, scrub, right-drag timeline pan, and time-window zoom. The updated design extends it rather than replacing it:

- Plain timeline chart gestures remain in useHistoryInteraction.
- Ctrl + wheel can be added as a Y-axis zoom callback when a panel has a Y range.
- Ctrl + drag can update time viewport plus optional Y range.
- Time-axis rail interaction may share history math but uses a distinct axis hit zone.

## Tick Label Density Adaptation

Axis ticks should remain readable at compact panel sizes and during zoom.

Algorithm:

1. Measure axis pixel length with ResizeObserver.
2. Define minimum spacing per label, approximately 32 px for Y axes and 40 to 48 px for X axes.
3. Select the densest tick set that fits the available pixel length.
4. Always protect endpoints.
5. Drop intermediate labels that would overlap endpoints.
6. Use log-space spacing for frequency axes.

Edge cases:

- Axis too short: show only endpoints.
- Narrow zoom: allow finer ticks than the full-range defaults.
- Endpoint values may be non-integers after pan/zoom; labels should be rounded or formatted with a small number of decimals only when needed.

## Implementation Notes

- Axis rail hover and active highlights should be CSS-level affordances, not additional layout.
- Chart Ctrl hover should change cursor to grab; dragging should change it to grabbing.
- Axis-rail active highlights should be non-lingering and text-only. Rail backgrounds are for hover affordance, not active feedback.
- Trackpad deltas should account for both deltaX and deltaY without making mouse wheels feel erratic.
- Existing tests that source-assert panel layout rows should continue to pass; axis interactivity must not move labels out of their dedicated rows.
- HelpPopover should accept either the current flat string list or a grouped structure during migration so existing call sites can be upgraded incrementally.
