# Workbench Control

Workbench Control opens an additional workbench and quits one workbench or all of them, through
the same paths as launching PLVS again and the Tray's Quit Workbench and Quit PLVS.

Command syntax and arguments are in [`generated/commands.md`](generated/commands.md).

## Open

`workbench open` starts one more workbench exactly as a second launch does. The new workbench opens
Stopped with Automatic selected and applies every startup guard a launch does. The command returns
once the new process has registered, with its `instanceId`, `workspaceId` and `displayName`; target
it with `--instance <instanceId>`. Its Agent Control frontend may still be starting, so a first
request can return `frontendNotReady`; retry it. A workbench that does not register within 20
seconds fails with `timeout`; inspect `instances` before opening another.

The command takes no Source. Select one in the new workbench with `device select`.

## Quit

`workbench quit` quits the selected workbench as Quit Workbench does: it stops capture, saves, and
removes the workbench from the set restored at the next launch. With one workbench running, this
quits PLVS, as the window's Quit does.

`workbench quit-all` quits every workbench as Quit PLVS does, keeping the restore set. Every
workbench stops capture and saves before any of them exits. A workbench that refuses, for example
because an editor is open in it, fails the whole command with `quitRefused`, nothing quits, and any
capture the preparation stopped resumes.

Both refuse with `editorActive` while a blocking editor is open in the selected workbench, and with
`busy` while an update is installing. A successful result is `{ revision, accepted: true, scope }`
with `scope` `workbench` or `all`. It is delivered before the process exits, so a caller always
reads it; afterwards the workbench's Agent Control endpoint disappears. If saving fails after the
response, the window stays open with the save error's Retry and Cancel, as it does for the Tray.

## Revision and timing

The commands require `--expected-revision` but leave the revision unchanged. `workbench open` and
`workbench quit-all` wait on other processes, so they answer outside the serialized command queue
with a 25-second budget.
