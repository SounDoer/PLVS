# Agent Control Public Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Agent Control in release builds behind one persistent `Agent Control` setting that replaces the `Command Line` PATH row.

**Architecture:** The three `dev-identity` compile gates that currently decide whether Agent Control exists become one runtime flag, persisted as a Rust-owned sibling key in the settings store. A new `agent_control::toggle` module owns that flag and composes the single operation the UI calls: start/stop the named-pipe endpoint, write/remove the descriptor, add/remove PATH. `plvs-cli` gains the `app` family unconditionally and reads the same persisted flag so it can say "disabled" and "not running" as two different sentences.

**Tech Stack:** Rust (Tauri 2, `tauri-plugin-store`, Windows named pipes), React 19, Vitest, Cargo tests.

**Spec:** [`../specs/2026-09-05-agent-control-public-toggle-design.md`](../specs/2026-09-05-agent-control-public-toggle-design.md)

---

## Background you need before starting

Read these before Task 1. They are short and each one prevents a wrong turn.

- `src-tauri/src/agent_control/windows_pipe.rs:737` — `start_for_app` binds the pipe, writes the
  descriptor, and installs both the broker and the server into Tauri managed state. It takes
  `&tauri::App`, which only exists inside `setup`. Task 3 changes it to take `&AppHandle`.
- `src-tauri/src/agent_control/windows_pipe.rs:606` — `PipeServer::stop` already does the graceful
  sequence the spec asks for: set the shutdown flag, poke the listener so it wakes, join it, shut
  the broker down, remove the descriptor only if it is still ours. Do not write a second shutdown
  path; call this one.
- `src-tauri/src/profile.rs:20` — `DOMAIN_KEYS` and `SIBLING_KEYS` are the only keys profile
  export/import touch. A new top-level key that is in neither list is excluded from both for free.
  This is why the flag is stored at the top level and **not** inside `plvs:settings`, which
  export/import copies wholesale.
- `src-tauri/src/agent_control/broker.rs:508` — `agent_control_frontend_ready` fails when no broker
  is installed. So the React bridge must not run while the toggle is off; Task 13 gates it.
- `AGENTS.md` — comments, commit messages and docs are in English; UI labels are Title Case;
  `npm run check` is the merge gate.

The store file is `plvs-settings.json` in the config directory. The new key is a top-level
`agentControlEnabled` boolean, sibling to `windowBounds`.

---

## File structure

**Create**

- `src-tauri/src/agent_control/toggle.rs` — owns the persisted flag, composes status, and exposes
  the two Tauri commands. Everything the toggle means lives here; `lib.rs`, the CLI and the
  frontend each call into it rather than reimplementing the rule.
- `src/hooks/useAgentControlSettings.js` — the React half: reads status when Settings opens, calls
  the setter, tracks busy. Replaces `useCliPathSettings.js`.
- `src/hooks/useAgentControlSettings.test.js` — its tests.

**Modify**

- `src-tauri/src/agent_control/mod.rs` — declare the new module.
- `src-tauri/src/cli_path.rs` — widen field visibility so `toggle.rs` can read `on_path`.
- `src-tauri/src/lib.rs` — runtime start instead of the `cfg` gate; split the injected
  `available` / `enabled`; register the new commands.
- `src-tauri/src/agent_control/windows_pipe.rs` — `start_for_app(&App)` becomes `start(&AppHandle)`;
  descriptor app name stops being hardcoded to `PLVS Dev`; add an `is_running` probe.
- `src-tauri/src/cli_main.rs` — `app` family always available; root help always mentions it.
- `src-tauri/src/cli_app.rs` — two distinct failures for a missing descriptor.
- `src-tauri/src/profile.rs` — a test pinning that the flag is not exported or imported.
- `src/ipc/commands.js` — new command wrappers, old ones removed.
- `src/components/SettingsPanel.jsx` — the row swap.
- `src/components/AppSettingsOverlays.jsx` — wire the new hook.
- `src/App.jsx` — own the live enabled state; gate the bridge on it.
- `src/agentControl/appSnapshot.js` — `readAgentControlRuntime` reports `enabled`.
- `docs/cli.md`, `docs/agent-control/README.md` — the feature is no longer development-only.

**Delete**

- `src/hooks/useCliPathSettings.js` — superseded by `useAgentControlSettings.js`.

---

### Task 1: The persisted flag

**Files:**
- Create: `src-tauri/src/agent_control/toggle.rs`
- Modify: `src-tauri/src/agent_control/mod.rs`
- Modify: `src-tauri/src/cli_path.rs:7-14`

- [ ] **Step 1: Widen `CliPathStatus` field visibility**

`toggle.rs` needs to read `on_path` and `installed` from another module. In
`src-tauri/src/cli_path.rs`, change the struct fields to `pub(crate)`:

```rust
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliPathStatus {
  pub(crate) supported: bool,
  pub(crate) install_dir: Option<String>,
  pub(crate) cli_path: Option<String>,
  pub(crate) installed: bool,
  pub(crate) on_path: bool,
  pub(crate) message: String,
}
```

- [ ] **Step 2: Write the failing test**

Create `src-tauri/src/agent_control/toggle.rs` containing only the test module for now:

