use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri_plugin_store::StoreExt;

use crate::window_state::{
  centered_on_monitor, clamp_to_visible, save_window_bounds, MonitorRect, WindowBounds,
};

/// Logical (DPI-independent) strip height. Single source of truth: the
/// frontend strip simply fills the viewport, so no JS copy of this number.
pub const DOCK_STRIP_LOGICAL_HEIGHT: f64 = 72.0;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DockEdge {
  Top,
  Bottom,
}

/// Persisted under the Rust-owned top-level `dockState` key in
/// `plvs-settings.json` (sibling of `windowBounds`; same single-owner rule).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockStateRecord {
  pub enabled: bool,
  pub edge: DockEdge,
  #[serde(default)]
  pub monitor: Option<String>,
}

/// Compute the docked strip rect (physical px) inside a monitor work area.
pub fn dock_strip_rect(work_area: MonitorRect, edge: DockEdge, height: u32) -> WindowBounds {
  let height = height.min(work_area.height).max(1);
  let y = match edge {
    DockEdge::Top => work_area.y,
    DockEdge::Bottom => work_area.y + work_area.height as i32 - height as i32,
  };
  WindowBounds {
    x: work_area.x,
    y,
    width: work_area.width,
    height,
    is_maximized: false,
  }
}

/// True while the window is docked. The window-state flush thread checks this
/// so strip geometry can never leak into the `windowBounds` key (the height
/// guard in `is_unusable_bounds` would miss it on high-DPI monitors where
/// 72 logical px exceeds 240 physical px).
pub struct DockedFlag(pub Arc<AtomicBool>);

pub const DOCK_STATE_KEY: &str = "dockState";

pub fn read_dock_state<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<DockStateRecord> {
  let store = app.store("plvs-settings.json").ok()?;
  store
    .get(DOCK_STATE_KEY)
    .and_then(|v| serde_json::from_value(v).ok())
}

fn save_dock_state<R: tauri::Runtime>(app: &tauri::AppHandle<R>, record: &DockStateRecord) {
  if let Ok(store) = app.store("plvs-settings.json") {
    store.set(
      DOCK_STATE_KEY,
      serde_json::to_value(record).unwrap_or_default(),
    );
    let _ = store.save();
  }
}

fn work_area_and_scale<R: tauri::Runtime>(
  window: &tauri::WebviewWindow<R>,
  monitor_name: Option<&str>,
) -> Result<(MonitorRect, f64, Option<String>), String> {
  let monitors = window
    .available_monitors()
    .map_err(|e| format!("monitors: {e}"))?;
  let by_name = monitor_name.and_then(|n| {
    monitors
      .iter()
      .find(|m| m.name().map(|s| s.as_str()) == Some(n))
      .cloned()
  });
  let monitor = by_name
    .or_else(|| window.current_monitor().ok().flatten())
    .or_else(|| window.primary_monitor().ok().flatten())
    .ok_or_else(|| "no monitor available".to_string())?;
  let wa = monitor.work_area();
  Ok((
    MonitorRect {
      x: wa.position.x,
      y: wa.position.y,
      width: wa.size.width,
      height: wa.size.height,
    },
    monitor.scale_factor(),
    monitor.name().cloned(),
  ))
}

/// Best-effort recovery after a failed dock transition: put the window shell
/// back to normal form and, in case the strip geometry was already applied,
/// restore the last saved normal bounds so strip-sized geometry can't linger
/// (or get flushed to `windowBounds` once the docked flag is rolled back).
fn restore_normal_shell<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
  let _ = window.set_decorations(true);
  let _ = window.set_shadow(true);
  let _ = window.set_always_on_top(false);
  let _ = window.set_resizable(true);
  let saved: Option<WindowBounds> = window
    .app_handle()
    .store("plvs-settings.json")
    .ok()
    .and_then(|s| s.get("windowBounds"))
    .and_then(|v| serde_json::from_value(v).ok());
  if let Some(b) = saved {
    let _ = window.set_size(tauri::PhysicalSize::new(b.width, b.height));
    let _ = window.set_position(tauri::PhysicalPosition::new(b.x, b.y));
  }
}

/// Force the window into the docked strip form. Attribute overrides here are
/// runtime-only: stored settings (windowPinned, focusView) are never written.
/// On Err the window shell has been rolled back to normal form (best effort),
/// so callers falling back to the normal UI don't inherit a chromeless,
/// topmost strip window.
pub fn apply_dock_form<R: tauri::Runtime>(
  window: &tauri::WebviewWindow<R>,
  edge: DockEdge,
  monitor_name: Option<&str>,
) -> Result<Option<String>, String> {
  let (wa, scale, resolved_monitor) = work_area_and_scale(window, monitor_name)?;
  let height = (DOCK_STRIP_LOGICAL_HEIGHT * scale).round() as u32;
  let rect = dock_strip_rect(wa, edge, height);
  if window.is_maximized().unwrap_or(false) {
    let _ = window.unmaximize();
  }
  let applied = (|| -> Result<(), String> {
    window
      .set_decorations(false)
      .map_err(|e| format!("decorations: {e}"))?;
    let _ = window.set_shadow(false);
    window
      .set_always_on_top(true)
      .map_err(|e| format!("always on top: {e}"))?;
    window
      .set_resizable(false)
      .map_err(|e| format!("resizable: {e}"))?;
    window
      .set_size(tauri::PhysicalSize::new(rect.width, rect.height))
      .map_err(|e| format!("size: {e}"))?;
    window
      .set_position(tauri::PhysicalPosition::new(rect.x, rect.y))
      .map_err(|e| format!("position: {e}"))?;
    Ok(())
  })();
  applied.inspect_err(|_| restore_normal_shell(window))?;
  Ok(resolved_monitor)
}

