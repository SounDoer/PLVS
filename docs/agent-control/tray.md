# Tray Control

Run `tray inspect --json` against the Workbench that owns the Tray. In a session with several
Workbenches, discover the instance IDs with `instances` and check each Workbench's `capabilities`.
The owner advertises `features.tray`; the remaining Workbenches respond with `controlUnavailable`.

The result includes the nested menu `items`, stable keys for the current instance and choices,
enabled and checked states, and the current `presentation`. Treat the keys as opaque and read the
tree again when its generation changes. A single Workbench has its actions at the root. Additional
Workbenches each have a branch.

## Windows and macOS

The owner advertises `features.tray.panel` and reports `presentation: panel`. The result includes
native `visible` and the settled `navigation`, with `branchKey`, `pickerKey`, and open `groupKeys`
when applicable.

- `tray open` opens the actual Tray panel at the icon. The optional `--item` accepts a Workbench
  branch, Source or Preset picker, or Source group key. The command settles after that page renders.
- `tray activate --item <item-id>` invokes an enabled choice on the open page through the same
  path as a click. Expand the Source group before choosing from it. Actions keep or dismiss the
  menu according to the clicked item's rules. For Quit Workbench and Quit PLVS, use
  [Workbench Control](workbench.md).
- `tray close` dismisses the panel.
- `visual screenshot --target tray` captures the open panel, including its picker in the same
  WebView. It is unavailable while the panel is closed.

Use the revision and `uiGeneration` returned by **Tray Control** for these actions and optional
screenshot guards. The Tray generation covers menu state and presentation independently of the
main window's `ui inspect` generation. Refresh Tray state after a conflict.

## Linux

The owner reports `presentation: native` and `visible: null`. PLVS supplies the menu definitions
through AppIndicator, and the desktop host owns the visible popup and its navigation. The host
does not expose a PLVS window to open, focus, dismiss or capture. Use the owning Agent Control
families for actions. Window Control includes `window locate` on all three platforms.

Exact syntax and parameters are in [the command reference](generated/commands.md).
