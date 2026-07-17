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
pub const DOCK_MIN_LOGICAL_HEIGHT: u32 = 56;
pub const DOCK_DEFAULT_LOGICAL_HEIGHT: u32 = 72;
pub const DOCK_MAX_LOGICAL_HEIGHT: u32 = 160;
pub const DOCK_HEADER_LOGICAL_HEIGHT: f64 = 44.0;
pub const DOCK_EDITOR_MIN_LOGICAL_WIDTH: f64 = 176.0;
pub const DOCK_EDITOR_MAX_LOGICAL_WIDTH: f64 = 400.0;
pub const DOCK_EDITOR_MIN_LOGICAL_HEIGHT: f64 = 80.0;
pub const DOCK_EDITOR_MAX_LOGICAL_HEIGHT: f64 = 640.0;
pub const DOCK_EDITOR_LOGICAL_INSET: f64 = 8.0;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DockAccessoryRects {
  pub header: WindowBounds,
  pub editor: WindowBounds,
}

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
  #[serde(default = "default_reserve_space")]
  pub reserve_space: bool,
  #[serde(default = "default_dock_height")]
  pub height: u32,
}

fn default_reserve_space() -> bool {
  cfg!(target_os = "windows")
}

fn reserve_space_with_support(reserve_space: bool, supported: bool) -> bool {
  supported && reserve_space
}

impl DockStateRecord {
  fn with_reserve_space_support(mut self, supported: bool) -> Self {
    self.reserve_space = reserve_space_with_support(self.reserve_space, supported);
    self
  }

  pub(crate) fn normalize_for_platform(self) -> Self {
    self.with_reserve_space_support(cfg!(target_os = "windows"))
  }
}

fn default_dock_height() -> u32 {
  DOCK_DEFAULT_LOGICAL_HEIGHT
}

pub fn clamp_dock_height(height: u32) -> u32 {
  height.clamp(DOCK_MIN_LOGICAL_HEIGHT, DOCK_MAX_LOGICAL_HEIGHT)
}

/// Compute the docked strip rect (physical px) inside a monitor work area.
#[cfg(any(not(target_os = "windows"), test))]
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

fn scaled_px(logical: f64, scale: f64) -> u32 {
  (logical * scale.max(0.1)).round().max(1.0) as u32
}

/// Compute physical-pixel accessory rectangles outside the accepted meter strip.
/// The strip/AppBar rectangle is input-only and never grows with either accessory.
pub fn dock_accessory_rects(
  monitor: MonitorRect,
  strip: WindowBounds,
  edge: DockEdge,
  scale: f64,
  editor_logical_width: f64,
  editor_logical_height: f64,
  editor_anchor_logical_x: Option<f64>,
) -> DockAccessoryRects {
  let header_height = scaled_px(DOCK_HEADER_LOGICAL_HEIGHT, scale).min(monitor.height);
  let requested_editor_width =
    editor_logical_width.clamp(DOCK_EDITOR_MIN_LOGICAL_WIDTH, DOCK_EDITOR_MAX_LOGICAL_WIDTH);
  let preferred_editor_width = scaled_px(requested_editor_width, scale);
  let inset = scaled_px(DOCK_EDITOR_LOGICAL_INSET, scale) as i32;
  let requested_editor_height = editor_logical_height.clamp(
    DOCK_EDITOR_MIN_LOGICAL_HEIGHT,
    DOCK_EDITOR_MAX_LOGICAL_HEIGHT,
  );

  let header_y = match edge {
    DockEdge::Top => strip.y + strip.height as i32,
    DockEdge::Bottom => strip.y - header_height as i32,
  };
  let header = WindowBounds {
    x: strip.x,
    y: header_y.clamp(
      monitor.y,
      monitor.y + monitor.height.saturating_sub(header_height) as i32,
    ),
    width: strip.width.min(monitor.width).max(1),
    height: header_height.max(1),
    is_maximized: false,
  };

  let available_height = match edge {
    DockEdge::Top => monitor.y + monitor.height as i32 - (header.y + header.height as i32),
    DockEdge::Bottom => header.y - monitor.y,
  }
  .max(1) as u32;
  let editor_height = scaled_px(requested_editor_height, scale).min(available_height);
  let editor_width = preferred_editor_width
    .min(
      monitor
        .width
        .saturating_sub((inset.max(0) as u32).saturating_mul(2)),
    )
    .max(1);
  let editor_anchor_x = editor_anchor_logical_x
    .filter(|value| value.is_finite())
    .map(|value| header.x + (value * scale.max(0.1)).round() as i32)
    .unwrap_or(header.x + header.width as i32 / 2);
  let editor_x = (editor_anchor_x - editor_width as i32 / 2).clamp(
    monitor.x,
    monitor.x + monitor.width.saturating_sub(editor_width) as i32,
  );
  let editor_y = match edge {
    DockEdge::Top => header.y + header.height as i32,
    DockEdge::Bottom => header.y - editor_height as i32,
  };
  let editor = WindowBounds {
    x: editor_x,
    y: editor_y.clamp(
      monitor.y,
      monitor.y + monitor.height.saturating_sub(editor_height) as i32,
    ),
    width: editor_width,
    height: editor_height.max(1),
    is_maximized: false,
  };

  DockAccessoryRects { header, editor }
}

