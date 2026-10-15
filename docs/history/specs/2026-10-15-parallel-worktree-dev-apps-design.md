# Parallel Worktree Dev Apps Design

## Status

Approved for implementation on 2026-10-15, with option A below. Decision recorded in
[ADR 0028](../../adr/0028-parallel-worktree-dev-apps.md).

## Goal

Several agents work on PLVS at once, each in its own linked worktree. Today only one of them can run
the dev app, and nothing stops two of them from driving the capture rig at the same time. This design
lets every linked worktree run its own dev app without touching another's, and makes the capture rig
an explicitly leased resource.

The main checkout keeps its current behaviour exactly.

## Observed conflicts

Measured on Windows on 2026-10-15 with the main checkout and a detached probe worktree at `ada7af28`.

1. **Port.** With the main dev app running, the probe's `npm run dev` fails with
   `Port 1420 is already in use`. `vite.config.js` fixes the port with `strictPort`, and
   `tauri.conf.json` repeats it in `devUrl` and `devCsp`. HMR shares that port unless
   `TAURI_DEV_HOST` is set, so `1421` is not a second conflict on desktop.
2. **Data.** Every dev app opens the one `com.soundoer.plvs.dev` app-data directory: settings,
   Library, workspaces, instance registry and Agent Control descriptors. A branch that changes a
   persisted format writes it where every other branch's app will read it.
3. **Agent Control target.** Run from the probe without any override, `desktop:control instances`
   listed the main checkout's two workbenches. An agent can therefore inspect, mutate or screenshot an
   app built from different code and not notice.
4. **Capture rig.** VB-Cable and the VLC test tone exist once per machine. Two concurrent runs sum
   their tones (the +6.02 dB soak of 2026-10-15). Nothing detects this.

Conflicts 1–3 are software and are removed below. Conflict 4 is physical and is serialized.

## Existing mechanism reused

Debug builds already accept `--plvs-test-app-data-root <absolute path>` (`src-tauri/src/lib.rs`),
and the debug CLI already reads `PLVS_TEST_IDENTITY_ROOT` to discover instances under such a root.
The probe was launched with port `1437` and `--plvs-test-app-data-root <probe>/.dev-data`:

- Both dev apps ran side by side.
- The probe app came up in first-run state (`appearance.selectedThemeId: null`, default layout).
- With `PLVS_TEST_IDENTITY_ROOT=<probe>/.dev-data/multi-instance`, the probe's CLI listed only the
  probe instance; `inspect` and `visual screenshot --target main` worked against it.
- The main checkout's CLI, without the variable, still listed only the main checkout's workbenches.
- Logs, Agent Control artifacts, runtime descriptors and the instance registry all landed under
  `.dev-data`.

No Rust change is needed for the debug dev app. The cold debug build in the probe took 1 min 54 s and
6.5 GB of target directory on the measuring machine.

## Design

### Worktree detection

A checkout is a linked worktree when `git rev-parse --git-dir` and `git rev-parse --git-common-dir`
resolve to different directories. Detection lives in one new module, `scripts/dev-worktree.mjs`,
which every script below imports. Outside a linked worktree it returns `null` and callers behave
exactly as today.

### Port

- The main checkout keeps `1420`.
- A linked worktree prefers a port derived from a stable hash of its absolute path, in `1430–1499`,
  and walks upward within that range if the preferred port is already bound. The same worktree usually
  gets the same port across restarts.
- `vite.config.js` reads the port from `PLVS_DEV_PORT`, defaulting to `1420`, and keeps
  `strictPort`, so a race between the check and Vite's bind fails loudly instead of drifting.
- `scripts/run-tauri-dev.mjs` writes a generated Tauri config under
  `src-tauri/target/dev-identity/` with `build.devUrl` and `app.security.devCsp`. The CSP is derived
  from `tauri.conf.json` by replacing `localhost:1420`, not retyped, so the two cannot drift.
  `beforeDevCommand` inherits `PLVS_DEV_PORT` from the launcher's environment.

### Data

- A linked worktree's dev app always starts with
  `--plvs-test-app-data-root <worktree>/.dev-data`.
- The first launch is a genuine first run: no seeding from the main dev profile. Deleting `.dev-data`
  returns the worktree to first-run state. Removing the worktree removes its data.
