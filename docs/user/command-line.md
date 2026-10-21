# Command Line

Installed Windows, macOS, and Linux builds include `plvs-cli` for diagnosing
the installation and for inspecting or changing the state of an already-running PLVS app. It is
not a headless replacement for the desktop app. The full command set is in the
[CLI Reference](cli.md).

## Where it is

- **Windows**: `plvs-cli.exe` sits beside `plvs.exe`. Enabling **Agent Control** in Settings adds
  that directory to the current user's `PATH`; otherwise use the full path. From a Portable folder,
  run `.\plvs-cli.exe` and keep it beside `plvs.exe`.
- **macOS**: `/Applications/PLVS.app/Contents/MacOS/plvs-cli` (or the same path under
  `~/Applications`). PLVS does not edit shell startup files; use the full path or create your own
  symlink.
- **Linux**: `/usr/bin/plvs-cli` for the stable package and `/usr/bin/plvs-preview-cli` for the
  Preview package, so the two can be installed side by side. Development builds
  stage `plvs-cli` beside the desktop executable. PLVS does not edit shell startup files.

## Checking the installation

`plvs-cli doctor --json` verifies the installed runtime and bundled sidecars, even while PLVS is
closed. Add `--out <file>` to write the result to a file.

## Controlling the running app

Start PLVS and enable **Agent Control** in Settings. Then discover the available surface with
`plvs-cli capabilities --json` and read the app's current state with `plvs-cli inspect --json`.
Linux builds support PNG screenshots and H.264 MP4 recording of the visible PLVS
WebView, including optional AAC audio from the measured Live source. Keep the display session
unlocked and the window visible; Linux does not capture the system pointer. Recording on Linux uses
Ubuntu's own FFmpeg, which PLVS does not install: run `sudo apt install ffmpeg`, then restart PLVS.
`plvs-cli doctor` shows whether recording is available.

Queries return a global revision. Every change requires it, for example:

```bash
plvs-cli workspace apply layout.json --json --expected-revision 44
```

If the revision conflicts, inspect again and reconcile the change that happened in between, rather
than retrying blindly.
