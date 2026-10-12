# Dock toolbar reveal — design

Date: 2026-10-12

## Problem

Two reports about the Dock header, the transient toolbar beside the meter strip:

1. A user reported that the header gets in the way of clicking controls in another application.
   The header is a full-width window that overlays the work area next to the strip. That area is
   where the neighbouring application keeps its most-clicked controls: a maximised window's title
   bar, tabs and close button when Dock is at the top, a status bar or a DAW transport when it is at
   the bottom. A pointer that overshoots into the strip by one pixel raises the header over the
   control the user was aiming for.
2. The header appears and disappears so readily that it reads as a bug. It shows the instant the
   pointer enters any pixel of the strip and hides the instant the pointer leaves both surfaces.
   Any pass over the strip flashes it, and so does using the strip itself (reading a Stats tip,
   resetting a true-peak maximum).

Both come from one decision: the pointer touching the strip is treated as the user asking for the
toolbar. The strip is a passive monitoring surface parked against other applications' busiest
edge, so that inference is wrong most of the time.

Neither problem was reproduced on a machine while writing this; the analysis is from the code.

## Goals

- The toolbar never appears unless the user asks for it, with one existing exception (an error).
- Pointer movement alone never changes what is on screen.
- The toolbar is laid out like the normal window's header, at Dock's own fixed density.

## Non-goals

- No new toolbar actions. Sources, Views and Settings stay in the normal window.
- No change to the editors' content, sizing or anchoring.
- No global shortcut and no tray item for the toolbar.
- Interface Size does not start affecting Dock. Whether it should is a separate question.
- No Agent Control command to open the toolbar. Visual capture can still target `dock-header`
  while it is open; opening it stays a user action. Adding a command is a separate change with its
  own schema, documentation and contract tests.
- The open toolbar still overlays the neighbouring application. It is opened on purpose and closes
  when the user clicks elsewhere, which is accepted; it is not eliminated.

## Design

### 1. Entry

A persistent column at the right end of the strip, inside the strip window.

- About 20 CSS px wide, as tall as the strip; the whole column is the hit target.
- One icon: a chevron pointing where the toolbar will appear — up when Dock is on the bottom edge,
  down when it is on the top edge. While the toolbar is open the chevron points the other way and
  the button keeps the pressed treatment the header's editor triggers already use
  (`aria-pressed`, `bg-ui-hover text-foreground`).
- Tip: `Show Toolbar` / `Hide Toolbar`.
- The column takes its width out of the module row; modules lay out in the remaining width.
- It is sized in fixed CSS px or `--ui-dock-*` tokens, not with the shell control tokens. The strip
  lives in the main WebView, which does receive the user's Interface Size; an entry built from
  `--ui-shell-h` would grow beside meters that do not.
- `RecordingIndicator` currently sits at the strip's top-right corner. In Dock it moves left by the
  column's width so the two do not overlap.

Right-click, click on empty strip and double-click were considered and rejected: history modules
already use right-click, modules fill the strip and use left-click for resets, and the resize lines
use double-click.

### 2. Toolbar

The toolbar stays the `dock-header` accessory window, full strip width, against the strip's inner
edge. What changes is its presentation, which takes `AppHeader`'s structure:

| Aspect    | Today                                   | After                                                        |
| --------- | --------------------------------------- | ------------------------------------------------------------ |
| Layout    | One centred group                       | Transport at the left, notice after it, actions at the right |
| Height    | Fixed 44 px                             | Fixed 36 px                                                  |
| Surface   | `bg-background`, top and bottom borders | `--ui-surface-panel`, no divider lines                       |
| Icon size | `size-3.5` (14 px)                      | `--ui-icon-shell-action` (14 px here)                        |

`DockHeader` reuses the layout classes from `src/lib/shellLayout.js` rather than copying their
values, so a later change to the normal header carries over. The two headers remain separate
components: the Dock header runs in its own WebView, receives a serialisable snapshot and sends
actions back.

The set of actions is unchanged: Clear, Loudness Profile, Modules, Reserve Screen Space, edge
switch, Restore Window, Presets.

**Density is Dock's own.** Dock accessory WebViews are pinned to the Small interface profile
(`resolveInterfacePreferencesForSurface`), whatever Interface Size the user chose, and the strip
sizes itself from `--ui-dock-*` tokens keyed to its height. The shell tokens the shared classes
read therefore resolve to constants in the header: a 28 px control row with 4 px of padding above
and below, which is the 36 px in the table and the height of the normal header at Small. The goal
is consistency among the three things on screen together — entry, header, editor — not with a
normal window that is never visible at the same time.

The window height stays a Rust constant, `DOCK_HEADER_LOGICAL_HEIGHT`, changed from 44 to 36.
Agent Control's `accessoryGeometry.dockHeader.height` literal changes with it. A header 8 px
thinner also covers that much less of the neighbouring application.

