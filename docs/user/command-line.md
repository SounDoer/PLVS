# Command Line

Installed Windows and macOS builds include `plvs-cli` for diagnosing the installation and for
inspecting or changing the state of an already-running PLVS app. It is not a headless replacement
for the desktop app. The full command set is in the [CLI Reference](cli.md).

## Where it is

- **Windows**: `plvs-cli.exe` sits beside `plvs.exe`. Enabling **Agent Control** in Settings adds
  that directory to the current user's `PATH`; otherwise use the full path. From a Portable folder,
  run `.\plvs-cli.exe` and keep it beside `plvs.exe`.
- **macOS**: `/Applications/PLVS.app/Contents/MacOS/plvs-cli` (or the same path under
  `~/Applications`). PLVS does not edit shell startup files; use the full path or create your own
  symlink.

## Checking the installation

`plvs-cli doctor --json` verifies the installed runtime and bundled sidecars, even while PLVS is
closed. Add `--out <file>` to write the result to a file.

## Controlling the running app

Start PLVS and enable **Agent Control** in Settings. Then discover the available surface with
`plvs-cli capabilities --json` and read the app's current state with `plvs-cli inspect --json`.

Queries return a global revision. Every change requires it, for example:

```bash
plvs-cli workspace apply layout.json --json --expected-revision 44
```

If the revision conflicts, inspect again and reconcile the change that happened in between, rather
than retrying blindly.
