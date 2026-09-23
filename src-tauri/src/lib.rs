pub mod agent_control;
#[cfg(target_os = "windows")]
mod appbar;
mod audio;
pub mod cli_analyze;
pub mod cli_capture;
pub mod cli_contract;
pub mod cli_control;
pub mod cli_devices;
pub mod cli_main;
pub mod cli_manifest;
mod cli_path;
pub mod cli_probe;
pub mod cli_profile;
pub mod cli_report;
pub mod coordinator;
mod crash_report;
mod dock;
mod dock_accessories;
pub mod doctor;
mod dsp;
mod engine;
mod file_analysis;
mod glass_effect;
#[cfg(feature = "capture-harness")]
pub mod harness_main;
mod ipc;
pub mod persistence;
mod profile;
pub mod runtime_diagnostics;
pub mod runtime_identity;
mod sidecar;
mod state;
pub mod vad;
pub mod visual_capture;
mod window_chrome;
mod window_state;

use std::time::Duration;

use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

#[cfg(target_os = "macos")]
pub use audio::macos_capture_apps::{list_capture_applications, CaptureApplication};
#[cfg(target_os = "windows")]
pub use audio::windows_capture_apps::{list_capture_applications, CaptureApplication};
#[cfg(target_os = "windows")]
pub use audio::windows_process_loopback::{
  capture_process_to_summary, capture_process_to_summary_with_channels,
  capture_process_to_summary_with_format, ProcessLoopbackProbeResult,
};
pub use audio::{
  AppAudioBackend, AudioCapture, AudioCaptureSession, DeviceInfo, MeasuredPcmReceiver,
  MeasuredPcmSubscriptions, PcmFrame,
};

use crate::window_state::{
  clamp_to_visible, clean_active_preset_window_bounds, default_window_bounds, primary_fit_target,
  startup_window_is_frameless, MonitorRect, WindowBounds, DEFAULT_WINDOW_LOGICAL_HEIGHT,
  DEFAULT_WINDOW_LOGICAL_WIDTH,
};
use state::AppState;

/// The pre-paint snapshot the webview reads synchronously, as an initialization script.
///
/// Three independent readers take one slice each, at different points in the module graph:
/// `persistence/pluginStoreBackend.js` (the four `plvs:*` domain keys), `hooks/useDockMode.js`
/// (`dockState`) and `agentControl/appSnapshot.js` (`agentControl`). A misspelled or dropped key
/// does not fail anywhere -- the reader sees `undefined` and falls back to its defaults, which
/// reaches the user as an app that came up empty. Kept separate from `setup` so the key set and
/// the pass-through can be tested; `setup` only supplies the values.
#[derive(serde::Serialize)]
struct InitialStateValues<'a> {
  #[serde(rename = "plvs:settings")]
  settings: &'a serde_json::Value,
  #[serde(rename = "plvs:workspace")]
  workspace: &'a serde_json::Value,
  #[serde(rename = "plvs:presets")]
  presets: &'a serde_json::Value,
  #[serde(rename = "plvs:themes")]
  themes: &'a serde_json::Value,
  #[serde(rename = "dockState")]
  dock_state: &'a Option<dock::DockStateRecord>,
  #[serde(rename = "agentControl")]
  agent_control: &'a serde_json::Value,
  #[serde(rename = "captureDeviceId")]
  capture_device_id: &'a serde_json::Value,
  #[serde(rename = "globalPreferences")]
  global_preferences: &'a serde_json::Value,
  #[serde(rename = "multiInstancePersistence")]
  multi_instance_persistence: &'a serde_json::Value,
  #[serde(rename = "isCoordinator")]
  is_coordinator: bool,
}

