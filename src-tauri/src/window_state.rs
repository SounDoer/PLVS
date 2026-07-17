use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{Emitter, Manager};
use tauri_plugin_store::StoreExt;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct WindowBounds {
  pub x: i32,
  pub y: i32,
  pub width: u32,
  pub height: u32,
  // JS shape is `isMaximized`; rename so the JS/Rust JSON matches exactly.
  #[serde(rename = "isMaximized", default)]
  pub is_maximized: bool,
}

/// A monitor's visible rectangle (position + size), in physical pixels.
#[derive(Debug, Clone, Copy)]
pub struct MonitorRect {
  pub x: i32,
  pub y: i32,
  pub width: u32,
  pub height: u32,
}

fn clean_active_preset(presets: &Value) -> Option<&Value> {
  if presets.get("dirty").and_then(Value::as_bool) == Some(true) {
    return None;
  }
  let active_id = presets.get("activeId").and_then(Value::as_str)?;
  presets
    .get("list")
    .and_then(Value::as_array)?
    .iter()
    .find(|preset| preset.get("id").and_then(Value::as_str) == Some(active_id))
}

pub fn clean_active_preset_window_bounds(presets: &Value) -> Option<WindowBounds> {
  let preset = clean_active_preset(presets)?;
  if preset
    .get("dock")
    .and_then(|dock| dock.get("enabled"))
    .and_then(Value::as_bool)
    == Some(true)
  {
    return None;
  }
  serde_json::from_value(preset.get("windowBounds")?.clone()).ok()
}

fn focus_view_is_frameless(owner: &Value) -> bool {
  let focus_view = owner.get("focusView");
  focus_view
    .and_then(|view| view.get("autoHideControls"))
    .and_then(Value::as_bool)
    == Some(true)
    || focus_view
      .and_then(|view| view.get("borderless"))
      .and_then(Value::as_bool)
      == Some(true)
}

pub fn startup_window_is_frameless(settings: &Value, presets: &Value) -> bool {
  let owner = clean_active_preset(presets)
    .filter(|preset| preset.get("focusView").is_some())
    .unwrap_or(settings);
  focus_view_is_frameless(owner)
}

const DEFAULT_RESTORED_WIDTH: u32 = 1280;
const DEFAULT_RESTORED_HEIGHT: u32 = 860;
const MIN_RESTORED_WIDTH: u32 = 320;
const MIN_RESTORED_HEIGHT: u32 = 240;
const WINDOWS_MINIMIZED_SENTINEL: i32 = -32000;

fn is_unusable_bounds(b: &WindowBounds) -> bool {
  b.width < MIN_RESTORED_WIDTH
    || b.height < MIN_RESTORED_HEIGHT
    || b.x <= WINDOWS_MINIMIZED_SENTINEL
    || b.y <= WINDOWS_MINIMIZED_SENTINEL
}

pub(crate) fn centered_on_monitor(b: WindowBounds, m: MonitorRect) -> WindowBounds {
  let width = DEFAULT_RESTORED_WIDTH.min(m.width.max(MIN_RESTORED_WIDTH));
  let height = DEFAULT_RESTORED_HEIGHT.min(m.height.max(MIN_RESTORED_HEIGHT));
  let x = m.x + ((m.width as i32 - width as i32) / 2).max(0);
  let y = m.y + ((m.height as i32 - height as i32) / 2).max(0);
  WindowBounds {
    x,
    y,
    width,
    height,
    ..b
  }
}

/// Returns the visible-overlap area (px²) between the window and a monitor.
fn overlap_area(b: &WindowBounds, m: &MonitorRect) -> i64 {
  let bx2 = b.x as i64 + b.width as i64;
  let by2 = b.y as i64 + b.height as i64;
  let mx2 = m.x as i64 + m.width as i64;
  let my2 = m.y as i64 + m.height as i64;
  let ix = (bx2.min(mx2) - (b.x as i64).max(m.x as i64)).max(0);
  let iy = (by2.min(my2) - (b.y as i64).max(m.y as i64)).max(0);
  ix * iy
}

/// If the window is mostly off-screen (less than 1/8 of its area visible on any monitor),
/// re-center it on the first monitor. Otherwise return it unchanged.
pub fn clamp_to_visible(b: WindowBounds, monitors: &[MonitorRect]) -> WindowBounds {
  if monitors.is_empty() {
    return b;
  }
  if is_unusable_bounds(&b) {
    return centered_on_monitor(b, monitors[0]);
  }
  let area = b.width as i64 * b.height as i64;
  let visible = monitors
    .iter()
    .map(|m| overlap_area(&b, m))
    .max()
    .unwrap_or(0);
  if visible * 8 >= area {
    return b;
  }
  let m = monitors[0];
  let x = m.x + ((m.width as i32 - b.width as i32) / 2).max(0);
  let y = m.y + ((m.height as i32 - b.height as i32) / 2).max(0);
  WindowBounds { x, y, ..b }
}

