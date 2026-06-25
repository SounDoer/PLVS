mod audio;
mod dsp;
mod engine;
mod file_analysis;
mod ipc;
mod state;
mod window_state;

use std::time::Duration;

use tauri::{Emitter, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_store::StoreExt;

pub use audio::{AppAudioBackend, AudioCapture, AudioCaptureSession, DeviceInfo, PcmFrame};

use crate::window_state::{clamp_to_visible, MonitorRect, WindowBounds};
use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_autostart::init(
      tauri_plugin_autostart::MacosLauncher::LaunchAgent,
      None,
    ))
    .plugin(tauri_plugin_store::Builder::default().build())
    .plugin(tauri_plugin_global_shortcut::Builder::new().build())
    .plugin(tauri_plugin_dialog::init())
    .manage(AppState::default())
    .invoke_handler(tauri::generate_handler![
      ipc::commands::list_audio_devices,
      ipc::commands::preview_audio_device,
      ipc::commands::migrate_capture_device_id,
      ipc::commands::audio_start,
      ipc::commands::set_analysis_requests,
      ipc::commands::set_loudness_weights,
      ipc::commands::set_dialogue_gating,
      ipc::commands::ack_frames,
      ipc::commands::audio_stop,
      ipc::commands::file_analysis_probe,
      ipc::commands::file_analysis_start,
      ipc::commands::file_analysis_stop,
      ipc::commands::clear_audio_history,
      ipc::commands::get_engine_state,
      window_state::current_window_bounds,
      window_state::apply_window_bounds,
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
      let initial = serde_json::json!({
        "plvs:settings": settings,
        "plvs:workspace": workspace,
        "plvs:presets": presets,
        "plvs:themes": themes,
      });
      let init_script = format!("window.__PLVS_INITIAL_STATE__ = {};", initial);

      // windowBounds is a Rust-owned sibling key (not inside plvs:settings) so JS settings
      // writes cannot clobber geometry Rust saves. See window_state::save_window_bounds.
      let saved_bounds: Option<WindowBounds> = store
        .get("windowBounds")
        .and_then(|v| serde_json::from_value(v).ok());

      let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
        .title("PLVS")
        .resizable(true)
        .visible(false);
      #[cfg(target_os = "windows")]
      let builder = builder.transparent(true);

      let window = builder
        .inner_size(1280.0, 860.0)
        .initialization_script(&init_script)
        .build()
        .map_err(|e| format!("window build: {e}"))?;

      // Saved bounds are PHYSICAL pixels (saved from inner_size + outer_position). Restore
      // them with physical setters: the builder's inner_size/position take LOGICAL pixels,
      // so on a scaled display (e.g. 150%) restoring through the builder double-scales and
      // the window grows + drifts on every relaunch. set_size/set_position take physical,
      // matching the save path and the (physical) monitor rects used for clamping.
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
      let _ = window.show();

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
        std::thread::Builder::new()
          .name("window-state-flush".into())
          .spawn(move || loop {
            std::thread::sleep(Duration::from_millis(400));
            if dirty.swap(false, Ordering::Relaxed) {
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