```rust
#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::{json, Map};

  #[test]
  fn reads_the_persisted_flag_when_present() {
    let mut map = Map::new();
    map.insert(ENABLED_KEY.into(), json!(true));
    assert!(enabled_from_store_map(&map));

    map.insert(ENABLED_KEY.into(), json!(false));
    assert!(!enabled_from_store_map(&map));
  }

  #[test]
  fn falls_back_to_the_build_default_when_absent_or_malformed() {
    let mut map = Map::new();
    assert_eq!(enabled_from_store_map(&map), default_enabled());

    map.insert(ENABLED_KEY.into(), json!("yes"));
    assert_eq!(enabled_from_store_map(&map), default_enabled());
  }

  #[test]
  fn release_builds_default_to_disabled() {
    assert_eq!(default_enabled(), cfg!(feature = "dev-identity"));
  }
}
```

Declare the module in `src-tauri/src/agent_control/mod.rs` beside the existing declarations:

```rust
pub mod toggle;
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml toggle::`
Expected: FAIL to compile — `cannot find value ENABLED_KEY in this scope`.

- [ ] **Step 4: Write the flag reader**

At the top of `src-tauri/src/agent_control/toggle.rs`, above the test module:

```rust
use serde::Serialize;
use serde_json::{Map, Value};

/// Top-level store key, a sibling of `windowBounds` rather than a member of `plvs:settings`.
/// `profile.rs` copies `plvs:settings` wholesale between machines; a permission must not travel
/// with an imported configuration, and staying out of both `DOMAIN_KEYS` and `SIBLING_KEYS` is
/// what keeps it out.
pub const ENABLED_KEY: &str = "agentControlEnabled";

/// Development builds keep the behaviour they have today — Agent Control on, no setup step.
/// Release builds start off, including on upgrade from a version that had no such setting.
pub fn default_enabled() -> bool {
  cfg!(feature = "dev-identity")
}

pub fn enabled_from_store_map(map: &Map<String, Value>) -> bool {
  match map.get(ENABLED_KEY) {
    Some(Value::Bool(value)) => *value,
    _ => default_enabled(),
  }
}

/// Read the flag straight off disk. Used by `plvs-cli`, which has no `AppHandle`.
pub fn read_enabled_from_disk() -> bool {
  let Ok(path) = crate::profile::store_file_path() else {
    return default_enabled();
  };
  let Ok(map) = crate::profile::read_store_map(&path) else {
    return default_enabled();
  };
  enabled_from_store_map(&map)
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml toggle::`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/agent_control/toggle.rs src-tauri/src/agent_control/mod.rs src-tauri/src/cli_path.rs
git commit -m "feat(agent-control): persist the Agent Control flag outside the profile" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The status shape

**Files:**
- Modify: `src-tauri/src/agent_control/toggle.rs`

- [ ] **Step 1: Write the failing test**

Add to the `tests` module in `src-tauri/src/agent_control/toggle.rs`:

```rust
  #[test]
  fn unsupported_platforms_report_a_windows_only_message() {
    let status = compose_status(false, false, false);
    assert!(!status.supported);
    assert!(!status.enabled);
    assert_eq!(status.message, "Agent Control is currently available on Windows only.");
  }

  #[test]
  fn a_missing_cli_is_reported_before_anything_else() {
    let status = compose_status(true, false, false);
    assert!(status.supported);
    assert!(!status.cli_installed);
    assert_eq!(status.message, "plvs-cli.exe was not found in this installation.");
  }

  #[test]
  fn the_message_says_plainly_what_being_on_means() {
    let off = compose_status(true, true, false);
    assert!(!off.enabled);
    assert_eq!(
      off.message,
      "Allows programs on this machine to control PLVS through plvs-cli."
    );

    let on = compose_status(true, true, true);
    assert!(on.enabled);
    assert_eq!(
      on.message,
      "Programs on this machine can control PLVS through plvs-cli."
    );
  }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml toggle::`
Expected: FAIL to compile — `cannot find function compose_status in this scope`.

- [ ] **Step 3: Write the status type and composer**

Add below `read_enabled_from_disk`:

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentControlStatus {
  /// The platform has a control endpoint at all. Windows only for now.
  pub supported: bool,
  pub enabled: bool,
  pub cli_installed: bool,
  pub on_path: bool,
  pub message: String,
}

