# Mix Control

PLVS advertises `mix.*` methods on Windows. `mix list --json` returns saved Mixes in Library
order, including their names, format modes, selected sources and channels, and route overrides.
`activeId` is the Mix selected in the current Workbench, or `null`. Select a saved Mix
through [Device Control](devices.md), or from the main window or Dock Sources choices.

Use [Editor Draft Control](editor-drafts.md#mix-drafts-on-windows) to author or edit a Mix.
`mix rename` and `mix delete` operate on saved items. Both require the current revision and
support `--dry-run`. An open blocking editor or an update transition prevents saved-item
mutations. Rename preserves the active measurement. Delete uses the same Library mutation as
the confirmed Sources action and follows the existing unavailable-source behavior when the
deleted Mix was selected. Delete is a risky command in the MCP adapter.