fn monitor_rects<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) -> Vec<MonitorRect> {
  window
    .available_monitors()
    .unwrap_or_default()
    .iter()
    .map(|m| MonitorRect {
      x: m.position().x,
      y: m.position().y,
      width: m.size().width,
      height: m.size().height,
    })
    .collect()
}

#[tauri::command]
pub fn current_window_bounds<R: tauri::Runtime>(
  window: tauri::WebviewWindow<R>,
) -> Result<WindowBounds, String> {
  let pos = window
    .outer_position()
    .map_err(|e| format!("window position: {e}"))?;
  let size = window
    .inner_size()
    .map_err(|e| format!("window size: {e}"))?;
  let is_maximized = window
    .is_maximized()
    .map_err(|e| format!("window maximized state: {e}"))?;

  Ok(WindowBounds {
    x: pos.x,
    y: pos.y,
    width: size.width,
    height: size.height,
    is_maximized,
  })
}

#[tauri::command]
pub fn apply_window_bounds<R: tauri::Runtime>(
  window: tauri::WebviewWindow<R>,
  bounds: WindowBounds,
) -> Result<(), String> {
  let monitors = monitor_rects(&window);
  let clamped = clamp_to_visible(bounds, &monitors);

  if window
    .is_maximized()
    .map_err(|e| format!("window maximized state: {e}"))?
  {
    window
      .unmaximize()
      .map_err(|e| format!("window unmaximize: {e}"))?;
  }

  window
    .set_size(tauri::PhysicalSize::new(clamped.width, clamped.height))
    .map_err(|e| format!("window size: {e}"))?;
  window
    .set_position(tauri::PhysicalPosition::new(clamped.x, clamped.y))
    .map_err(|e| format!("window position: {e}"))?;

  if bounds.is_maximized {
    window
      .maximize()
      .map_err(|e| format!("window maximize: {e}"))?;
  }

  persist_window_bounds(&window, clamped)?;

  Ok(())
}

fn persist_window_bounds<R: tauri::Runtime>(
  window: &tauri::WebviewWindow<R>,
  bounds: WindowBounds,
) -> Result<(), String> {
  let store = window
    .app_handle()
    .store("plvs-settings.json")
    .map_err(|error| format!("window bounds store: {error}"))?;
  store.set(
    "windowBounds",
    serde_json::to_value(bounds).unwrap_or_default(),
  );
  store
    .save()
    .map_err(|error| format!("save window bounds: {error}"))?;
  let _ = window.app_handle().emit("window-bounds-changed", bounds);
  Ok(())
}

