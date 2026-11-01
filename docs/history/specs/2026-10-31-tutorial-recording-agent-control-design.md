# Tutorial recording through Agent Control — design

Status: approved 2026-10-31. Implemented on Windows except macOS Dock region recording (T9), which
awaits the Mac; macOS refuses `--target dock` until then. Pointer movement on macOS is untested.

## Goal

Record every planned PLVS tutorial episode unattended against the real app, without returning to
build features mid-series. Agent Control already opens every toolbar menu, sizes the window and
records the WebView with the system pointer (`visual recording start --cursor visible`). The user
chose a real pointer that moves but never clicks (T1); everything else a viewer sees must then be
producible by commands, at a pace that reads as a person using the app.

The general gaps were closed first
([2026-10-31-agent-control-gap-closure-design.md](2026-10-31-agent-control-gap-closure-design.md)).
Video production lives in the PLVS-Promo repository.

## Audit: what each episode needs

Episodes follow the user guide. "Pointer" means the pointer must be able to travel to the element;
"Show" means a temporary surface must open; "Action" means a state change needs a command; "Pace"
means a command applies instantly where a person would take visible steps.

| Episode                            | Shots                                                                                        | Available today                                        | Missing                                                                                                                                                               |
| ---------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Quick Tour                       | Invitation, ten steps, toolbar buttons, Panel Settings, history                              | Menus, Panel Settings, transport, Snapshot, Settings   | Pointer to toolbar, panel and tour buttons; tour steps                                                                                                                |
| 2 Signal Source                    | Sources menu, expand Output / Input / Applications, pick a source                            | Sources menu, `device select`                          | Pointer to group headers and rows; Show an expanded group                                                                                                             |
| 3 Panels                           | Header actions, Panel Settings rows and dropdowns, gesture help, chart gestures, hover probe | Panel and axis updates, Snapshot, camera controls      | Pointer to header actions, settings rows, chart areas; Show dropdowns and gesture help; Action clear Max Hold, reset TP Max and Slow Trace; Pace zoom, pan and rotate |
| 4 Workspace & Presets              | Add Panel, split and move panels, save and apply Presets                                     | `workspace apply`, `preset save / apply`               | Pointer to Panels menu rows and Preset rows; Show the Add Panel list; Pace layout moves; typing a Preset name                                                         |
| 5 Views & Dock                     | Views switches, Dock entry, Dock toolbar and editors                                         | View and Dock commands, Dock menus                     | Pointer to Views switches and Dock controls; recording Dock windows                                                                                                   |
| 6 Loudness Profiles                | Select, create and edit a profile                                                            | Profile commands, editor drafts                        | Pointer to profile rows and editor fields; typing a name                                                                                                              |
| 7 File Mode                        | Open a file, scrub, export a report                                                          | `transport source file`, `file analyze`, `file report` | Pointer to Open file, timeline and report actions                                                                                                                     |
| 8 Settings, Multichannel, Dialogue | Settings sections and controls, channel layout, detector                                     | `ui show settings`, `settings update`                  | Pointer to section tabs and controls; Show a Settings dropdown                                                                                                        |

Not producible and left to the edit: keyboard shortcuts (a keycap caption), dropping a file from
Finder, the system file dialog.

## Decisions

### T1 The real pointer moves; actions stay commands

`pointer move` moves the operating system pointer to a named element along a smooth, timed path. It
never presses, scrolls or types. The action that follows goes through its Agent Control command, so
the app changes state exactly as it does today, and hover feedback, hover tips and the chart hover
probe appear in the recording by themselves. An ADR records the boundary
(`docs/adr/0042-tutorial-pointer-moves-but-never-clicks.md`): Agent Control may move the pointer,
never press, scroll or type, because injected presses can land in other applications.

Windows moves the pointer with `SetCursorPos`, which the system follows with mouse-move messages. On
macOS `CGWarpMouseCursorPosition` moves it without a prompt but may not deliver mouse-moved events
to the WebView; posting them needs Accessibility permission for the recording build. This is tested
on the Mac first. Linux advertises no pointer movement.

### T2 Named pointer targets, registered by the components that own them

A closed table cannot grow to every row of every menu, so targets are registered the way UI surfaces
are: the component that renders an element names it with a semantic id, and Agent Control resolves
only names that a mounted component registered. No selector, label text or coordinate is accepted.
Target ids are a kind plus an owner key, for example `toolbar:presets`, `panel:<panelId>:settings`,
`preset:<presetId>`, `source:<deviceId>`, `source-group:output`, `view:alwaysOnTop`,
`settings-section:appearance`, `setting:interfaceSize`, `panel-control:<panelId>:<controlKey>`,
`quick-tour:next`. `ui targets` lists the currently registered ids, so a script can discover a row's
id from the same identifiers the owning family reports (`preset list`, `device list`). Toolbar,
panel and tour targets reuse `data-tour-target`.