fn compose_status(supported: bool, cli_installed: bool, enabled: bool) -> AgentControlStatus {
  let message = if !supported {
    "Agent Control is currently available on Windows only."
  } else if !cli_installed {
    "plvs-cli.exe was not found in this installation."
  } else if enabled {
    "Programs on this machine can control PLVS through plvs-cli."
  } else {
    "Allows programs on this machine to control PLVS through plvs-cli."
  };
  AgentControlStatus {
    supported,
    enabled: supported && cli_installed && enabled,
    cli_installed,
    on_path: false,
    message: message.to_string(),
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml toggle::`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/agent_control/toggle.rs
git commit -m "feat(agent-control): describe the toggle state in one status shape" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Start the endpoint from an AppHandle

`start_for_app` takes `&tauri::App`, which exists only inside `setup`. The toggle needs to start the
endpoint at any moment, so it must take an `&AppHandle`. The descriptor's app name is also
hardcoded to `PLVS Dev`, which was fine while the feature was development-only and is wrong the
moment a release build writes one.

**Files:**
- Modify: `src-tauri/src/agent_control/windows_pipe.rs:737-772`
- Modify: `src-tauri/src/lib.rs:237-240`

- [ ] **Step 1: Change the signature and the app name**

In `src-tauri/src/agent_control/windows_pipe.rs`:

```rust
pub fn start(app: &tauri::AppHandle) -> Result<(), String> {
  let token = generate_launch_token().map_err(|error| error.to_string())?;
  let identifier = env!("PLVS_APP_ID");
  let endpoint = endpoint_name(identifier);
  let emitter = Arc::new(TauriFrontendEmitter::new(app.clone()));
```

and, inside the `AgentControlDescriptor` literal:

```rust
    app: DescriptorApp {
      name: if cfg!(feature = "dev-identity") { "PLVS Dev" } else { "PLVS" }.to_string(),
      version: env!("CARGO_PKG_VERSION").to_string(),
      identifier: identifier.to_string(),
    },
```

The two `app.state::<...>()` calls at the end need no change — `AppHandle` has `state` too.

- [ ] **Step 2: Update the one existing caller**

In `src-tauri/src/lib.rs`, replace the gated call with the same behaviour through the new signature
(Task 5 replaces the condition itself):

```rust
      #[cfg(all(target_os = "windows", feature = "dev-identity"))]
      if let Err(error) = agent_control::windows_pipe::start(app.handle()) {
        log::warn!("agent control unavailable; PLVS will continue normally: {error}");
      }
```

- [ ] **Step 3: Verify it still builds and the pipe tests still pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --features dev-identity windows_pipe::`
Expected: PASS.

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/agent_control/windows_pipe.rs src-tauri/src/lib.rs
git commit -m "refactor(agent-control): start the endpoint from an AppHandle" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The two Tauri commands

One command performs the whole operation, so the endpoint and PATH can never end up disagreeing.

**Files:**
- Modify: `src-tauri/src/agent_control/toggle.rs`
- Modify: `src-tauri/src/agent_control/windows_pipe.rs` (`impl PipeServerState`)
- Modify: `src-tauri/src/lib.rs` (the `invoke_handler` list)

- [ ] **Step 1: Write the commands**

Add to `src-tauri/src/agent_control/toggle.rs`:

```rust
use tauri::{AppHandle, Manager};
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "plvs-settings.json";

fn persist_enabled(app: &AppHandle, enabled: bool) -> Result<(), String> {
  let store = app
    .store(STORE_FILE)
    .map_err(|error| format!("store load: {error}"))?;
  store.set(ENABLED_KEY, Value::Bool(enabled));
  store.save().map_err(|error| format!("store save: {error}"))
}

fn read_enabled(app: &AppHandle) -> bool {
  let Ok(store) = app.store(STORE_FILE) else {
    return default_enabled();
  };
  match store.get(ENABLED_KEY) {
    Some(Value::Bool(value)) => value,
    _ => default_enabled(),
  }
}

fn current_status(app: &AppHandle) -> Result<AgentControlStatus, String> {
  let path_status = crate::cli_path::cli_path_status()?;
  let supported = cfg!(target_os = "windows") && path_status.supported;
  let mut status = compose_status(supported, path_status.installed, read_enabled(app));
  status.on_path = path_status.on_path;
  Ok(status)
}

#[tauri::command]
pub fn agent_control_status(app: AppHandle) -> Result<AgentControlStatus, String> {
  current_status(&app)
}

#[tauri::command]
pub fn set_agent_control_enabled(
  app: AppHandle,
  enabled: bool,
) -> Result<AgentControlStatus, String> {
  let before = current_status(&app)?;
  if !before.supported || !before.cli_installed {
    return Ok(before);
  }

  // PATH first when enabling and last when disabling, so a failure never leaves the endpoint open
  // with no way to reach it, nor PATH pointing at an endpoint that is gone.
  if enabled {
    let _ = crate::cli_path::set_cli_path_enabled(true)?;
    start_endpoint(&app)?;
  } else {
    stop_endpoint(&app);
    let _ = crate::cli_path::set_cli_path_enabled(false)?;
  }

  persist_enabled(&app, enabled)?;
  current_status(&app)
}

#[cfg(target_os = "windows")]
fn start_endpoint(app: &AppHandle) -> Result<(), String> {
  if app
    .state::<crate::agent_control::windows_pipe::PipeServerState>()
    .is_running()
  {
    return Ok(());
  }
  crate::agent_control::windows_pipe::start(app)
}

#[cfg(not(target_os = "windows"))]
fn start_endpoint(_app: &AppHandle) -> Result<(), String> {
  Err("Agent Control is currently available on Windows only.".to_string())
}

fn stop_endpoint(app: &AppHandle) {
  app
    .state::<crate::agent_control::windows_pipe::PipeServerState>()
    .stop();
}
```

- [ ] **Step 2: Add the `is_running` probe**

In `src-tauri/src/agent_control/windows_pipe.rs`, in `impl PipeServerState` beside `stop`:

```rust
  pub fn is_running(&self) -> bool {
    self
      .server
      .lock()
      .expect("agent-control server state poisoned")
      .is_some()
  }
```

- [ ] **Step 3: Register the commands**

In `src-tauri/src/lib.rs`, directly after `agent_control::broker::agent_control_respond,`:

```rust
      agent_control::toggle::agent_control_status,
      agent_control::toggle::set_agent_control_enabled,
```

- [ ] **Step 4: Verify both profiles build clean**

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: no warnings.

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --features dev-identity -- -D warnings`
Expected: no warnings.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/agent_control/toggle.rs src-tauri/src/agent_control/windows_pipe.rs src-tauri/src/lib.rs
git commit -m "feat(agent-control): apply the toggle as one endpoint-and-PATH operation" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Boot from the flag instead of the compile gate

**Files:**
- Modify: `src-tauri/src/lib.rs:123-129` (the injected `agentControl` object)
- Modify: `src-tauri/src/lib.rs:237-240` (the start call)

- [ ] **Step 1: Split `available` from `enabled` in the injected state**

```rust
      let agent_control_enabled = match store.get(agent_control::toggle::ENABLED_KEY) {
        Some(serde_json::Value::Bool(value)) => value,
        _ => agent_control::toggle::default_enabled(),
      };
      let agent_control = serde_json::json!({
        // `available` is platform support alone. Whether the endpoint is actually open is
        // `enabled`, which the user owns from Settings.
        "available": cfg!(target_os = "windows"),
        "enabled": cfg!(target_os = "windows") && agent_control_enabled,
        "appName": if cfg!(feature = "dev-identity") { "PLVS Dev" } else { "PLVS" },
        "appVersion": env!("CARGO_PKG_VERSION"),
        "identifier": env!("PLVS_APP_ID"),
        "platform": std::env::consts::OS,
      });
```

- [ ] **Step 2: Start the endpoint only when the flag is on**

```rust
      #[cfg(target_os = "windows")]
      if agent_control_enabled {
        if let Err(error) = agent_control::windows_pipe::start(app.handle()) {
          log::warn!("agent control unavailable; PLVS will continue normally: {error}");
        }
      }
```

`agent_control_enabled` is bound near the top of `setup` and used here; keep it in scope.

- [ ] **Step 3: Verify both profiles build clean**

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: no warnings; `dev-identity` no longer appears at either site.

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(agent-control): boot from the persisted flag, not the build profile" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: `plvs-cli` always has the `app` family

**Files:**
- Modify: `src-tauri/src/cli_main.rs:100-102`
- Modify: `src-tauri/src/cli_main.rs:734` (root help text)
- Modify: `src-tauri/src/cli_main.rs:775-782` (the root help branch)
- Test: `src-tauri/src/cli_main.rs` tests module

- [ ] **Step 1: Write the failing test**

In the `tests` module of `src-tauri/src/cli_main.rs`, add:

```rust
  #[test]
  fn exposes_the_app_command_family_in_every_build() {
    assert!(parse_args(&args(&["app", "inspect", "--json"])).is_ok());
    assert_eq!(
      parse_args(&args(&["help", "app"])),
      Ok(CliCommand::Help(HelpTopic::App))
    );
  }

  #[test]
  fn root_help_points_at_the_app_family() {
    assert!(help_text(HelpTopic::Root).contains("plvs-cli app"));
  }
```

Keep the existing `gates_the_app_command_family_on_explicit_availability` test — it covers
`parse_args_with_app` directly and still documents the parameter.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml cli_main::`
Expected: FAIL — `exposes_the_app_command_family_in_every_build` fails on the release profile,
because `parse_args` passes `cfg!(feature = "dev-identity")`, which is `false` there.

- [ ] **Step 3: Make the family unconditional**

Replace `parse_args`:

```rust
fn parse_args(args: &[String]) -> Result<CliCommand, String> {
  parse_args_with_app(args, true)
}
```

In the root help string at `src-tauri/src/cli_main.rs:734`, add this line to the `Usage:` block,
after the `report` line:

```text
  plvs-cli app <command> [options]
```

and this line to the `Agent usage:` block:

```text
  Use app to inspect or control a running PLVS window; see plvs-cli app --help.
```

Replace the root help branch so it no longer depends on the build profile:

```rust
    CliCommand::Help(topic) => {
      println!("{}", help_text(topic));
      ExitCode::SUCCESS
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml cli_main::`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/cli_main.rs
git commit -m "feat(cli): expose the app command family in release builds" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Tell "disabled" apart from "not running"

**Files:**
- Modify: `src-tauri/src/cli_app.rs:1017-1030`
- Test: `src-tauri/src/cli_app.rs` tests module

- [ ] **Step 1: Write the failing test**

In the `tests` module of `src-tauri/src/cli_app.rs`, add:

```rust
  #[test]
  fn a_missing_descriptor_reads_differently_when_the_toggle_is_off() {
    let disabled = missing_descriptor_failure(false);
    assert_eq!(disabled.reason, "agentControlDisabled");
    assert_eq!(
      disabled.message,
      "Agent Control is disabled. Enable it in PLVS Settings."
    );

    let not_running = missing_descriptor_failure(true);
    assert_eq!(not_running.reason, "appNotRunning");
    assert_eq!(not_running.message, "PLVS is not running.");
  }
```

Read `CliAppFailure` before writing this: if `reason` and `message` are not reachable from the test
module, follow whatever the neighbouring tests in that file already do to inspect a failure rather
than widening the type.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml cli_app::`
Expected: FAIL to compile — `cannot find function missing_descriptor_failure in this scope`.

- [ ] **Step 3: Write the helper and use it**

Add above `impl ControlClient for LocalControlClient`:

```rust
/// A missing or stale descriptor has two causes and they need different sentences: an agent that
/// cannot tell "you never turned this on" from "the app is closed" will report the wrong one to
/// the user, and the user cannot act on it.
fn missing_descriptor_failure(enabled: bool) -> CliAppFailure {
  if enabled {
    CliAppFailure::transport("appNotRunning", "PLVS is not running.".to_string(), None)
  } else {
    CliAppFailure::transport(
      "agentControlDisabled",
      "Agent Control is disabled. Enable it in PLVS Settings.".to_string(),
      None,
    )
  }
}
```

Then replace the error mapping inside `LocalControlClient::call`:

```rust
    let descriptor = read_descriptor_at(&path, env!("PLVS_APP_ID"), |_| true).map_err(|error| {
      match error.kind {
        DiscoveryErrorKind::Missing | DiscoveryErrorKind::Malformed | DiscoveryErrorKind::Stale => {
          missing_descriptor_failure(crate::agent_control::toggle::read_enabled_from_disk())
        }
        DiscoveryErrorKind::Unavailable | DiscoveryErrorKind::Io => {
          CliAppFailure::transport("discoveryFailed", error.to_string(), None)
        }
      }
    })?;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml cli_app::`
Expected: PASS. The existing test at `src-tauri/src/cli_app.rs:2689` asserts the string
`"not running"` — check whether it needs the new wording and update it if so.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/cli_app.rs
git commit -m "feat(cli): say whether Agent Control is off or PLVS is closed" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Pin the profile exclusion

The flag is excluded from export/import because it is in neither `DOMAIN_KEYS` nor `SIBLING_KEYS`.
Nothing states that, so a future key sweep could quietly include it. This test states it.

**Files:**
- Modify: `src-tauri/src/profile.rs` tests module

- [ ] **Step 1: Write the test**

```rust
  #[test]
  fn agent_control_is_neither_exported_nor_imported() {
    use crate::agent_control::toggle::ENABLED_KEY;

    let mut store = Map::new();
    store.insert(ENABLED_KEY.into(), json!(true));
    let snapshot = build_profile_snapshot_from_store(&store);
    assert!(
      snapshot.get(ENABLED_KEY).is_none(),
      "a permission must not travel inside an exported configuration"
    );

    assert!(!DOMAIN_KEYS.contains(&ENABLED_KEY));
    assert!(!SIBLING_KEYS.contains(&ENABLED_KEY));
  }
```

- [ ] **Step 2: Run it**

Run: `cargo test --manifest-path src-tauri/Cargo.toml profile::`
Expected: PASS on the first run — this pins existing behaviour rather than driving new code. If it
fails, the key was placed inside `plvs:settings`; move it to the top level.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/profile.rs
git commit -m "test(profile): pin Agent Control out of configuration export and import" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Keep the toggle out of agent-visible settings

**Files:**
- Modify: `src/agentControl/settingsControl.test.js`

- [ ] **Step 1: Write the test**

Add to `src/agentControl/settingsControl.test.js`:

```js
it("never exposes the Agent Control toggle to agents", () => {
  const publicSettings = buildPublicSettings(
    { agentControlEnabled: true, referenceLufs: -23 },
    { channelCount: 2 }
  );
  expect(publicSettings).not.toHaveProperty("agentControlEnabled");
});
```

Match the file's existing import list, and copy the context object the neighbouring cases pass as
the second argument rather than inventing one.

- [ ] **Step 2: Run it**

Run: `npx vitest run src/agentControl/settingsControl.test.js`
Expected: PASS on the first run. `buildPublicSettings` builds an allowlist, so an unknown key is
already dropped; the test exists so that stays true. If it fails, the key leaked into the allowlist
and must be removed.

- [ ] **Step 3: Commit**

```bash
git add src/agentControl/settingsControl.test.js
git commit -m "test(agent-control): pin the toggle out of agent-editable settings" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: The React hook

**Files:**
- Create: `src/hooks/useAgentControlSettings.js`
- Create: `src/hooks/useAgentControlSettings.test.js`
- Modify: `src/ipc/commands.js:191-197`
- Delete: `src/hooks/useCliPathSettings.js`

- [ ] **Step 1: Replace the IPC wrappers**

In `src/ipc/commands.js`, replace `cliPathStatusCommand` and `setCliPathEnabledCommand` with:

```js
export function agentControlStatusCommand() {
  return invoke("agent_control_status");
}

export function setAgentControlEnabledCommand(enabled) {
  return invoke("set_agent_control_enabled", { enabled });
}
```

- [ ] **Step 2: Write the failing test**

Create `src/hooks/useAgentControlSettings.test.js`:

```js
import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  agentControlStatusCommand: vi.fn(),
  setAgentControlEnabledCommand: vi.fn(),
  isTauri: vi.fn(() => true),
}));

vi.mock("../ipc/commands.js", () => ({
  agentControlStatusCommand: mocks.agentControlStatusCommand,
  setAgentControlEnabledCommand: mocks.setAgentControlEnabledCommand,
}));
vi.mock("../ipc/env.js", () => ({ isTauri: mocks.isTauri }));

import { useAgentControlSettings } from "./useAgentControlSettings.js";

const READY = {
  supported: true,
  enabled: false,
  cliInstalled: true,
  onPath: false,
  message: "Allows programs on this machine to control PLVS through plvs-cli.",
};

describe("useAgentControlSettings", () => {
  beforeEach(() => {
    mocks.agentControlStatusCommand.mockReset().mockResolvedValue(READY);
    mocks.setAgentControlEnabledCommand.mockReset();
  });

  it("reads status when settings open", async () => {
    const { result } = renderHook(() => useAgentControlSettings({ settingsOpen: true }));
    await waitFor(() => expect(result.current.agentControlStatus).toEqual(READY));
  });

  it("does not read status while settings are closed", () => {
    renderHook(() => useAgentControlSettings({ settingsOpen: false }));
    expect(mocks.agentControlStatusCommand).not.toHaveBeenCalled();
  });

  it("adopts and returns the status the setter settles on", async () => {
    const enabled = { ...READY, enabled: true, onPath: true, message: "on" };
    mocks.setAgentControlEnabledCommand.mockResolvedValue(enabled);
    const { result } = renderHook(() => useAgentControlSettings({ settingsOpen: true }));
    await waitFor(() => expect(result.current.agentControlStatus).toEqual(READY));

    let settled;
    await act(async () => {
      settled = await result.current.setAgentControlEnabled(true);
    });
    expect(mocks.setAgentControlEnabledCommand).toHaveBeenCalledWith(true);
    expect(result.current.agentControlStatus).toEqual(enabled);
    expect(settled).toEqual(enabled);
  });

  it("reports a failed change without claiming the toggle moved", async () => {
    mocks.setAgentControlEnabledCommand.mockRejectedValue(new Error("nope"));
    const { result } = renderHook(() => useAgentControlSettings({ settingsOpen: true }));
    await waitFor(() => expect(result.current.agentControlStatus).toEqual(READY));

    let settled;
    await act(async () => {
      settled = await result.current.setAgentControlEnabled(true);
    });
    expect(result.current.agentControlStatus.enabled).toBe(false);
    expect(result.current.agentControlStatus.message).toBe("Agent Control could not be changed.");
    expect(settled.enabled).toBe(false);
    expect(result.current.agentControlBusy).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/hooks/useAgentControlSettings.test.js`
Expected: FAIL — cannot resolve `./useAgentControlSettings.js`.

- [ ] **Step 4: Write the hook**

Create `src/hooks/useAgentControlSettings.js`:

```js
import { useCallback, useEffect, useState } from "react";
import { agentControlStatusCommand, setAgentControlEnabledCommand } from "../ipc/commands.js";
import { isTauri } from "../ipc/env.js";

export function useAgentControlSettings({ settingsOpen }) {
  const [agentControlStatus, setAgentControlStatus] = useState(undefined);
  const [agentControlBusy, setAgentControlBusy] = useState(false);

  useEffect(() => {
    if (!settingsOpen || !isTauri()) return;
    let disposed = false;
    queueMicrotask(() => {
      if (!disposed) setAgentControlStatus(null);
    });
    agentControlStatusCommand()
      .then((nextStatus) => {
        if (!disposed) setAgentControlStatus(nextStatus);
      })
      .catch(() => {
        if (!disposed) {
          setAgentControlStatus({
            supported: false,
            enabled: false,
            cliInstalled: false,
            onPath: false,
            message: "Agent Control is unavailable.",
          });
        }
      });
    return () => {
      disposed = true;
    };
  }, [settingsOpen]);

  const setAgentControlEnabled = useCallback(async (enabled) => {
    if (!isTauri()) return undefined;
    setAgentControlBusy(true);
    try {
      const nextStatus = await setAgentControlEnabledCommand(enabled);
      setAgentControlStatus(nextStatus);
      return nextStatus;
    } catch (_) {
      // Leave `enabled` where it was: the endpoint did not move, and a switch that flips on a
      // failed call tells the user they granted something they did not.
      let settled;
      setAgentControlStatus((current) => {
        settled = {
          ...(current ?? {}),
          supported: current?.supported ?? true,
          enabled: current?.enabled ?? false,
          cliInstalled: current?.cliInstalled ?? false,
          onPath: current?.onPath ?? false,
          message: "Agent Control could not be changed.",
        };
        return settled;
      });
      return settled;
    } finally {
      setAgentControlBusy(false);
    }
  }, []);

  return { agentControlStatus, agentControlBusy, setAgentControlEnabled };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/hooks/useAgentControlSettings.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 6: Delete the superseded hook**

```bash
git rm src/hooks/useCliPathSettings.js
```

Run: `npx vitest run`
Expected: failures only in `src/components/AppSettingsOverlays.test.jsx` and
`src/components/SettingsPanel.test.jsx`, which Tasks 11 and 12 fix.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useAgentControlSettings.js src/hooks/useAgentControlSettings.test.js src/ipc/commands.js src/hooks/useCliPathSettings.js
git commit -m "feat(agent-control): add the Agent Control settings hook" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: The Settings row

**Files:**
- Modify: `src/components/SettingsPanel.jsx:197-221` (props and derived values)
- Modify: `src/components/SettingsPanel.jsx:614-642` (the row itself)
- Modify: `src/components/SettingsPanel.test.jsx:134-165`

- [ ] **Step 1: Write the failing test**

Replace the `renders command line PATH setup as an explicit action` case in
`src/components/SettingsPanel.test.jsx` with:

```jsx
  it("renders Agent Control as a toggle with an honest tip", () => {
    const onSetAgentControlEnabled = vi.fn();
    renderPanel({
      agentControlStatus: {
        supported: true,
        enabled: false,
        cliInstalled: true,
        onPath: false,
        message: "Allows programs on this machine to control PLVS through plvs-cli.",
      },
      onSetAgentControlEnabled,
    });

    expect(screen.getByText("Agent Control")).toBeTruthy();
    const help = screen.getByRole("button", {
      name: "Agent Control help: Allows programs on this machine to control PLVS through plvs-cli.",
    });
    fireEvent.mouseEnter(help);
    expect(
      screen.getByText("Allows programs on this machine to control PLVS through plvs-cli.")
    ).toBeTruthy();

    const toggle = screen.getByRole("switch", { name: "Agent Control" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    expect(onSetAgentControlEnabled).toHaveBeenCalledWith(true);
  });

  it("disables Agent Control where the platform has no endpoint", () => {
    renderPanel({
      agentControlStatus: {
        supported: false,
        enabled: false,
        cliInstalled: false,
        onPath: false,
        message: "Agent Control is currently available on Windows only.",
      },
    });

    expect(screen.getByRole("switch", { name: "Agent Control" }).hasAttribute("disabled")).toBe(
      true
    );
  });
```

Use whatever helper the file already uses to render the panel. If there is no `renderPanel` helper,
copy the render call from the case you are replacing and pass these props alongside its existing
ones.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/SettingsPanel.test.jsx`
Expected: FAIL — `Unable to find an element with the text: Agent Control`.

- [ ] **Step 3: Replace the props and derived values**

In `src/components/SettingsPanel.jsx`, replace the three `cliPath*` props:

```jsx
  agentControlStatus = undefined,
  agentControlBusy = false,
  onSetAgentControlEnabled = () => {},
```

and the derived block:

```jsx
  const showAgentControl = agentControlStatus !== undefined;
  const agentControlSupported = !!agentControlStatus?.supported;
  const agentControlInstalled = !!agentControlStatus?.cliInstalled;
  const agentControlEnabled = !!agentControlStatus?.enabled;
  const agentControlDisabled =
    agentControlBusy || !agentControlSupported || !agentControlInstalled;
  const agentControlMessage = agentControlStatus?.message ?? "Checking Agent Control...";
```

- [ ] **Step 4: Replace the row**

Replace the whole `{showCliPath ? ( ... ) : null}` block with:

```jsx
                {showAgentControl ? (
                  <>
                    <SettingsDivider />

                    {/* Agent control */}
                    <SettingsSection>
                      <SettingsRow
                        labelNode={
                          <SettingsLabelWithTip label="Agent Control" tip={agentControlMessage} />
                        }
                      >
                        <SettingsSwitch
                          aria-label="Agent Control"
                          checked={agentControlEnabled}
                          disabled={agentControlDisabled}
                          onCheckedChange={(next) => onSetAgentControlEnabled(next)}
                        />
                      </SettingsRow>
                    </SettingsSection>
                  </>
                ) : null}
```

Copy the exact `SettingsSwitch` prop spelling from the `Open at Login` row at
`src/components/SettingsPanel.jsx:290` — that row is the reference for how a switch is wired here.
Remove the `Terminal` icon import if nothing else in the file uses it.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/components/SettingsPanel.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/SettingsPanel.jsx src/components/SettingsPanel.test.jsx
git commit -m "feat(settings): replace the Command Line row with an Agent Control toggle" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Wire the overlay

**Files:**
- Modify: `src/components/AppSettingsOverlays.jsx:4,32,106-108`
- Modify: `src/components/AppSettingsOverlays.test.jsx:13,26-30,39,47`

- [ ] **Step 1: Update the test's mocks**

In `src/components/AppSettingsOverlays.test.jsx`, replace the `useCliPathSettings` mock:

```jsx
vi.mock("../hooks/useAgentControlSettings.js", () => ({
  useAgentControlSettings: () => ({
    agentControlStatus: { supported: true, enabled: false, cliInstalled: true, onPath: false },
    agentControlBusy: false,
    setAgentControlEnabled: mocks.setAgentControlEnabled,
  }),
}));
```

Rename the hoisted mock at line 13 from `setCliPathEnabled` to `setAgentControlEnabled`, and in the
stub `SettingsPanel` replace the `cliPathStatus` prop and its `data-testid="cli-status"` span with:

```jsx
      <span data-testid="agent-control-enabled">{String(agentControlStatus?.enabled)}</span>
```

taking `agentControlStatus` from the stub's props in place of `cliPathStatus`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/AppSettingsOverlays.test.jsx`
Expected: FAIL — the mocked module path does not match what the component imports.

- [ ] **Step 3: Wire the hook**

In `src/components/AppSettingsOverlays.jsx`, replace the import:

```jsx
import { useAgentControlSettings } from "../hooks/useAgentControlSettings.js";
```

the call:

```jsx
  const { agentControlStatus, agentControlBusy, setAgentControlEnabled } = useAgentControlSettings({
    settingsOpen: settings.settingsOpen,
  });
```

and the three props passed to `SettingsPanel`:

```jsx
        agentControlStatus={agentControlStatus}
        agentControlBusy={agentControlBusy}
        onSetAgentControlEnabled={setAgentControlEnabled}
```

Task 13 replaces that last prop again once `App.jsx` needs to hear about changes.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/AppSettingsOverlays.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/AppSettingsOverlays.jsx src/components/AppSettingsOverlays.test.jsx
git commit -m "feat(settings): wire Agent Control through the settings overlay" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: Gate the bridge on the live flag

`useAgentControlBridge` currently starts whenever the platform supports Agent Control, and calls
`agent_control_frontend_ready`, which errors when no broker is installed. With a runtime toggle the
bridge must follow the flag, so the enabled state has to live in `App.jsx` rather than inside the
settings overlay.

**Files:**
- Modify: `src/agentControl/appSnapshot.js:155-165`
- Modify: `src/agentControl/appSnapshot.test.js`
- Modify: `src/App.jsx:620`, `src/App.jsx:1242`, `src/App.jsx:1966`
- Modify: `src/components/AppSettingsOverlays.jsx`

- [ ] **Step 1: Write the failing test**

In `src/agentControl/appSnapshot.test.js`, add:

```js
it("reports the live enabled flag alongside platform availability", () => {
  globalThis.window.__PLVS_INITIAL_STATE__ = {
    agentControl: {
      available: true,
      enabled: false,
      appName: "PLVS",
      appVersion: "0.0.0",
      identifier: "com.soundoer.plvs",
      platform: "windows",
    },
  };
  expect(readAgentControlRuntime()).toMatchObject({ available: true, enabled: false });
});
```

Follow the file's existing convention for setting and clearing `__PLVS_INITIAL_STATE__` — copy the
setup and teardown from the neighbouring cases rather than writing new ones.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/agentControl/appSnapshot.test.js`
Expected: FAIL — the returned object has no `enabled` property.

- [ ] **Step 3: Report `enabled`**

In `src/agentControl/appSnapshot.js`:

```js
export function readAgentControlRuntime() {
  const injected = globalThis.window?.__PLVS_INITIAL_STATE__?.agentControl;
  if (!injected || injected.available !== true) return { available: false, enabled: false };
  return {
    available: true,
    enabled: injected.enabled === true,
    appName: injected.appName,
    appVersion: injected.appVersion,
    identifier: injected.identifier,
    platform: injected.platform,
  };
}
```

- [ ] **Step 4: Hold the flag in App state and gate the bridge**

In `src/App.jsx`, replace line 620:

```jsx
  const agentControlRuntime = useMemo(readAgentControlRuntime, []);
  const [agentControlEnabled, setAgentControlEnabled] = useState(
    () => agentControlRuntime.enabled === true
  );
```

Replace the bridge's `enabled` prop at line 1242:

```jsx
    enabled: agentControlRuntime.available === true && agentControlEnabled,
```

Pass the setter to the overlay at line 1966, alongside the props already there:

```jsx
        onAgentControlEnabledChange={setAgentControlEnabled}
```

- [ ] **Step 5: Report changes upward from the overlay**

In `src/components/AppSettingsOverlays.jsx`, accept the new prop:

```jsx
export function AppSettingsOverlays({
  settings,
  channelSettings,
  updateControls,
  appVersion,
  loudnessProfile,
  onAgentControlEnabledChange = () => {},
}) {
```

and replace the prop passed to `SettingsPanel`:

```jsx
        onSetAgentControlEnabled={async (next) => {
          const status = await setAgentControlEnabled(next);
          onAgentControlEnabledChange(status?.enabled === true);
        }}
```

The hook already returns the settled status (Task 10, Step 4).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/agentControl src/hooks/useAgentControlSettings.test.js src/components/AppSettingsOverlays.test.jsx`
Expected: PASS.

Run: `npx vitest run src/App.smoke.test.jsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/App.jsx src/agentControl/appSnapshot.js src/agentControl/appSnapshot.test.js src/components/AppSettingsOverlays.jsx
git commit -m "feat(agent-control): follow the toggle at runtime in the React bridge" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 14: Documentation

**Files:**
- Modify: `docs/cli.md:5-9` and its `Commands` block
- Modify: `docs/agent-control/README.md`

- [ ] **Step 1: Update `docs/cli.md`**

Replace the paragraph that calls the `app` family development-only:

```markdown
The audio-facing command surface does not route or modify audio. `profile import` can replace stored
desktop configuration. The `app` family inspects and controls the live workspace of an
already-running PLVS window; it requires Agent Control to be enabled in PLVS Settings, and is
Windows-only for now. With Agent Control off, `app` commands exit with
`Agent Control is disabled. Enable it in PLVS Settings.`
```

Add `plvs-cli app <command> [options]` to the `Commands` block, after the `report` line.

- [ ] **Step 2: Update `docs/agent-control/README.md`**

- In "This directory records the implemented developer-only App Control contract.", drop
  "developer-only".
- Replace the paragraph beginning "These commands are development-only." with:

```markdown
These commands require Agent Control to be enabled in PLVS Settings, which is off by default in
release builds and on in development builds. Every mutation is delivered to the already-running
React application and uses the same state, native integrations, safety guards, and persistence
paths as the GUI.
```

- In "Implementation status", replace "Production exposure and MCP integration remain deferred
  product decisions." with "MCP integration remains a deferred product decision."

- [ ] **Step 3: Commit**

```bash
git add docs/cli.md docs/agent-control/README.md
git commit -m "docs(agent-control): describe the setting instead of a build gate" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 15: The merge gate and the manual checks

- [ ] **Step 1: Run the full gate**

Run: `npm run check`
Expected: PASS. If `scripts/tauriSecurityConfig.test.js` or `scripts/tauriDependencyContract.test.js`
fail, that is a Rust or installer config problem surfacing as a JavaScript test — fix the config,
not the test.

- [ ] **Step 2: Run the app and walk the manual checklist**

These paths CI cannot reach: Windows-only, and they need a running application. Run
`npm run desktop`, then verify each and record what you saw:

1. **Development default.** Settings shows `Agent Control` on.
   `npm run desktop:control -- inspect --json` returns a snapshot.
2. **Turn it off.** The switch goes off. `npm run desktop:control -- inspect --json` exits non-zero
   with `Agent Control is disabled. Enable it in PLVS Settings.`
3. **Turn it back on.** No restart. `inspect` works again immediately.
4. **Restart.** Close and relaunch PLVS; the switch is where you left it, and `inspect` agrees.
5. **App closed.** With the toggle on, quit PLVS. `inspect` exits non-zero with
   `PLVS is not running.` — not the disabled message.
6. **PATH follows the toggle.** With it on, a fresh terminal runs `plvs-cli --help`. With it off, a
   fresh terminal no longer finds `plvs-cli` on PATH.
7. **An existing PATH entry survives an upgrade.** With the toggle off, add the install directory to
   the user PATH by hand, restart PLVS, and confirm the entry is still there and the switch is still
   off. Nothing on the boot path may touch PATH — only the toggle does.
8. **In-flight request.** Start a long call —
   `npm run desktop:control -- wait --workspace-revision <current> --json` — and turn the toggle off
   while it is waiting. It must return an answer or a clean error, not hang until its own timeout.

- [ ] **Step 3: Report the results**

Report each numbered check as pass or fail with what you saw. Do not report the feature complete on
a green `npm run check` alone — the checks above are the only coverage this surface has.

- [ ] **Step 4: Say what was not run**

No capture-layer files are touched by this plan, so `smoke:capture` and `soak:capture` are not
required. State that explicitly rather than leaving it unsaid.