/// True while the window is docked. The window-state flush thread checks this
/// so strip geometry can never leak into the `windowBounds` key (the height
/// guard in `is_unusable_bounds` would miss it on high-DPI monitors where
/// 72 logical px exceeds 240 physical px).
pub struct DockedFlag(pub Arc<AtomicBool>);

/// False while setup is still applying the persisted Dock shell and AppBar.
/// Frontend reconciliation must not treat DockedFlag's default value as final
/// until this becomes true.
pub struct DockBootReady(pub Arc<AtomicBool>);

pub const DOCK_STATE_KEY: &str = "dockState";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockStateSnapshot {
  pub ready: bool,
  pub state: Option<DockStateRecord>,
}

pub fn read_dock_state<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<DockStateRecord> {
  let store = app.store("plvs-settings.json").ok()?;
  store
    .get(DOCK_STATE_KEY)
    .and_then(|v| serde_json::from_value(v).ok())
    .map(DockStateRecord::normalize_for_platform)
}

pub(crate) fn write_dock_state<R: tauri::Runtime>(
  app: &tauri::AppHandle<R>,
  record: &DockStateRecord,
) {
  if let Ok(store) = app.store("plvs-settings.json") {
    let record = record.clone().normalize_for_platform();
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

#[derive(Clone, Copy)]
struct WindowFormSnapshot {
  bounds: WindowBounds,
  decorations: bool,
  resizable: bool,
  always_on_top: bool,
}

fn capture_window_form<R: tauri::Runtime>(
  window: &tauri::WebviewWindow<R>,
) -> Result<WindowFormSnapshot, String> {
  let position = window
    .outer_position()
    .map_err(|e| format!("snapshot position: {e}"))?;
  let size = window
    .inner_size()
    .map_err(|e| format!("snapshot size: {e}"))?;
  Ok(WindowFormSnapshot {
    bounds: WindowBounds {
      x: position.x,
      y: position.y,
      width: size.width,
      height: size.height,
      is_maximized: window.is_maximized().unwrap_or(false),
    },
    decorations: window.is_decorated().unwrap_or(true),
    resizable: window.is_resizable().unwrap_or(true),
    always_on_top: window.is_always_on_top().unwrap_or(false),
  })
}

fn restore_window_form<R: tauri::Runtime>(
  window: &tauri::WebviewWindow<R>,
  snapshot: WindowFormSnapshot,
) {
  if window.is_maximized().unwrap_or(false) {
    let _ = window.unmaximize();
  }
  let _ = window.set_resizable(snapshot.resizable);
  let _ = window.set_decorations(snapshot.decorations);
  let _ = window.set_shadow(snapshot.decorations);
  let _ = window.set_always_on_top(snapshot.always_on_top);
  let _ = window.set_size(tauri::PhysicalSize::new(
    snapshot.bounds.width,
    snapshot.bounds.height,
  ));
  let _ = window.set_position(tauri::PhysicalPosition::new(
    snapshot.bounds.x,
    snapshot.bounds.y,
  ));
  if snapshot.bounds.is_maximized {
    let _ = window.maximize();
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
  logical_height: u32,
) -> Result<Option<String>, String> {
  let previous_form = capture_window_form(window)?;
  let logical_height = clamp_dock_height(logical_height);
  let (wa, scale, resolved_monitor) = work_area_and_scale(window, monitor_name)?;
  #[cfg(target_os = "windows")]
  let _ = (wa, scale);
  #[cfg(not(target_os = "windows"))]
  let height = (logical_height as f64 * scale).round() as u32;
  #[cfg(not(target_os = "windows"))]
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
    #[cfg(target_os = "windows")]
    crate::appbar::position_overlay(window, edge, wa, scale, logical_height)?;
    #[cfg(not(target_os = "windows"))]
    {
      window
        .set_size(tauri::PhysicalSize::new(rect.width, rect.height))
        .map_err(|e| format!("size: {e}"))?;
      window
        .set_position(tauri::PhysicalPosition::new(rect.x, rect.y))
        .map_err(|e| format!("position: {e}"))?;
    }
    Ok(())
  })();
  applied.inspect_err(|_| restore_window_form(window, previous_form))?;
  Ok(resolved_monitor)
}

#[tauri::command]
pub fn enter_dock<R: tauri::Runtime>(
  window: tauri::WebviewWindow<R>,
  flag: tauri::State<'_, DockedFlag>,
  edge: DockEdge,
  reserve_space: Option<bool>,
  monitor: Option<String>,
  height: Option<u32>,
) -> Result<DockStateRecord, String> {
  let previous = read_dock_state(window.app_handle());
  let was_docked = flag.0.load(Ordering::Relaxed);
  let previous_form = capture_window_form(&window)?;
  let reserve_space = reserve_space_with_support(
    reserve_space.unwrap_or_else(|| {
      previous
        .as_ref()
        .map(|state| state.reserve_space)
        .unwrap_or_else(default_reserve_space)
    }),
    cfg!(target_os = "windows"),
  );
  let height = clamp_dock_height(height.unwrap_or_else(|| {
    previous
      .as_ref()
      .map(|state| state.height)
      .unwrap_or(DOCK_DEFAULT_LOGICAL_HEIGHT)
  }));
  let transition = (|| -> Result<Option<String>, String> {
    #[cfg(target_os = "windows")]
    crate::appbar::set_reserved(&window, false, edge, height)?;
    // Persist the latest normal-form geometry, then raise the suppression flag
    // BEFORE moving the window so the flush thread can't record strip bounds.
    if !was_docked {
      save_window_bounds(&window);
    }
    flag.0.store(true, Ordering::Relaxed);
    let monitor = apply_dock_form(&window, edge, monitor.as_deref(), height)?;
    #[cfg(target_os = "windows")]
    if reserve_space {
      crate::appbar::set_reserved(&window, true, edge, height)?;
    }
    Ok(monitor)
  })();
  let monitor = match transition {
    Ok(monitor) => monitor,
    Err(error) => {
      flag.0.store(was_docked, Ordering::Relaxed);
      restore_window_form(&window, previous_form);
      #[cfg(target_os = "windows")]
      if was_docked {
        if let Some(previous) = previous.as_ref() {
          let _ = crate::appbar::set_reserved(
            &window,
            previous.reserve_space,
            previous.edge,
            previous.height,
          );
        }
      }
      return Err(error);
    }
  };
  let next = DockStateRecord {
    enabled: true,
    edge,
    monitor,
    reserve_space,
    height,
  };
  write_dock_state(window.app_handle(), &next);
  Ok(next)
}

#[tauri::command]
pub fn exit_dock<R: tauri::Runtime>(
  window: tauri::WebviewWindow<R>,
  flag: tauri::State<'_, DockedFlag>,
  decorations: bool,
  always_on_top: bool,
  bounds: Option<WindowBounds>,
) -> Result<(), String> {
  crate::dock_accessories::hide_all(window.app_handle());
  #[cfg(target_os = "windows")]
  crate::appbar::set_reserved(
    &window,
    false,
    DockEdge::Bottom,
    read_dock_state(window.app_handle())
      .map(|state| clamp_dock_height(state.height))
      .unwrap_or(DOCK_DEFAULT_LOGICAL_HEIGHT),
  )?;
  window
    .set_resizable(true)
    .map_err(|e| format!("resizable: {e}"))?;
  window
    .set_decorations(decorations)
    .map_err(|e| format!("decorations: {e}"))?;
  // Normal windows keep the platform shadow even when borderless. Startup
  // relies on that DWM frame when pairing outer position with inner size; Dock
  // temporarily disables it for the strip, so restore it before normal bounds.
  let _ = window.set_shadow(true);
  window
    .set_always_on_top(always_on_top)
    .map_err(|e| format!("always on top: {e}"))?;
  let app = window.app_handle();
  let saved: Option<WindowBounds> = bounds.or_else(|| {
    app
      .store("plvs-settings.json")
      .ok()
      .and_then(|s| s.get("windowBounds"))
      .and_then(|v| serde_json::from_value(v).ok())
  });
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
  write_dock_state(
    app,
    &DockStateRecord {
      enabled: false,
      edge: prev.as_ref().map(|s| s.edge).unwrap_or(DockEdge::Bottom),
      monitor: prev.as_ref().and_then(|s| s.monitor.clone()),
      reserve_space: prev.as_ref().map(|s| s.reserve_space).unwrap_or(true),
      height: prev
        .as_ref()
        .map(|s| clamp_dock_height(s.height))
        .unwrap_or(DOCK_DEFAULT_LOGICAL_HEIGHT),
    },
  );
  flag.0.store(false, Ordering::Relaxed);
  Ok(())
}

#[tauri::command]
pub fn get_dock_state<R: tauri::Runtime>(
  app: tauri::AppHandle<R>,
  flag: tauri::State<'_, DockedFlag>,
  ready: tauri::State<'_, DockBootReady>,
) -> Result<DockStateSnapshot, String> {
  let ready = ready.0.load(Ordering::Acquire);
  let state = ready.then(|| {
    read_dock_state(&app).map(|mut state| {
      state.enabled = flag.0.load(Ordering::Relaxed);
      state
    })
  });
  Ok(DockStateSnapshot {
    ready,
    state: state.flatten(),
  })
}

#[tauri::command]
pub fn set_dock_reserve_space<R: tauri::Runtime>(
  window: tauri::WebviewWindow<R>,
  flag: tauri::State<'_, DockedFlag>,
  enabled: bool,
  edge: DockEdge,
) -> Result<(), String> {
  if !flag.0.load(Ordering::Relaxed) {
    return Err("window is not docked".into());
  }

  #[cfg(target_os = "windows")]
  {
    let height = read_dock_state(window.app_handle())
      .map(|state| clamp_dock_height(state.height))
      .unwrap_or(DOCK_DEFAULT_LOGICAL_HEIGHT);
    crate::appbar::set_reserved(&window, enabled, edge, height)?;
  }
  #[cfg(not(target_os = "windows"))]
  if enabled {
    return Err("reserve screen space is only available on Windows".into());
  }

  let previous = read_dock_state(window.app_handle());
  write_dock_state(
    window.app_handle(),
    &DockStateRecord {
      enabled: true,
      edge,
      monitor: previous.and_then(|state| state.monitor),
      reserve_space: enabled,
      height: read_dock_state(window.app_handle())
        .map(|state| clamp_dock_height(state.height))
        .unwrap_or(DOCK_DEFAULT_LOGICAL_HEIGHT),
    },
  );
  Ok(())
}

/// Temporarily hide or restore the complete Dock form without changing the
/// persisted enabled state. Capture and Dock layout continue running while
/// suspended; only native window visibility and AppBar reservation change.
#[tauri::command]
pub fn set_dock_suspended<R: tauri::Runtime>(
  window: tauri::WebviewWindow<R>,
  flag: tauri::State<'_, DockedFlag>,
  suspended: bool,
) -> Result<DockStateRecord, String> {
  if !flag.0.load(Ordering::Relaxed) {
    return Err("window is not docked".into());
  }
  let mut state = read_dock_state(window.app_handle())
    .filter(|state| state.enabled)
    .ok_or_else(|| "dock state unavailable".to_string())?;

  if suspended {
    crate::dock_accessories::hide_all(window.app_handle());
    #[cfg(target_os = "windows")]
    if state.reserve_space {
      crate::appbar::set_reserved(&window, false, state.edge, state.height)?;
    }
    window
      .hide()
      .map_err(|e| format!("suspend dock hide: {e}"))?;
    window
      .set_skip_taskbar(true)
      .map_err(|e| format!("suspend dock taskbar: {e}"))?;
    return Ok(state);
  }

  state.monitor = apply_dock_form(&window, state.edge, state.monitor.as_deref(), state.height)?;
  #[cfg(target_os = "windows")]
  if state.reserve_space
    && crate::appbar::set_reserved(&window, true, state.edge, state.height).is_err()
  {
    // Resume as a usable overlay Dock. The UI receives this resolved record,
    // so Reserve never claims to be active when Shell rejected registration.
    state.reserve_space = false;
    write_dock_state(window.app_handle(), &state);
  }
  window
    .set_skip_taskbar(false)
    .map_err(|e| format!("resume dock taskbar: {e}"))?;
  window
    .show()
    .map_err(|e| format!("resume dock show: {e}"))?;
  window
    .set_focus()
    .map_err(|e| format!("resume dock focus: {e}"))?;
  Ok(state)
}

#[tauri::command]
pub fn set_dock_height<R: tauri::Runtime>(
  window: tauri::WebviewWindow<R>,
  flag: tauri::State<'_, DockedFlag>,
  height: u32,
  persist: bool,
) -> Result<u32, String> {
  if !flag.0.load(Ordering::Relaxed) {
    return Err("window is not docked".into());
  }
  let height = clamp_dock_height(height);
  let previous = read_dock_state(window.app_handle()).unwrap_or(DockStateRecord {
    enabled: true,
    edge: DockEdge::Bottom,
    monitor: None,
    reserve_space: true,
    height: DOCK_DEFAULT_LOGICAL_HEIGHT,
  });
  let (work_area, scale, resolved_monitor) =
    work_area_and_scale(&window, previous.monitor.as_deref())?;

  #[cfg(target_os = "windows")]
  if previous.reserve_space {
    if persist {
      crate::appbar::set_reserved(&window, true, previous.edge, height)?;
    } else {
      crate::appbar::preview_reserved_height(&window, previous.edge, height)?;
    }
  } else {
    crate::appbar::position_overlay(&window, previous.edge, work_area, scale, height)?;
  }
  #[cfg(not(target_os = "windows"))]
  {
    let physical_height = (height as f64 * scale).round() as u32;
    let rect = dock_strip_rect(work_area, previous.edge, physical_height);
    window
      .set_size(tauri::PhysicalSize::new(rect.width, rect.height))
      .map_err(|e| format!("size: {e}"))?;
    window
      .set_position(tauri::PhysicalPosition::new(rect.x, rect.y))
      .map_err(|e| format!("position: {e}"))?;
  }

  if persist {
    write_dock_state(
      window.app_handle(),
      &DockStateRecord {
        enabled: true,
        edge: previous.edge,
        monitor: resolved_monitor.or(previous.monitor),
        reserve_space: previous.reserve_space,
        height,
      },
    );
  }
  Ok(height)
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
      reserve_space: true,
      height: DOCK_DEFAULT_LOGICAL_HEIGHT,
    };
    let v = serde_json::to_value(&s).unwrap();
    assert_eq!(v["enabled"], true);
    assert_eq!(v["edge"], "bottom");
    assert_eq!(v["monitor"], "\\\\.\\DISPLAY1");
    assert_eq!(v["reserveSpace"], true);
    assert_eq!(v["height"], 72);
    let back: DockStateRecord = serde_json::from_value(v).unwrap();
    assert_eq!(back, s);
  }

  #[test]
  fn dock_state_defaults_reserve_space_for_the_current_platform_when_missing() {
    let back: DockStateRecord =
      serde_json::from_value(serde_json::json!({ "enabled": true, "edge": "bottom" })).unwrap();
    assert_eq!(back.reserve_space, cfg!(target_os = "windows"));
    assert_eq!(back.height, DOCK_DEFAULT_LOGICAL_HEIGHT);
  }

  #[test]
  fn dock_state_disables_reserve_space_on_unsupported_platforms() {
    let state = DockStateRecord {
      enabled: true,
      edge: DockEdge::Bottom,
      monitor: None,
      reserve_space: true,
      height: DOCK_DEFAULT_LOGICAL_HEIGHT,
    };

    assert!(!state.with_reserve_space_support(false).reserve_space);
  }

  #[test]
  fn dock_state_snapshot_distinguishes_pending_boot_from_resolved_state() {
    let pending = DockStateSnapshot {
      ready: false,
      state: None,
    };
    assert_eq!(
      serde_json::to_value(pending).unwrap(),
      serde_json::json!({ "ready": false, "state": null })
    );
  }

  #[test]
  fn dock_height_clamps_to_supported_range() {
    assert_eq!(clamp_dock_height(1), DOCK_MIN_LOGICAL_HEIGHT);
    assert_eq!(clamp_dock_height(72), 72);
    assert_eq!(clamp_dock_height(999), DOCK_MAX_LOGICAL_HEIGHT);
  }

  #[test]
  fn bottom_accessories_open_above_the_strip_and_anchor_editor() {
    let strip = dock_strip_rect(wa(), DockEdge::Bottom, 72);
    let rects = dock_accessory_rects(
      wa(),
      strip,
      DockEdge::Bottom,
      1.0,
      400.0,
      480.0,
      Some(1200.0),
    );
    assert_eq!(
      (
        rects.header.x,
        rects.header.y,
        rects.header.width,
        rects.header.height
      ),
      (0, 1040 - 72 - 44, 1920, 44)
    );
    assert_eq!(
      (
        rects.editor.x,
        rects.editor.y,
        rects.editor.width,
        rects.editor.height
      ),
      (1200 - 400 / 2, 1040 - 72 - 44 - 480, 400, 480)
    );
  }

  #[test]
  fn top_accessories_open_below_the_strip_at_scaled_size() {
    let strip = dock_strip_rect(wa(), DockEdge::Top, 108);
    let rects = dock_accessory_rects(wa(), strip, DockEdge::Top, 1.5, 400.0, 300.0, Some(1000.0));
    assert_eq!((rects.header.y, rects.header.height), (108, 66));
    assert_eq!(
      (rects.editor.y, rects.editor.width, rects.editor.height),
      (174, 600, 450)
    );
    assert_eq!(rects.editor.x, 1500 - 600 / 2);
  }

  #[test]
  fn accessories_respect_negative_secondary_monitor_offsets() {
    let monitor = MonitorRect {
      x: -2560,
      y: -200,
      width: 2560,
      height: 1400,
    };
    let strip = dock_strip_rect(monitor, DockEdge::Top, 72);
    let rects = dock_accessory_rects(
      monitor,
      strip,
      DockEdge::Top,
      1.0,
      400.0,
      400.0,
      Some(600.0),
    );
    assert_eq!((rects.header.x, rects.header.y), (-2560, -128));
    assert_eq!(rects.editor.x, -2560 + 600 - 400 / 2);
    assert_eq!(rects.editor.y, -84);
  }

  #[test]
  fn editor_is_clamped_when_monitor_cannot_fit_preferred_size() {
    let monitor = MonitorRect {
      x: 10,
      y: 20,
      width: 320,
      height: 240,
    };
    let strip = dock_strip_rect(monitor, DockEdge::Bottom, 72);
    let rects = dock_accessory_rects(
      monitor,
      strip,
      DockEdge::Bottom,
      1.0,
      400.0,
      640.0,
      Some(160.0),
    );
    assert_eq!((rects.header.y, rects.header.height), (144, 44));
    assert_eq!((rects.editor.x, rects.editor.y), (18, 20));
    assert_eq!((rects.editor.width, rects.editor.height), (304, 124));
  }
}