fn initial_state_script(initial: InitialStateValues<'_>) -> String {
  format!(
    "window.__PLVS_INITIAL_STATE__ = {};",
    serde_json::to_string(&initial).expect("initial state is serializable")
  )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_process::init());
  #[cfg(not(feature = "preview-identity"))]
  let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

  builder
    .plugin(tauri_plugin_autostart::init(
      tauri_plugin_autostart::MacosLauncher::LaunchAgent,
      None,
    ))
    .plugin(tauri_plugin_store::Builder::default().build())
    .plugin(tauri_plugin_global_shortcut::Builder::new().build())
    .plugin(tauri_plugin_dialog::init())
    .plugin(
      tauri_plugin_log::Builder::default()
        .level(log::LevelFilter::Info)
        .max_file_size(2_000_000)
        .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(3))
        .build(),
    )
    .manage(AppState::default())
    .manage(persistence::commands::PersistenceRuntime::default())
    .manage(agent_control::broker::AgentControlState::default())
    .manage(agent_control::transport::ServerState::default())
    .manage(agent_control::toggle::StartFailure::default())
    .manage(visual_capture::ScreenshotCaptureState::default())
    .manage(visual_capture::recording::RecordingController::default())
    .manage(dock::DockedFlag(std::sync::Arc::new(
      std::sync::atomic::AtomicBool::new(false),
    )))
    .manage(dock::DockBootReady(std::sync::Arc::new(
      std::sync::atomic::AtomicBool::new(false),
    )))
    .invoke_handler(tauri::generate_handler![
      ipc::commands::list_audio_devices,
      ipc::commands::list_capture_applications,
      ipc::commands::preview_audio_device,
      ipc::commands::migrate_capture_device_id,
      ipc::commands::audio_start,
      ipc::commands::set_analysis_requests,
      ipc::commands::set_channel_roles,
      ipc::commands::set_dialogue_gating,
      ipc::commands::set_dialogue_vad_engine,
      ipc::commands::ack_frames,
      ipc::commands::get_ui_frame_diagnostics,
      ipc::commands::audio_stop,
      ipc::commands::file_analysis_probe,
      ipc::commands::file_analysis_start,
      ipc::commands::file_analysis_stop,
      ipc::commands::clear_audio_history,
      ipc::commands::reset_true_peak_max,
      ipc::commands::get_engine_state,
      profile::export_profile,
      profile::import_profile,
      profile::reset_profile,
      profile::read_profile_file,
      profile::write_profile_file,
      profile::write_text_file,
      persistence::commands::persistence_hydrate,
      persistence::commands::persistence_save_domain,
      persistence::commands::persistence_save_workspace_value,
      persistence::commands::persistence_save_global_preferences,
      persistence::commands::persistence_library_create,
      persistence::commands::persistence_library_update,
      persistence::commands::persistence_library_delete,
      persistence::commands::persistence_library_reorder,
      persistence::commands::persistence_library_replace,
      coordinator::runtime_publish_instance_state,
      coordinator::runtime_list_instances,
      cli_path::cli_path_status,
      cli_path::set_cli_path_enabled,
      window_state::current_window_bounds,
      window_state::apply_window_bounds,
      dock::enter_dock,
      dock::exit_dock,
      dock::get_dock_state,
      dock::set_dock_reserve_space,
      dock::set_dock_suspended,
      dock::set_dock_height,
      dock_accessories::set_dock_accessories,
      dock_accessories::cursor_over_dock_surfaces,
      glass_effect::set_glass_effect,
      window_chrome::sync_main_webview_size,
      agent_control::broker::agent_control_frontend_ready,
      agent_control::broker::agent_control_frontend_not_ready,
      agent_control::broker::agent_control_respond,
      agent_control::toggle::agent_control_status,
      agent_control::toggle::set_agent_control_enabled,
      visual_capture::visual_capture_capabilities,
      visual_capture::visual_capture_screenshot,
      visual_capture::visual_recording_start,
      visual_capture::visual_recording_inspect,
      visual_capture::visual_recording_update_audio_state,
      visual_capture::visual_recording_update_geometry,
      visual_capture::visual_recording_stop,
      ipc::commands::record_frontend_crash,
      ipc::commands::log_frontend_error,
      ipc::commands::read_pending_crash_report,
      ipc::commands::discard_crash_report,
      ipc::commands::set_crash_prompt_enabled,
      ipc::commands::read_feedback_diagnostics,
    ])
    .setup(|app| {
      let artifact_store = visual_capture::artifacts::ArtifactStore::initialize(
        &app
          .path()
          .app_data_dir()
          .map_err(|error| error.to_string())?,
      )
      .map_err(|error| format!("agent artifact storage: {error}"))?;
      app.manage(artifact_store);

      // --- Persistence: migrate once, hydrate the selected Workspace, restore pre-paint state. ---
      let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("app data directory: {error}"))?;
      let legacy_store_path = app_data_dir.join("plvs-settings.json");
      let prepared = persistence::prepare_identity_storage(&app_data_dir, &legacy_store_path)?;
      let (workspace_id, session) = persistence::open_ordinary_launch_workspace(&prepared.root)?;
      let runtime_identity = runtime_identity::RuntimeIdentity::new_for_workspace(&workspace_id)?;
      log::info!(
        "runtime identity instance={} workspace={}",
        runtime_identity.instance_id(),
        runtime_identity.workspace_id()
      );
      let coordinator_role =
        coordinator::CoordinatorRole::acquire(&prepared.root, &runtime_identity)?;
      let is_coordinator = coordinator_role.is_coordinator();
      let registry = coordinator::InstanceRegistry::open(&prepared.root)?;
      let _ = registry.remove_stale()?;
      let registration = registry.register(
        &runtime_identity,
        &coordinator::InstanceRuntimeState {
          source_label: None,
          capture_status: coordinator::CaptureStatus::Stopped,
          visible: true,
          focus_sequence: 0,
        },
      )?;
      app.manage(runtime_identity);
      app.manage(coordinator_role);
      app.manage(registration);
      app.manage(registry);
      let hydrated = session.hydrate()?;
      app
        .state::<persistence::commands::PersistenceRuntime>()
        .install(session)?;

      let settings = hydrated.settings;
      let workspace = hydrated.workspace;
      let presets = hydrated.presets;
      let themes = hydrated.themes;
      let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|error| format!("app log directory: {error}"))?;
      let home = app
        .path()
        .home_dir()
        .map_err(|error| format!("home directory for crash-report redaction: {error}"))?
        .to_string_lossy()
        .into_owned();
      let reporter = std::sync::Arc::new(crash_report::CrashReporterState::new(
        log_dir,
        app.package_info().name.clone(),
        home,
        crash_report::prompt_enabled_from_settings(&settings),
        crash_report::CrashApp {
          version: env!("CARGO_PKG_VERSION").into(),
          os: std::env::consts::OS.into(),
          arch: std::env::consts::ARCH.into(),
        },
      )?);
      if let Err(error) = reporter.enrich_pending(200) {
        log::warn!("Unable to enrich saved crash reports: {error}");
      }
      log::info!(
        "{}",
        crash_report::session_start_marker(reporter.session_id())
      );
      crash_report::install_panic_hook(reporter.clone());
      app.manage(reporter);

      #[cfg(feature = "crash-test")]
      match std::env::var("PLVS_TEST_PANIC").as_deref() {
        Ok("main") => panic!("PLVS crash-test panic on main thread"),
        Ok("thread") => {
          let _ = std::thread::Builder::new()
            .name("crash-test".into())
            .spawn(|| panic!("PLVS crash-test panic on worker thread"))
            .and_then(|thread| {
              thread
                .join()
                .map_err(|_| std::io::Error::other("crash-test thread panicked"))
            });
        }
        _ => {}
      }
      let agent_control_enabled = hydrated
        .global_preferences
        .get(agent_control::toggle::ENABLED_KEY)
        .and_then(serde_json::Value::as_bool)
        .unwrap_or_else(agent_control::toggle::default_enabled);
      let agent_control = serde_json::json!({
        // `available` is platform support alone. Whether the endpoint is actually open is
        // `enabled`, which the user owns from Settings.
        "available": cfg!(any(target_os = "windows", target_os = "macos")),
        "enabled": cfg!(any(target_os = "windows", target_os = "macos")) && agent_control_enabled,
        "appName": env!("PLVS_APP_NAME"),
        "appVersion": env!("CARGO_PKG_VERSION"),
        "identifier": env!("PLVS_APP_ID"),
        "platform": std::env::consts::OS,
      });
      let dock_state: Option<dock::DockStateRecord> = serde_json::from_value(hydrated.dock_state)
        .ok()
        .map(dock::DockStateRecord::normalize_for_platform);
      #[cfg(not(target_os = "windows"))]
      if let Some(state) = dock_state.as_ref() {
        dock::write_dock_state(app.handle(), state);
      }
      let global_preferences = serde_json::to_value(&hydrated.global_preferences)
        .map_err(|error| format!("global preference boot snapshot: {error}"))?;
      let multi_instance_persistence = serde_json::json!({
        "itemRevisions": hydrated.library_item_revisions,
        "collectionRevisions": hydrated.library_collection_revisions,
        "globalPreferenceRevisions": hydrated.global_preference_revisions,
      });
      let init_script = initial_state_script(InitialStateValues {
        settings: &settings,
        workspace: &workspace,
        presets: &presets,
        themes: &themes,
        dock_state: &dock_state,
        agent_control: &agent_control,
        capture_device_id: &hydrated.capture_device_id,
        global_preferences: &global_preferences,
        multi_instance_persistence: &multi_instance_persistence,
        is_coordinator,
      });

      // windowBounds is a Rust-owned sibling key (not inside plvs:settings) so JS settings
      // writes cannot clobber geometry Rust saves. See window_state::save_window_bounds.
      let saved_bounds: Option<WindowBounds> = clean_active_preset_window_bounds(&presets)
        .or_else(|| serde_json::from_value(hydrated.window_bounds).ok());
      let boot_dock = dock_state;
      let boot_docked = boot_dock.as_ref().map(|d| d.enabled).unwrap_or(false);
      let initial_decorations = !boot_docked && !startup_window_is_frameless(&settings, &presets);
      let window_title = env!("PLVS_APP_NAME");

      let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
        .title(window_title)
        .resizable(true)
        .decorations(initial_decorations)
        .visible(false);
      #[cfg(any(target_os = "windows", target_os = "macos"))]
      let builder = builder.transparent(true);

      let window = builder
        .inner_size(DEFAULT_WINDOW_LOGICAL_WIDTH, DEFAULT_WINDOW_LOGICAL_HEIGHT)
        .initialization_script(&init_script)
        .build()
        .map_err(|e| format!("window build: {e}"))?;

      if let Err(error) = dock_accessories::create(app, &init_script) {
        log::warn!("dock accessories unavailable; normal mode will continue: {error}");
      }

      // Saved bounds are PHYSICAL pixels (saved from inner_size + outer_position). Restore
      // them with physical setters: the builder's inner_size/position take LOGICAL pixels,
      // so on a scaled display (e.g. 150%) restoring through the builder double-scales and
      // the window grows + drifts on every relaunch. set_size/set_position take physical,
      // matching the save path and the (physical) monitor rects used for clamping.
      if boot_docked {
        let d = boot_dock.as_ref().expect("boot_docked requires dock state");
        app
          .state::<dock::DockedFlag>()
          .0
          .store(true, std::sync::atomic::Ordering::Relaxed);
        // Boot: the window was just built in normal form, so a failed dock
        // restore rolls back to a normal window (shadow on) even when
        // `initial_decorations` made it borderless.
        if let Err(e) =
          dock::apply_dock_form(&window, d.edge, d.monitor.as_deref(), d.height, false)
        {
          log::warn!("dock restore failed, falling back to normal bounds: {e}");
          app
            .state::<dock::DockedFlag>()
            .0
            .store(false, std::sync::atomic::Ordering::Relaxed);
          let mut failed = d.clone();
          failed.enabled = false;
          dock::write_dock_state(window.app_handle(), &failed);
        }
      }
      let restore_normal = !app
        .state::<dock::DockedFlag>()
        .0
        .load(std::sync::atomic::Ordering::Relaxed);
      if restore_normal {
        let monitors: Vec<MonitorRect> = window
          .available_monitors()
          .unwrap_or_default()
          .iter()
          .map(|m| MonitorRect {
            x: m.position().x,
            y: m.position().y,
            width: m.size().width,
            height: m.size().height,
          })
          .collect();
        let fit = primary_fit_target(&window, &monitors);
        // Size, position, size: on Windows a move onto a monitor with another DPI rescales the
        // size set before it; on macOS a content-size change keeps the bottom-left corner, so the
        // size must already be final when the top-left is placed.
        if let Some(b) = saved_bounds {
          let clamped = clamp_to_visible(b, &monitors, fit);
          let _ = window.set_size(tauri::PhysicalSize::new(clamped.width, clamped.height));
          let _ = window.set_position(tauri::PhysicalPosition::new(clamped.x, clamped.y));
          let _ = window.set_size(tauri::PhysicalSize::new(clamped.width, clamped.height));
          if b.is_maximized {
            let _ = window.maximize();
          }
        } else if !monitors.is_empty() {
          // First launch: nothing saved, so apply the first-run rule instead of leaving placement to
          // the OS, which cascades from the top-left on Windows.
          let placed = default_window_bounds(fit);
          let _ = window.set_size(tauri::PhysicalSize::new(placed.width, placed.height));
          let _ = window.set_position(tauri::PhysicalPosition::new(placed.x, placed.y));
          let _ = window.set_size(tauri::PhysicalSize::new(placed.width, placed.height));
        }
      }
      let _ = window.show();

      if is_coordinator
        && cfg!(any(target_os = "windows", target_os = "macos"))
        && agent_control_enabled
      {
        agent_control::toggle::start_at_launch(app.handle());
      }

      {
        let handle = app.handle().clone();
        window.on_window_event(move |event| {
          if matches!(event, tauri::WindowEvent::Destroyed) {
            handle
              .state::<visual_capture::recording::RecordingController>()
              .shutdown_and_wait(Duration::from_secs(2));
            handle
              .state::<agent_control::transport::ServerState>()
              .stop();
          }
        });
      }

      #[cfg(target_os = "windows")]
      appbar::install_window_subclass(&window).map_err(|e| format!("appbar subclass: {e}"))?;

      #[cfg(target_os = "windows")]
      if app
        .state::<dock::DockedFlag>()
        .0
        .load(std::sync::atomic::Ordering::Relaxed)
        && boot_dock.as_ref().is_some_and(|d| d.reserve_space)
      {
        if let Some(d) = boot_dock.as_ref() {
          if let Err(e) = appbar::set_reserved(&window, true, d.edge, d.height) {
            log::warn!("appbar restore failed, continuing as overlay dock: {e}");
            let mut overlay = d.clone();
            overlay.reserve_space = false;
            dock::write_dock_state(window.app_handle(), &overlay);
          }
        }
      }

      app
        .state::<dock::DockBootReady>()
        .0
        .store(true, std::sync::atomic::Ordering::Release);

      // Persist geometry on move/resize, debounced via a dirty flag + short flush thread.
      use std::sync::atomic::{AtomicBool, Ordering};
      use std::sync::Arc as StdArc;
      let dirty = StdArc::new(AtomicBool::new(false));
      {
        let dirty = dirty.clone();
        window.on_window_event(move |event| {
          if matches!(
            event,
            tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_)
          ) {
            dirty.store(true, Ordering::Relaxed);
          }
        });
      }
      {
        let dirty = dirty.clone();
        let win = window.clone();
        let docked = app.state::<dock::DockedFlag>().0.clone();
        std::thread::Builder::new()
          .name("window-state-flush".into())
          .spawn(move || loop {
            std::thread::sleep(Duration::from_millis(400));
            if dirty.swap(false, Ordering::Relaxed) && !docked.load(Ordering::Relaxed) {
              crate::window_state::save_window_bounds(&win);
            }
          })
          .map_err(|e| format!("window-state thread: {e}"))?;
      }

      let handle = app.handle().clone();
      std::thread::Builder::new()
        .name("device-watch".into())
        .spawn(move || {
          let mut prev: Option<(Vec<crate::audio::DeviceInfo>, Option<String>)> = None;
          loop {
            std::thread::sleep(Duration::from_secs(2));
            if let Ok(list) =
              crate::audio::AudioCapture::list_devices(&crate::audio::AppAudioBackend)
            {
              // Switching the system default output leaves the list untouched but moves
              // Automatic capture to another device, so the observation includes the default.
              let default_output = crate::audio::cpal_backend::preview_device("default")
                .ok()
                .map(|(label, ..)| label);
              let observed = (list, default_output);
              if prev.as_ref() != Some(&observed) {
                let list = observed.0.clone();
                prev = Some(observed);
                let _ = handle.emit("device-list-changed", list);
              }
            }
          }
        })
        .map_err(|e| format!("device watch thread: {e}"))?;
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;

  /// Reads the snapshot back the way the webview does: the global's name is part of the
  /// contract, so parse through it rather than around it.
  fn parse_snapshot(script: &str) -> serde_json::Value {
    let body = script
      .strip_prefix("window.__PLVS_INITIAL_STATE__ = ")
      .and_then(|rest| rest.strip_suffix(';'))
      .unwrap_or_else(|| panic!("script does not assign the global the frontend reads: {script}"));
    serde_json::from_str(body).expect("snapshot body is JSON")
  }

  fn dock_record() -> dock::DockStateRecord {
    dock::DockStateRecord {
      enabled: true,
      edge: dock::DockEdge::Top,
      monitor: Some("\\\\.\\DISPLAY1".into()),
      reserve_space: true,
      height: 96,
    }
  }

  #[test]
  fn injects_every_key_the_frontend_reads() {
    let snapshot = parse_snapshot(&initial_state_script(InitialStateValues {
      settings: &json!({}),
      workspace: &json!({}),
      presets: &json!({}),
      themes: &json!({}),
      dock_state: &None,
      agent_control: &json!({}),
      capture_device_id: &json!("default"),
      global_preferences: &json!({}),
      multi_instance_persistence: &json!({}),
      is_coordinator: true,
    }));
    let mut keys: Vec<&String> = snapshot
      .as_object()
      .expect("snapshot is an object")
      .keys()
      .collect();
    keys.sort();
    assert_eq!(
      keys,
      vec![
        "agentControl",
        "captureDeviceId",
        "dockState",
        "globalPreferences",
        "isCoordinator",
        "multiInstancePersistence",
        "plvs:presets",
        "plvs:settings",
        "plvs:themes",
        "plvs:workspace",
      ]
    );
    // `dockState` is spelled twice in Rust: as the literal above and as `dock::DOCK_STATE_KEY`,
    // which is what `store.get` reads -- the injected value *is* that key's value. Nothing else
    // ties the two together, so renaming one alone still compiles and the only symptom is dock
    // state failing to come back at boot.
    assert!(
      keys.iter().any(|key| key.as_str() == dock::DOCK_STATE_KEY),
      "the injected snapshot must carry the key `store.get` reads: {}",
      dock::DOCK_STATE_KEY
    );
  }

  #[test]
  fn passes_each_domain_value_through_unreshaped() {
    let settings = json!({ "referenceLufs": -20, "nested": { "a": [1, 2] } });
    let workspace = json!({ "panelOrder": ["loudness", "spectrum"] });
    let presets = json!({ "list": [{ "id": "p1" }], "activeId": "p1" });
    let themes = json!({ "custom": [] });
    let agent_control = json!({ "available": true, "enabled": false });
    let snapshot = parse_snapshot(&initial_state_script(InitialStateValues {
      settings: &settings,
      workspace: &workspace,
      presets: &presets,
      themes: &themes,
      dock_state: &None,
      agent_control: &agent_control,
      capture_device_id: &json!("default"),
      global_preferences: &json!({}),
      multi_instance_persistence: &json!({}),
      is_coordinator: true,
    }));
    assert_eq!(snapshot["plvs:settings"], settings);
    assert_eq!(snapshot["plvs:workspace"], workspace);
    assert_eq!(snapshot["plvs:presets"], presets);
    assert_eq!(snapshot["plvs:themes"], themes);
    assert_eq!(snapshot["agentControl"], agent_control);
  }

  #[test]
  fn carries_dock_state_under_the_field_names_the_frontend_reads() {
    let snapshot = parse_snapshot(&initial_state_script(InitialStateValues {
      settings: &json!({}),
      workspace: &json!({}),
      presets: &json!({}),
      themes: &json!({}),
      dock_state: &Some(dock_record()),
      agent_control: &json!({}),
      capture_device_id: &json!("default"),
      global_preferences: &json!({}),
      multi_instance_persistence: &json!({}),
      is_coordinator: true,
    }));
    // `normalizeDockState` in hooks/useDockMode.js reads exactly these names, and a mismatch
    // reads as a default rather than an error -- `reserveSpace` even defaults to the opposite.
    assert_eq!(
      snapshot["dockState"],
      json!({
        "enabled": true,
        "edge": "top",
        "monitor": "\\\\.\\DISPLAY1",
        "reserveSpace": true,
        "height": 96,
      })
    );
  }
}
