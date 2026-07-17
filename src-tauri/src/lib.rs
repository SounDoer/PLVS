#[cfg(target_os = "windows")]
mod appbar;
mod audio;
pub mod cli_analyze;
pub mod cli_analyze_batch;
pub mod cli_capture;
pub mod cli_main;
mod cli_path;
pub mod cli_report;
mod dock;
mod dock_accessories;
pub mod doctor;
mod dsp;
mod engine;
mod file_analysis;
mod glass_effect;
mod ipc;
mod profile;
mod sidecar;
mod state;
pub mod vad;
mod window_state;

use std::time::Duration;

use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_store::StoreExt;

pub use audio::{AppAudioBackend, AudioCapture, AudioCaptureSession, DeviceInfo, PcmFrame};

use crate::window_state::{
  clamp_to_visible, clean_active_preset_window_bounds, startup_window_is_frameless, MonitorRect,
  WindowBounds,
};
use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_autostart::init(
      tauri_plugin_autostart::MacosLauncher::LaunchAgent,
      None,
    ))
    .plugin(tauri_plugin_store::Builder::default().build())
    .plugin(tauri_plugin_global_shortcut::Builder::new().build())
    .plugin(tauri_plugin_dialog::init())
    .manage(AppState::default())
    .manage(dock::DockedFlag(std::sync::Arc::new(
      std::sync::atomic::AtomicBool::new(false),
    )))
    .manage(dock::DockBootReady(std::sync::Arc::new(
      std::sync::atomic::AtomicBool::new(false),
    )))
    .invoke_handler(tauri::generate_handler![
      ipc::commands::list_audio_devices,
      ipc::commands::preview_audio_device,
      ipc::commands::migrate_capture_device_id,
      ipc::commands::audio_start,
      ipc::commands::set_analysis_requests,
      ipc::commands::set_loudness_weights,
      ipc::commands::set_dialogue_gating,
      ipc::commands::set_dialogue_vad_engine,
      ipc::commands::ack_frames,
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
      glass_effect::set_glass_effect,
    ])
    .setup(|app| {
      #[cfg(debug_assertions)]
      app.handle().plugin(
        tauri_plugin_log::Builder::default()
          .level(log::LevelFilter::Info)
          .build(),
      )?;

      // --- Persistence: read store, inject initial state, restore window (pre-paint) ---
      // Note: the JS pluginStoreBackend uses "plvs:settings" / "plvs:workspace" as store keys.
      let store = app
        .store("plvs-settings.json")
        .map_err(|e| format!("store load: {e}"))?;

      let settings = store.get("plvs:settings").unwrap_or(serde_json::json!({}));
      let workspace = store.get("plvs:workspace").unwrap_or(serde_json::json!({}));
      let presets = store.get("plvs:presets").unwrap_or(serde_json::json!({}));
      let themes = store.get("plvs:themes").unwrap_or(serde_json::json!({}));
      let dock_state: Option<dock::DockStateRecord> = store
        .get(dock::DOCK_STATE_KEY)
        .and_then(|value| serde_json::from_value(value).ok())
        .map(dock::DockStateRecord::normalize_for_platform);
      #[cfg(not(target_os = "windows"))]
      if let Some(state) = dock_state.as_ref() {
        dock::write_dock_state(app.handle(), state);
      }
      let initial = serde_json::json!({
        "plvs:settings": settings,
        "plvs:workspace": workspace,
        "plvs:presets": presets,
        "plvs:themes": themes,
        "dockState": dock_state,
      });
      let init_script = format!("window.__PLVS_INITIAL_STATE__ = {};", initial);

      // windowBounds is a Rust-owned sibling key (not inside plvs:settings) so JS settings
      // writes cannot clobber geometry Rust saves. See window_state::save_window_bounds.
      let saved_bounds: Option<WindowBounds> =
        clean_active_preset_window_bounds(&presets).or_else(|| {
          store
            .get("windowBounds")
            .and_then(|v| serde_json::from_value(v).ok())
        });
      let boot_dock = dock_state;
      let boot_docked = boot_dock.as_ref().map(|d| d.enabled).unwrap_or(false);
      let initial_decorations = !boot_docked && !startup_window_is_frameless(&settings, &presets);

      let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
        .title("PLVS")
        .resizable(true)
        .decorations(initial_decorations)
        .visible(false);
      #[cfg(any(target_os = "windows", target_os = "macos"))]
      let builder = builder.transparent(true);

      let window = builder
        .inner_size(1280.0, 960.0)
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
        if let Err(e) = dock::apply_dock_form(&window, d.edge, d.monitor.as_deref(), d.height) {
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
        if let Some(b) = saved_bounds {
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
          let clamped = clamp_to_visible(b, &monitors);
          let _ = window.set_size(tauri::PhysicalSize::new(clamped.width, clamped.height));
          let _ = window.set_position(tauri::PhysicalPosition::new(clamped.x, clamped.y));
          if b.is_maximized {
            let _ = window.maximize();
          }
        }
      }
      let _ = window.show();

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
          let mut prev: Option<Vec<crate::audio::DeviceInfo>> = None;
          loop {
            std::thread::sleep(Duration::from_secs(2));
            if let Ok(list) =
              crate::audio::AudioCapture::list_devices(&crate::audio::AppAudioBackend)
            {
              if prev.as_ref() != Some(&list) {
                prev = Some(list.clone());
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