- `.dev-data/` is added to `.gitignore` and to Vite's `server.watch.ignored`. The second matters on
  Windows: the existing comment in `vite.config.js` records that a watched directory cannot be renamed,
  and the app writes into `.dev-data` continuously.
- There is no opt-out to shared data in this change. A worktree that needs a real profile copies files
  into `.dev-data` by hand.

### Agent Control target

The dev-CLI callers (`run-desktop-control.mjs`, `smoke-agent-control.mjs`,
`ui-visual-walkthrough.mjs`, `theme-gallery.mjs`) set
`PLVS_TEST_IDENTITY_ROOT=<worktree>/.dev-data/multi-instance` when running in a linked worktree and
the variable is not already set. An agent in a worktree then sees and drives only its own app, and
`--instance` / `PLVS_INSTANCE_ID` keep working within that set.

### Capture rig lease

- The lease is a file, `<git common dir>/plvs-capture-rig.lock`, visible from every worktree.
- `scripts/capture-rig.mjs` acquires it in `startPlayer` and releases it in `stopPlayer`, plus a
  process `exit` handler. Smoke, soak and multi-instance capture all start their tone through that
  function, so all three are covered by one change.
- Acquisition is an exclusive create (`fs.openSync(path, "wx")`). The file records the PID, the
  process start time, the worktree path, the script and its arguments, and the start time.
- When the file exists, the holder's PID and process start time are checked. A live holder makes the
  caller fail with a `RigError` (exit 2) that names the worktree, script and start time. A dead holder,
  or a PID reused by a different process, is a stale lease: it is removed and acquisition retries
  once.
- `--wait` on `smoke:capture`, `soak:capture` and the multi-instance runner polls until the lease is
  free instead of failing. Without it, a busy rig fails immediately.
- There is no flag to take a live lease. `release:preflight` therefore stops while another run holds
  the rig, consistent with the rule that capture smoke has no bypass.
- The lease is advisory. It only holds if the rig is used exclusively through these scripts;
  `AGENTS.md` states that rule for every agent.
- The rig is Windows-only today, so the process start-time check runs on Windows only. Elsewhere a
  live PID counts as a live holder.

## Documentation

- `CONTRIBUTING.md`: a short section on dev apps in linked worktrees (port, `.dev-data`, CLI scope,
  resetting) and on the capture rig lease.
- `AGENTS.md`: one line under Capture rig — use the rig only through the smoke, soak and
  multi-instance scripts; a busy lease means wait, not work around.
- A new ADR records why linked worktrees isolate data by default and why the lease has no override.

## Testing

Vitest, next to each script:

- Worktree detection on a main checkout and on a linked worktree created in a temporary repository.
- Port choice: stability for one path, range bounds, walking past a bound port.
- CSP derivation from the real `tauri.conf.json`: every `localhost:1420` replaced, nothing else
  changed.
- Generated Tauri arguments and app arguments, including an existing `--` from the caller.
- CLI environment: set in a linked worktree, untouched on the main checkout, never overriding an
  explicit value.
- Lease: acquire and release; busy with a live holder; stale with a dead PID; stale with a reused PID;
  two concurrent acquirers, exactly one wins; `--wait` acquires after release.

Then the same manual check as the probe: main and one worktree dev app side by side, each CLI listing
only its own instance, a screenshot from each.

## Optimized dev builds

`desktop:dev-optimized` builds the release profile, and `--plvs-test-app-data-root` is compiled out of
release builds, so an optimized dev app in a linked worktree cannot isolate its data. Two options:

- **A (chosen):** also accept the argument, and `PLVS_TEST_IDENTITY_ROOT` in the CLI, when the
  `dev-identity` feature is on. Two `cfg` conditions in Rust. Stable and Preview packages never enable
  that feature, so the guarantee that packaged builds ignore the argument stands.
- **B:** keep Rust unchanged. In a linked worktree `desktop:dev-optimized` refuses to start and says
  why.

`desktop:dev-optimized` only builds; the optimized app is launched by hand, so in a worktree the
data-root argument is passed by hand too, as `CONTRIBUTING.md` describes.

## Non-goals

- Distinguishing windows by branch name in the title bar.
- Sharing a Cargo target directory between worktrees. `sccache` can be evaluated separately.
- Leasing mouse and keyboard input. The user is the usual other party, and the existing rule to ask
  first stands.
- Leasing anything on macOS.