### 3. Visibility rules

The toolbar is shown when any of these holds:

- the user opened it from the entry;
- an editor is open;
- the current notice is an error (existing behaviour; the toolbar cannot be dismissed while the
  error stands).

The user-opened state is cleared by:

- clicking the entry again;
- Escape in the strip or the header. With an editor open, Escape closes the editor first and a
  second Escape closes the toolbar;
- focus leaving all three PLVS Dock windows (strip, header, editor). Moving focus between the three
  does not close it, so strip actions such as a true-peak reset keep working with the toolbar open;
- Dock becoming inactive (exit, suspension), as today;
- on Windows, the strip yielding to a full-screen window.

Clicking the entry while an editor is open closes the editor and the toolbar together.

The state is not persisted. Entering Dock always starts with the toolbar closed.

Pointer enter and leave no longer feed visibility at all.

**Focus.** Today the header is shown without taking focus. To observe "focus left PLVS" the header
takes focus when the user opens it, as the editor already does. Closing on focus loss uses a short
grace period so that focus moving from one PLVS Dock window to another is not seen as leaving; the
editor's existing blur delay is the model.

### 4. Removed

- Strip and header `pointerenter` / `pointerleave` reporting, and the accessory pointer event that
  carried it (`emitDockAccessoryPointer` and its listener), unless another consumer is found during
  implementation.
- The 33 ms cursor reconciliation loop in `useDockAccessoryVisibility`.
- The `cursor_over_dock_surfaces` command, its IPC wrapper and tests.
- `shouldShowDockHeader`'s `stripInside` / `headerInside` inputs.

`cursor_over_dock_surfaces` also returned "not over Dock" while the strip was yielded to a
full-screen window, which kept the header from rising over that window. With no hover trigger that
guard has nothing left to guard, but an already-open toolbar must still go away when the strip
yields; that is the last bullet under "cleared by" above.

### 5. Components touched

| Unit                                     | Change                                                                      |
| ---------------------------------------- | --------------------------------------------------------------------------- |
| `src/dock/DockStrip.jsx`                 | Renders the entry column; drops the pointer enter/leave props               |
| `src/dock/useDockAccessoryVisibility.js` | Explicit open state and the rules in section 3; loses presence and the poll |
| `src/dock/accessoryVisibility.js`        | `shouldShowDockHeader` takes `userOpen`, `editorOpen`, `forceVisible`       |
| `src/dock/accessories/DockHeader.jsx`    | Layout and tokens from `shellLayout`; Escape and focus-loss actions         |
| `src/dock/DockAccessoriesContext.jsx`    | Wires the toggle and the new actions; header geometry literal becomes 36    |
| `src/components/RecordingIndicator.jsx`  | Offset in Dock                                                              |
| `src-tauri/src/dock_accessories.rs`      | Focus on user-open; removes the cursor command                              |
| `src-tauri/src/dock.rs`                  | `DOCK_HEADER_LOGICAL_HEIGHT` becomes 36                                     |
| `src-tauri/src/appbar.rs`                | Yielding notifies the frontend so an open toolbar closes                    |

## Documentation

Updated in the same commits as the behaviour:

- `docs/user/workspace.md`, Dock: "Hovering the strip shows a header" becomes the entry and its
  dismissal rules.
- `docs/architecture.md`, "Dock three-window boundary": the header is 36 logical px and shown on
  request, and the paragraph about the hover poll during full-screen yield is replaced.

## Testing

- `useDockAccessoryVisibility.test.jsx` is rewritten around section 3: one test per show condition
  and per clearing trigger.
- `accessoryVisibility.test.js` follows the new inputs.
- `DockStrip.test.jsx`: the entry renders, toggles, flips its icon with edge and state.
- `DockHeader.test.jsx`: layout groups, Escape.
- Rust: existing `dock_accessory_rects` tests follow the 36 px constant.
- Rendering: cold start, then Agent Control screenshots of `main` and `dock-header` before and
  after, compared by pixels. The toolbar is opened with a real click for these.
- By hand on Windows: open, each way of closing, strip interaction with the toolbar open, error
  forcing it open, full-screen yield closing it, and Interface Size at Extra Large leaving the entry
  and the header unchanged.
- By hand on macOS (needs the user's machine): the header taking focus, and focus loss closing the
  toolbar. This path is unverified on macOS and is the main risk in the design.

## Open risks

- **macOS focus.** Whether an accessory `NSWindow` that takes focus on open reports blur reliably
  when the user clicks another application is not known. If it does not, the fallback is to close on
  the entry and Escape only on macOS, and to say so in the user guide.
- **Entry column and narrow strips.** On a narrow monitor with many modules the column competes
  with module minimum widths. The existing overflow behaviour of the module row applies; it is
  checked by hand rather than designed for here.