Covered surfaces: toolbar and status entry; panel header actions and chart areas; every toolbar menu's
rows and its add / create controls; Settings sections and their controls; Panel Settings rows; the
Loudness Profile and Theme editors' fields; file summary actions; Quick Tour buttons; the Dock strip,
toolbar and editor rows.

### T3 `ui locate`

Returns a registered target's visibility and rectangle in CSS pixels relative to its capture target,
so scripts can check a shot and the edit can place captions.

### T4 `pointer move`

`pointer move --target <id> [--duration-ms <n>] --expected-revision <n>` moves the pointer to the
target's centre on an eased path, default 600 ms, 0 to 3000 ms, and returns on arrival. Dock targets
in accessory windows are converted with that window's position. Refused when the target is hidden.
It changes neither revision nor UI generation.

### T5 Quick Tour steps

`ui quick-tour start|next|back` call the tour's own handlers. `start` is Start Tour, or the Settings
footer link when no tour is on screen; `next` is Next or Finish; `back` is Back. No jump to a step.
This reverses the onboarding design's choice for these three buttons only.

### T6 Show the intermediate surfaces a click opens

New `ui show` targets for what a viewer sees between the pointer arriving and the result:

- `panel-help --panel-id`: the panel's gesture reference (also a general Agent Control gap);
- `source-group --group <output|input|applications>`: an expanded Sources group;
- `add-panel`: the Panels menu's Add Panel list;
- `dropdown --target <id>`: an open single-choice dropdown in Settings or Panel Settings.

Each is a navigable surface closed by `ui close`, and opens through the same handler as a click.

### T7 Every chart gesture has a command

The criterion is the panel gesture reference (`src/components/panels/chartHelp.js`), which already
lists every chart gesture a user can make: each entry must be reproducible on camera, either by a
command or by the pointer itself. Today's mapping:

- Snapshot select, capture and Return to Live, and scrubbing: Transport's Snapshot commands, scrubbing
  paced by T8.
- Zoom, pan and reset of every axis, timeline and viewport: Axis Control, paced by T8.
- Rotate, height scale and reset viewpoint: the Spectrogram camera controls in Panel Control, paced
  by T8.
- Inspect Value: the hover probe, produced by the pointer resting on the chart.
- Clear Max Hold, Reset Max Hold and Reset TP Max: new `measurement reset-hold --panel-id` and
  `measurement reset-true-peak-max`, through the functions the clicks call.
- Slow Trace (press and hold): new `panel hold-slow --panel-id --duration-ms`, which presses and
  releases the hold through the same handlers as the pointer, for a bounded time.

A coverage test fails when a gesture id in the reference has no mapping, the same way
`panelControlCoverage.test.js` guards panel controls, so a future gesture cannot ship without one.
The general round's "toggle the mode instead" workaround for Max Hold is withdrawn: on camera it
shows the wrong thing.

### T8 Paced changes

A person's zoom, pan or rotate is gradual. `--steps <n>` and `--duration-ms <n>` on `axis` updates
and on camera controls apply the change as evenly spaced intermediate updates through the same
business path, so the recording shows motion while the pointer travels. Layout moves and Preset
names are shown as single changes, with the pointer moving over the drop target or field first;
typing text is not simulated (Agent Control has no form setters).

### T9 Recording the Dock

`visual recording start --target dock` records the screen rectangle covering the strip, the toolbar
and an open editor, with the same screen capture the existing recorder uses for the main window (on
macOS it already needs Screen Recording permission). Dock screenshots stay per-WebView. Because the
rectangle is screen pixels, what lies behind transparent Dock surfaces is recorded too, so Dock
episodes use an opaque surface or a prepared desktop.

### T10 First-run recording state

No app change: the dev identity build of the release commit on an empty `--plvs-test-app-data-root`
(ADR 0035) shows the Quick Tour invitation with Agent Control enabled. The recipe goes into the
PLVS-Promo repository.

## Synchronization

New wire methods `ui.locate`, `ui.targets`, `pointer.move`, `ui.quickTour.start|next|back`,
`ui.show.panelHelp`, `ui.show.sourceGroup`, `ui.show.addPanel`, `ui.show.dropdown`,
`measurement.resetHold`, `measurement.resetTruePeakMax`, `panel.holdSlow`, the paced options and the `dock` recording
target; handlers, Rust grammar and native pointer movement and region capture; capabilities;
generated reference; family pages, a new `pointer.md`, README table and `docs/user/cli.md`; the ADR;
contract tests and the acceptance catalogue.

## Delivery

The work lands in four commits groups, in this order, so episode 1 is unblocked first: (1) T1–T5,
(2) T6–T7, (3) T8, (4) T9. Each group is tested on Windows; T1 and T9 also on the Mac before the
release.

## Risks

- macOS hover after a warp (T1) and macOS Screen Recording for region capture (T9).
- Target registration spreads through many components; a coverage test lists every registered kind
  and fails when a surface in the covered list registers none.
- A pointer move while the user works takes their pointer; the command is for unattended recording.
