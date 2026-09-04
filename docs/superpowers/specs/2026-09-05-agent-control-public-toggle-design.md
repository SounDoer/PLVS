# Agent Control: Public Toggle Design

Date: 2026-09-05

Status: Approved, not yet implemented

Agent Control is implemented and exercised today only in development-identity builds, gated at
compile time. This design turns that compile-time gate into a single user-facing setting so the
feature ships in release builds, and retires the existing Command Line PATH row in the process.

It does not change the control protocol, the command families, or any behaviour reachable through
the channel. It changes only who can reach it and how they turn it on.

## What the toggle is

One Settings row, `Agent Control`, replacing the current `Command Line` row.

Turning it on does three things as a single operation:

1. opens the control endpoint (named pipe) and writes the discovery descriptor with its launch
   token;
2. adds the `plvs-cli` install directory to the user PATH;
3. persists the enabled state, so the next launch restores it.

Turning it off reverses 1 and 2. The `Command Line` row is removed; PATH setup stops being a
user-facing choice and becomes an implementation detail of this toggle.

The setting is off by default in release builds, including on upgrade from a version that had no
such setting. The toggle is persistent and takes effect immediately — no restart, no confirmation dialog. It
carries the standard `SettingsLabelWithTip` tip, worded to say plainly that it allows programs on
this machine to control PLVS.

On macOS the row renders disabled with `Agent Control is currently available on Windows only.`,
matching how `Command Line` renders there today. Both the endpoint (`windows_pipe.rs`) and PATH
setup (`cli_path.rs`) are Windows-only; a macOS transport is explicitly out of scope here.

## Replacing the compile-time gates

Three `dev-identity` gates currently decide this and all three change:

- `src-tauri/src/lib.rs` — the `#[cfg(all(target_os = "windows", feature = "dev-identity"))]` guard
  on `windows_pipe::start_for_app` becomes a runtime check: Windows, and the persisted setting is
  on.
- `src-tauri/src/lib.rs` — the injected `agentControl.available` currently means "dev build on
  Windows". It splits: `available` becomes platform support alone, and a new `enabled` reports the
  persisted state.
- `src-tauri/src/cli_main.rs` — `parse_args_with_app(args, cfg!(feature = "dev-identity"))` becomes
  unconditional. The `app` family exists in every build.

The `dev-identity` feature itself stays. Its real job is switching the app identifier in
`build.rs` so a dev build does not share configuration with an installed one; it should stop
doubling as the Agent Control gate. Development builds take the same runtime path as release, with
the setting defaulting to on, so the current development workflow is unaffected.

A new command, `set_agent_control_enabled(bool)`, performs the whole operation — start or stop the
endpoint, write or remove the descriptor, add or remove PATH — so the frontend has one call and
cannot leave the two halves disagreeing.

## What the toggle deliberately does not reach

**Agents cannot change it.** The key is absent from `buildPublicSettings`
(`src/agentControl/settingsControl.js`), so `settings.update` cannot reach it. An agent that could
turn it off would be performing an irreversible act — the endpoint it is speaking through
disappears and only a human can restore it — and a permission must not be editable from inside the
scope it grants. An agent that is connected already knows the setting is on, so it is not reported
either.

**Profile export and import skip it.** It joins window bounds and capture device id as a key that
`profile import` leaves alone. Importing someone else's configuration must not enable a permission
the user never granted.

**Existing PATH entries are left alone.** After an upgrade the toggle is off while a previously
added PATH entry remains. The states disagree, and that is the intended outcome: silently removing
something the user explicitly asked for, with no UI left to explain it, is worse than a harmless
extra directory on PATH. The next time the user toggles Agent Control, both halves are brought back
into agreement. Reading an existing PATH entry as consent and enabling Agent Control on upgrade is
rejected outright — that would promote a convenience setting into a permission the user never
agreed to.

## Telling "disabled" apart from "not running"

A missing descriptor has two causes and `plvs-cli` must not conflate them:

- the setting is off — `Agent Control is disabled. Enable it in PLVS Settings.`
- the setting is on but no PLVS process is running — `PLVS is not running.`

The CLI can already read the desktop configuration store (`profile export` does), so it can read
the persisted setting and choose between the two.

This is where the decision to always expose the `app` family actually pays off. Exposing the
commands while returning an undifferentiated "not found" leaves an agent unable to distinguish an
unsupported build from an unopened switch, and the reasonable inference — "this build does not
support it" — is the wrong one and is a dead end for the user.

## Shutting down mid-flight

Disabling while a request is in flight must not drop the connection. The sequence is: stop
accepting new connections, remove the descriptor, let in-flight requests finish and reply, then
close. An abrupt cut gives the agent a disconnect it cannot explain or distinguish from a crash.

## Verification

Covered by `npm run check`:

- Settings panel renders the toggle; the macOS disabled state renders with its message.
- `buildPublicSettings` omits the key — a test that pins this, since a future refactor that adds it
  back would silently hand agents control of their own permission.
- Profile export omits the key; profile import leaves it untouched.
- The `app` command family parses without the `dev-identity` feature.
- Both CLI error messages are reachable from their respective states.
- PATH add and remove are idempotent.

Not covered by CI — Windows-only, and requires a running application:

- enable, then connect an agent successfully;
- disable, and observe a clean end to the connection;
- restart, and observe the state restored;
- disable while a request is in flight, and observe it completing rather than being cut.

## Known cost

This change opens a permission surface whose most important paths CI cannot reach, for the same
reason the capture layer is uncovered. The manual checks above are not optional, and an all-green
board does not stand in for them.