#[tauri::command]
pub fn enter_dock<R: tauri::Runtime>(
  window: tauri::WebviewWindow<R>,
  flag: tauri::State<'_, DockedFlag>,
  edge: DockEdge,
) -> Result<(), String> {
  // Persist the latest normal-form geometry, then raise the suppression flag
  // BEFORE moving the window so the flush thread can't record strip bounds.
  save_window_bounds(&window);
  flag.0.store(true, Ordering::Relaxed);
  let monitor = apply_dock_form(&window, edge, None).inspect_err(|_| {
    flag.0.store(false, Ordering::Relaxed);
  })?;
  save_dock_state(
    window.app_handle(),
    &DockStateRecord {
      enabled: true,
      edge,
      monitor,
    },
  );
  Ok(())
}

#[tauri::command]
pub fn exit_dock<R: tauri::Runtime>(
  window: tauri::WebviewWindow<R>,
  flag: tauri::State<'_, DockedFlag>,
  decorations: bool,
  always_on_top: bool,
) -> Result<(), String> {
  window
    .set_resizable(true)
    .map_err(|e| format!("resizable: {e}"))?;
  window
    .set_decorations(decorations)
    .map_err(|e| format!("decorations: {e}"))?;
  let _ = window.set_shadow(decorations);
  window
    .set_always_on_top(always_on_top)
    .map_err(|e| format!("always on top: {e}"))?;

  let app = window.app_handle();
  let saved: Option<WindowBounds> = app
    .store("plvs-settings.json")
    .ok()
    .and_then(|s| s.get("windowBounds"))
    .and_then(|v| serde_json::from_value(v).ok());
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
  if let Some(b) = saved {
    let clamped = clamp_to_visible(b, &monitors);
    let _ = window.set_size(tauri::PhysicalSize::new(clamped.width, clamped.height));
    let _ = window.set_position(tauri::PhysicalPosition::new(clamped.x, clamped.y));
    if b.is_maximized {
      let _ = window.maximize();
    }
  } else if let Some(m) = monitors.first() {
    // No saved normal bounds (e.g. first run docked): don't leave the window
    // strip-sized — fall back to a default-sized window centered on a monitor.
    let fallback = centered_on_monitor(
      WindowBounds {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        is_maximized: false,
      },
      *m,
    );
    let _ = window.set_size(tauri::PhysicalSize::new(fallback.width, fallback.height));
    let _ = window.set_position(tauri::PhysicalPosition::new(fallback.x, fallback.y));
  }
  let prev = read_dock_state(app);
  save_dock_state(
    app,
    &DockStateRecord {
      enabled: false,
      edge: prev.as_ref().map(|s| s.edge).unwrap_or(DockEdge::Bottom),
      monitor: prev.and_then(|s| s.monitor),
    },
  );
  flag.0.store(false, Ordering::Relaxed);
  Ok(())
}

#[tauri::command]
pub fn get_dock_state<R: tauri::Runtime>(
  app: tauri::AppHandle<R>,
) -> Result<Option<DockStateRecord>, String> {
  Ok(read_dock_state(&app))
}

#[cfg(test)]
mod tests {
  use super::*;

  fn wa() -> MonitorRect {
    // e.g. 1920x1080 monitor with a 40px taskbar at the bottom
    MonitorRect {
      x: 0,
      y: 0,
      width: 1920,
      height: 1040,
    }
  }

  #[test]
  fn top_edge_spans_work_area_width_at_its_top() {
    let r = dock_strip_rect(wa(), DockEdge::Top, 108);
    assert_eq!((r.x, r.y, r.width, r.height), (0, 0, 1920, 108));
    assert!(!r.is_maximized);
  }

  #[test]
  fn bottom_edge_sits_flush_above_the_taskbar() {
    let r = dock_strip_rect(wa(), DockEdge::Bottom, 108);
    assert_eq!((r.x, r.y, r.width, r.height), (0, 1040 - 108, 1920, 108));
  }

  #[test]
  fn secondary_monitor_offsets_are_respected() {
    let wa2 = MonitorRect {
      x: 1920,
      y: -200,
      width: 2560,
      height: 1400,
    };
    let r = dock_strip_rect(wa2, DockEdge::Bottom, 150);
    assert_eq!((r.x, r.y, r.width), (1920, -200 + 1400 - 150, 2560));
  }

  #[test]
  fn height_is_clamped_to_work_area() {
    let tiny = MonitorRect {
      x: 0,
      y: 0,
      width: 800,
      height: 50,
    };
    let r = dock_strip_rect(tiny, DockEdge::Top, 108);
    assert_eq!(r.height, 50);
  }

  #[test]
  fn dock_state_serializes_camel_case_and_lowercase_edge() {
    let s = DockStateRecord {
      enabled: true,
      edge: DockEdge::Bottom,
      monitor: Some("\\\\.\\DISPLAY1".into()),
    };
    let v = serde_json::to_value(&s).unwrap();
    assert_eq!(v["enabled"], true);
    assert_eq!(v["edge"], "bottom");
    assert_eq!(v["monitor"], "\\\\.\\DISPLAY1");
    let back: DockStateRecord = serde_json::from_value(v).unwrap();
    assert_eq!(back, s);
  }
}
