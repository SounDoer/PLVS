# Pointer Control

Pointer Control moves the operating-system pointer onto a named PLVS control for unattended
tutorial recording. It never presses, scrolls or types ([ADR 0042](../adr/0042-tutorial-pointer-moves-but-never-clicks.md));
the operation that follows is an ordinary Agent Control command.

Command syntax and arguments are in [`generated/commands.md`](generated/commands.md).

## Targets

A target is a name that a mounted component declared, never a selector, label or coordinate. Names
are a kind and a key, such as `toolbar:presets`, `panel:<panelId>:settings` or `quick-tour:primary`.
`ui targets` lists the names currently on screen and `ui locate --target` reports one target's
rectangle in CSS pixels relative to the main WebView; see [UI Navigation](ui.md).

| Kind                                        | Names                                                                                                                            |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `toolbar`                                   | `transport`, `clear`, `sources`, `open-file`, `loudness-profile`, `panels`, `views`, `presets`, `settings`, `status`             |
| `panel`                                     | `panel:<panelId>` and its parts `settings`, `help`, `pin`, `fullscreen`, `close`, `body`, `history`, plus `panel:<panelId>:tab`  |
| `panel-control`                             | `panel-control:<panelId>:<control>`, one per Panel Settings row; a dropdown row names its trigger                                |
| `source-group`, `source`                    | Sources groups `output`, `input`, `applications`; `source:<deviceId>` rows as `device list` reports them, and `source:default`   |
| `panels-menu`, `add-panel`                  | `panels-menu:<panelId>` rows and `panels-menu:add`; `add-panel:<moduleId>` in the Add Panel list                                 |
| `preset`, `presets-menu`                    | `preset:<presetId>` rows; `presets-menu:name` and `presets-menu:add`                                                             |
| `loudness-profile`, `loudness-profile-menu` | `loudness-profile:<profileId>` and `loudness-profile:off` rows; `loudness-profile-menu:add`                                      |
| `view`                                      | `alwaysOnTop`, `hidePanelHeaders`, `hideAxesAndLabels`, `hideWindowFrame`, `autoHideControls`, `surfaceOpacity`, `glass`, `dock` |
| `settings-section`, `setting`               | One per Settings section; `setting:<id>` uses the Settings control catalogue ids, such as `setting:appearance.interfaceSize`     |
| `file-report`                               | `export`                                                                                                                         |
| `quick-tour`                                | `primary` (Start Tour, Next or Finish), `back`, `close`, `dismiss` (Not Now)                                                     |
| `dock`                                      | `transport`, `toolbar`, `restore` in the strip's right control column                                                            |

## Moving

`pointer move --target <id> [--duration-ms <n>]` moves from wherever the pointer is to the centre
of the target along an eased path and returns when it arrives. The default is 600 ms; 0 jumps.
Hidden targets fail with `uiTargetNotVisible` and undeclared ones with `uiTargetNotFound`. A move
leaves the global revision and the UI generation unchanged, but requires `--expected-revision`.

The pointer moves for real: hover feedback, hover tips and chart hover probes appear because the
pointer rests there. While a move runs, the pointer is not the user's.

## Platforms

Windows moves the pointer with `SetCursorPos`, which the system follows with ordinary mouse-move
messages. macOS warps it and posts a mouse-moved event; the event, and with it hover, needs
Accessibility permission for the running build. Linux reports the capability as unavailable,
matching its recording, which cannot include the pointer.