/// Read the current outer bounds of the window and write them to the top-level
/// `windowBounds` store key.
///
/// `windowBounds` is a Rust-owned sibling key — NOT a field inside `plvs:settings`.
/// The JS pluginStoreBackend holds an in-memory copy of `plvs:settings` seeded at boot;
/// if window geometry lived inside that object, a JS settings write would re-persist the
/// stale boot bounds and clobber the geometry Rust just saved. Separate keys = separate
/// owners, no cross-process clobber. Both keys still live in the one `plvs-settings.json`.
pub fn save_window_bounds<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
  let is_maximized = window.is_maximized().unwrap_or(false);
  // When maximized, persist the flag but keep the last normal size/position already on file.
  let store = match window.app_handle().store("plvs-settings.json") {
    Ok(s) => s,
    Err(_) => return,
  };
  let prev: Option<WindowBounds> = store
    .get("windowBounds")
    .and_then(|v| serde_json::from_value(v).ok());

  let bounds = if is_maximized {
    match prev {
      Some(b) => WindowBounds {
        is_maximized: true,
        ..b
      },
      None => return,
    }
  } else {
    let pos = window.outer_position().ok();
    let size = window.inner_size().ok();
    match (pos, size) {
      (Some(p), Some(s)) => {
        let next = WindowBounds {
          x: p.x,
          y: p.y,
          width: s.width,
          height: s.height,
          is_maximized: false,
        };
        if is_unusable_bounds(&next) {
          return;
        }
        next
      }
      _ => return,
    }
  };

  let _ = persist_window_bounds(window, bounds);
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;

  fn mon() -> Vec<MonitorRect> {
    vec![MonitorRect {
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    }]
  }

  #[test]
  fn keeps_a_fully_visible_window() {
    let b = WindowBounds {
      x: 100,
      y: 100,
      width: 1280,
      height: 800,
      is_maximized: false,
    };
    assert_eq!(clamp_to_visible(b, &mon()), b);
  }

  #[test]
  fn recenters_a_window_on_a_gone_monitor() {
    let b = WindowBounds {
      x: 5000,
      y: 5000,
      width: 1280,
      height: 800,
      is_maximized: false,
    };
    let c = clamp_to_visible(b, &mon());
    assert_eq!(c.width, 1280);
    assert_eq!(c.height, 800);
    assert_eq!(c.x, (1920 - 1280) / 2);
    assert_eq!(c.y, (1080 - 800) / 2);
  }

  #[test]
  fn empty_monitor_list_is_a_noop() {
    let b = WindowBounds {
      x: 100,
      y: 100,
      width: 1280,
      height: 800,
      is_maximized: false,
    };
    assert_eq!(clamp_to_visible(b, &[]), b);
  }

  #[test]
  fn clamp_preserves_maximized_flag() {
    let b = WindowBounds {
      x: 5000,
      y: 5000,
      width: 1280,
      height: 800,
      is_maximized: true,
    };
    let c = clamp_to_visible(b, &mon());
    assert!(c.is_maximized);
    assert_eq!(c.width, 1280);
    assert_eq!(c.height, 800);
  }

  #[test]
  fn recenters_minimized_windows_sentinel_bounds() {
    let b = WindowBounds {
      x: -32000,
      y: -32000,
      width: 0,
      height: 0,
      is_maximized: false,
    };
    let c = clamp_to_visible(b, &mon());
    assert_eq!(c.width, 1280);
    assert_eq!(c.height, 860);
    assert_eq!(c.x, (1920 - 1280) / 2);
    assert_eq!(c.y, (1080 - 860) / 2);
  }

  #[test]
  fn serializes_js_window_bounds_shape() {
    let b = WindowBounds {
      x: 1,
      y: 2,
      width: 3,
      height: 4,
      is_maximized: true,
    };
    let value = serde_json::to_value(b).unwrap();
    assert_eq!(value["x"], 1);
    assert_eq!(value["y"], 2);
    assert_eq!(value["width"], 3);
    assert_eq!(value["height"], 4);
    assert_eq!(value["isMaximized"], true);
    assert!(value.get("is_maximized").is_none());
  }

  #[test]
  fn clean_active_preset_supplies_startup_window_bounds() {
    let presets = json!({
      "list": [{
        "id": "mix",
        "windowBounds": {
          "x": 10,
          "y": 20,
          "width": 800,
          "height": 600,
          "isMaximized": false
        }
      }],
      "activeId": "mix",
      "dirty": false
    });

    assert_eq!(
      clean_active_preset_window_bounds(&presets),
      Some(WindowBounds {
        x: 10,
        y: 20,
        width: 800,
        height: 600,
        is_maximized: false,
      })
    );
  }

  #[test]
  fn dirty_active_preset_does_not_override_session_window_bounds() {
    let presets = json!({
      "list": [{
        "id": "mix",
        "windowBounds": {
          "x": 10,
          "y": 20,
          "width": 800,
          "height": 600,
          "isMaximized": false
        }
      }],
      "activeId": "mix",
      "dirty": true
    });

    assert_eq!(clean_active_preset_window_bounds(&presets), None);
  }

  #[test]
  fn dock_preset_does_not_supply_normal_window_bounds_at_startup() {
    let presets = json!({
      "list": [{
        "id": "dock",
        "dock": { "enabled": true },
        "windowBounds": {
          "x": 10,
          "y": 20,
          "width": 800,
          "height": 600,
          "isMaximized": false
        }
      }],
      "activeId": "dock",
      "dirty": false
    });

    assert_eq!(clean_active_preset_window_bounds(&presets), None);
  }

  #[test]
  fn clean_active_preset_supplies_startup_frameless_state() {
    let settings = json!({
      "focusView": { "autoHideControls": false, "borderless": false }
    });
    let presets = json!({
      "list": [{
        "id": "mix",
        "focusView": { "autoHideControls": true, "borderless": false }
      }],
      "activeId": "mix",
      "dirty": false
    });

    assert!(startup_window_is_frameless(&settings, &presets));
  }

  #[test]
  fn dirty_active_preset_leaves_startup_chrome_to_current_settings() {
    let settings = json!({
      "focusView": { "autoHideControls": false, "borderless": false }
    });
    let presets = json!({
      "list": [{
        "id": "mix",
        "focusView": { "autoHideControls": true, "borderless": true }
      }],
      "activeId": "mix",
      "dirty": true
    });

    assert!(!startup_window_is_frameless(&settings, &presets));
  }
}
