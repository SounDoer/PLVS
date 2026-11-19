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
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct MonitorRect {
  pub x: i32,
  pub y: i32,
  pub width: u32,
  pub height: u32,
}

/// The physical rectangle remains readable by earlier versions.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WindowPlacement {
  #[serde(flatten)]
  pub bounds: WindowBounds,
  #[serde(
    default,
    skip_serializing_if = "Option::is_none",
    deserialize_with = "read_relative"
  )]
  relative: Option<RelativePlacement>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RelativePlacement {
  monitor: Option<String>,
  work_area: MonitorRect,
  scale: f64,
  logical_width: f64,
  logical_height: f64,
  frame_width: f64,
  frame_height: f64,
  #[serde(default, skip_serializing_if = "is_zero")]
  resize_inset_width: f64,
  #[serde(default, skip_serializing_if = "is_zero")]
  resize_inset_height: f64,
  horizontal: f64,
  vertical: f64,
}

fn is_zero(value: &f64) -> bool {
  *value == 0.0
}

fn read_relative<'de, D: serde::Deserializer<'de>>(
  deserializer: D,
) -> Result<Option<RelativePlacement>, D::Error> {
  let value = Value::deserialize(deserializer)?;
  Ok(
    serde_json::from_value::<RelativePlacement>(value)
      .ok()
      .filter(|relative| {
        relative.work_area.width > 0
          && relative.work_area.height > 0
          && relative.scale.is_finite()
          && relative.scale > 0.0
          && relative.logical_width > 0.0
          && relative.logical_height > 0.0
          && relative.frame_width >= 0.0
          && relative.frame_height >= 0.0
          && relative.resize_inset_width >= 0.0
          && relative.resize_inset_height >= 0.0
          && (0.0..=1.0).contains(&relative.horizontal)
          && (0.0..=1.0).contains(&relative.vertical)
      }),
  )
}

#[derive(Debug, Clone)]
struct PlacementTarget {
  monitor: Option<String>,
  work_area: MonitorRect,
  scale: f64,
}

impl PlacementTarget {
  fn from_monitor<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    monitor: &tauri::Monitor,
  ) -> Self {
    Self {
      monitor: monitor.name().cloned(),
      work_area: normal_work_area(window, monitor),
      scale: monitor.scale_factor(),
    }
  }
}

/// The work area available to the normal window after this workbench releases its own Dock
/// reservation. Other windows' reservations still apply.
fn normal_work_area<R: tauri::Runtime>(
  window: &tauri::WebviewWindow<R>,
  monitor: &tauri::Monitor,
) -> MonitorRect {
  let work_area = monitor.work_area();
  #[cfg(target_os = "windows")]
  let (reserved_height, reserved_top) =
    crate::appbar::own_reserved_height(window, monitor.name().map(String::as_str));
  #[cfg(not(target_os = "windows"))]
  let (reserved_height, reserved_top) = (0, 0);
  #[cfg(target_os = "linux")]
  if let Some(area) = crate::linux_dock::pre_reservation_work_area(monitor) {
    return area;
  }
  #[cfg(not(target_os = "windows"))]
  let _ = window;
  MonitorRect {
    x: work_area.position.x,
    y: work_area.position.y.saturating_sub(reserved_top),
    width: work_area.size.width,
    height: work_area.size.height.saturating_add(reserved_height),
  }
}

#[derive(Debug)]
pub(crate) struct ResolvedPlacement {
  pub bounds: WindowBounds,
  target: Option<PlacementTarget>,
  resize_inset: tauri::PhysicalSize<u32>,
}

fn travel_fraction(position: i32, origin: i32, area: u32, outer: u32) -> f64 {
  let travel = area.saturating_sub(outer);
  if travel == 0 {
    return 0.5;
  }
  ((f64::from(position) - f64::from(origin)) / f64::from(travel)).clamp(0.0, 1.0)
}

impl RelativePlacement {
  fn capture(
    bounds: WindowBounds,
    target: PlacementTarget,
    outer_width: u32,
    outer_height: u32,
  ) -> Self {
    let PlacementTarget {
      monitor,
      work_area,
      scale,
    } = target;
    Self {
      monitor,
      work_area,
      scale,
      logical_width: f64::from(bounds.width) / scale,
      logical_height: f64::from(bounds.height) / scale,
      frame_width: f64::from(outer_width.saturating_sub(bounds.width)) / scale,
      frame_height: f64::from(outer_height.saturating_sub(bounds.height)) / scale,
      resize_inset_width: 0.0,
      resize_inset_height: 0.0,
      horizontal: travel_fraction(bounds.x, work_area.x, work_area.width, outer_width),
      vertical: travel_fraction(bounds.y, work_area.y, work_area.height, outer_height),
    }
  }

  fn resolve(&self, saved: WindowBounds, target: &PlacementTarget) -> ResolvedPlacement {
    let area = target.work_area;
    let scale = target.scale;
    let bounds = if self.monitor == target.monitor && self.work_area == area && self.scale == scale
    {
      saved
    } else {
      let frame_width = (self.frame_width * scale).round() as u32;
      let frame_height = (self.frame_height * scale).round() as u32;
      let width = self.logical_width * scale;
      let height = self.logical_height * scale;
      let ratio = 1.0_f64
        .min(f64::from(area.width.saturating_sub(frame_width)) / width)
        .min(f64::from(area.height.saturating_sub(frame_height)) / height);
      let width = ((width * ratio).round() as u32).max(1);
      let height = ((height * ratio).round() as u32).max(1);
      let horizontal_travel = area.width.saturating_sub(width.saturating_add(frame_width));
      let vertical_travel = area
        .height
        .saturating_sub(height.saturating_add(frame_height));
      WindowBounds {
        x: area
          .x
          .saturating_add((f64::from(horizontal_travel) * self.horizontal).round() as i32),
        y: area
          .y
          .saturating_add((f64::from(vertical_travel) * self.vertical).round() as i32),
        width,
        height,
        is_maximized: saved.is_maximized,
      }
    };
    ResolvedPlacement {
      bounds,
      target: Some(target.clone()),
      resize_inset: tauri::PhysicalSize::new(
        (self.resize_inset_width * scale).round() as u32,
        (self.resize_inset_height * scale).round() as u32,
      ),
    }
  }
}

/// AppKit and GTK place normal windows at whole desktop points.
fn snap_to_logical_pixels(bounds: &mut WindowBounds, scale: f64) {
  let snap = |physical: f64| ((physical / scale).round() * scale).round();
  bounds.x = snap(f64::from(bounds.x)) as i32;
  bounds.y = snap(f64::from(bounds.y)) as i32;
  bounds.width = (snap(f64::from(bounds.width)) as u32).max(1);
  bounds.height = (snap(f64::from(bounds.height)) as u32).max(1);
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

fn clean_active_preset_window_bounds(presets: &Value) -> Option<WindowPlacement> {
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

pub(crate) fn startup_window_bounds(
  presets: &Value,
  workspace_bounds: Value,
) -> Option<WindowPlacement> {
  // Applying a normal Preset already saves its applied bounds to the Workspace. A later move
  // updates that placement while leaving the Preset selected and its snapshot intact.
  serde_json::from_value::<WindowPlacement>(workspace_bounds)
    .ok()
    .filter(|placement| {
      placement.bounds.width > 0
        && placement.bounds.height > 0
        && !has_minimized_position(&placement.bounds)
    })
    .or_else(|| clean_active_preset_window_bounds(presets))
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

pub fn startup_surface_opacity(settings: &Value, presets: &Value) -> u8 {
  fn valid_surface_opacity(owner: &Value) -> Option<u8> {
    owner
      .get("surfaceOpacity")
      .and_then(Value::as_u64)
      .filter(|opacity| *opacity <= 100)
      .map(|opacity| opacity as u8)
  }

  clean_active_preset(presets)
    .and_then(valid_surface_opacity)
    .or_else(|| valid_surface_opacity(settings))
    .unwrap_or(100)
}

/// First-run content size in logical px; the physical size comes from the target monitor's scale.
pub const DEFAULT_WINDOW_LOGICAL_WIDTH: f64 = 1280.0;
pub const DEFAULT_WINDOW_LOGICAL_HEIGHT: f64 = 800.0;
/// A default-sized window's outer size stays within this share of the work area in each dimension,
/// so a shrunk window keeps a margin and still reads as a normal window.
const WORK_AREA_FIT_FRACTION: f64 = 0.9;
const MIN_RESTORED_WIDTH: u32 = 320;
const MIN_RESTORED_HEIGHT: u32 = 240;
const WINDOWS_MINIMIZED_SENTINEL: i32 = -32000;

/// Where a default-sized window goes: a monitor's work area and scale factor, plus the window chrome
/// (outer minus inner size) that the stored content size does not include. All in physical px.
#[derive(Debug, Clone, Copy)]
pub struct FitTarget {
  pub work_area: MonitorRect,
  pub scale: f64,
  pub frame_width: u32,
  pub frame_height: u32,
}

fn is_unusable_bounds(b: &WindowBounds) -> bool {
  b.width < MIN_RESTORED_WIDTH
    || b.height < MIN_RESTORED_HEIGHT
    || b.x <= WINDOWS_MINIMIZED_SENTINEL
    || b.y <= WINDOWS_MINIMIZED_SENTINEL
}

fn has_minimized_position(bounds: &WindowBounds) -> bool {
  cfg!(target_os = "windows")
    && (bounds.x <= WINDOWS_MINIMIZED_SENTINEL || bounds.y <= WINDOWS_MINIMIZED_SENTINEL)
}

/// The first-run window: 1280×800 logical content when it fits within 90% of the work area,
/// otherwise shrunk proportionally (16:10 kept) until it does, centered in the work area.
pub fn default_window_bounds(target: FitTarget) -> WindowBounds {
  let scale = if target.scale.is_finite() && target.scale > 0.0 {
    target.scale
  } else {
    1.0
  };
  let content_width = DEFAULT_WINDOW_LOGICAL_WIDTH * scale;
  let content_height = DEFAULT_WINDOW_LOGICAL_HEIGHT * scale;
  let budget_width =
    (target.work_area.width as f64 * WORK_AREA_FIT_FRACTION - target.frame_width as f64).max(0.0);
  let budget_height =
    (target.work_area.height as f64 * WORK_AREA_FIT_FRACTION - target.frame_height as f64).max(0.0);
  let ratio = (budget_width / content_width)
    .min(budget_height / content_height)
    .min(1.0);
  let width = ((content_width * ratio).floor() as u32).max(MIN_RESTORED_WIDTH);
  let height = ((content_height * ratio).floor() as u32).max(MIN_RESTORED_HEIGHT);
  let outer_width = width as i32 + target.frame_width as i32;
  let outer_height = height as i32 + target.frame_height as i32;
  let area = target.work_area;
  WindowBounds {
    x: area.x + ((area.width as i32 - outer_width) / 2).max(0),
    y: area.y + ((area.height as i32 - outer_height) / 2).max(0),
    width,
    height,
    is_maximized: false,
  }
}

/// Returns the visible-overlap area (px²) between the window and a monitor.
fn overlap_area(b: &WindowBounds, m: &MonitorRect) -> u64 {
  let bx2 = b.x as i64 + b.width as i64;
  let by2 = b.y as i64 + b.height as i64;
  let mx2 = m.x as i64 + m.width as i64;
  let my2 = m.y as i64 + m.height as i64;
  let ix = (bx2.min(mx2) - (b.x as i64).max(m.x as i64)).max(0);
  let iy = (by2.min(my2) - (b.y as i64).max(m.y as i64)).max(0);
  ix as u64 * iy as u64
}

/// Saved bounds that are unusable (minimized sentinel, degenerate size) or mostly off-screen (less
/// than 1/8 of the window visible on any monitor) are replaced by the default window placed on
/// `fallback`, keeping only the maximized flag. Anything else is returned unchanged.
pub fn clamp_to_visible(
  b: WindowBounds,
  monitors: &[MonitorRect],
  fallback: FitTarget,
) -> WindowBounds {
  if monitors.is_empty() {
    return b;
  }
  if !is_unusable_bounds(&b) {
    let area = u64::from(b.width) * u64::from(b.height);
    let visible = monitors
      .iter()
      .map(|m| overlap_area(&b, m))
      .max()
      .unwrap_or(0);
    if visible >= area.div_ceil(8) {
      return b;
    }
  }
  WindowBounds {
    is_maximized: b.is_maximized,
    ..default_window_bounds(fallback)
  }
}

/// Placement inputs for a default-sized window on the primary monitor (the first monitor's full
/// rect when no primary is reported), including this window's current chrome.
///
/// The chrome is measured on whichever monitor the window currently sits on, which can have a
/// different DPI than the primary monitor during Dock exit or `apply_window_bounds`; the error is
/// a few physical pixels of centering/budget precision, not a correctness issue. On macOS,
/// decoration changes may apply asynchronously, so chrome read right after `set_decorations`
/// (Dock exit) can likewise be stale by the same small margin.
pub fn primary_fit_target<R: tauri::Runtime>(
  window: &tauri::WebviewWindow<R>,
  monitors: &[MonitorRect],
) -> FitTarget {
  let (frame_width, frame_height) = match (window.outer_size(), window.inner_size()) {
    (Ok(outer), Ok(inner)) => (
      outer.width.saturating_sub(inner.width),
      outer.height.saturating_sub(inner.height),
    ),
    _ => (0, 0),
  };
  match window.primary_monitor().ok().flatten() {
    Some(monitor) => FitTarget {
      work_area: normal_work_area(window, &monitor),
      scale: monitor.scale_factor(),
      frame_width,
      frame_height,
    },
    None => FitTarget {
      work_area: monitors.first().copied().unwrap_or(MonitorRect {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      }),
      scale: window.scale_factor().unwrap_or(1.0),
      frame_width,
      frame_height,
    },
  }
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

pub(crate) fn resolve_placement<R: tauri::Runtime>(
  window: &tauri::WebviewWindow<R>,
  saved: Option<&WindowPlacement>,
) -> Option<ResolvedPlacement> {
  if let Some(saved) = saved {
    if let Some(relative) = saved.relative.as_ref() {
      let monitors = window.available_monitors().unwrap_or_default();
      let monitor = relative
        .monitor
        .as_ref()
        .filter(|_| desktop_position_available())
        .and_then(|name| {
          let mut matches = monitors
            .iter()
            .filter(|monitor| monitor.name() == Some(name));
          let candidate = matches.next()?;
          matches.next().is_none().then(|| candidate.clone())
        })
        .or_else(|| window.current_monitor().ok().flatten())
        .or_else(|| window.primary_monitor().ok().flatten())
        .or_else(|| monitors.into_iter().next());
      if let Some(monitor) = monitor {
        let target = PlacementTarget::from_monitor(window, &monitor);
        let mut resolved = relative.resolve(saved.bounds, &target);
        if cfg!(any(target_os = "macos", target_os = "linux")) {
          snap_to_logical_pixels(&mut resolved.bounds, target.scale);
        }
        if !desktop_position_available() {
          resolved.bounds.x = 0;
          resolved.bounds.y = 0;
        }
        return Some(resolved);
      }
    }
  }
  let monitors = monitor_rects(window);
  let fit = primary_fit_target(window, &monitors);
  let mut bounds = match saved {
    Some(saved) => clamp_to_visible(saved.bounds, &monitors, fit),
    None if !monitors.is_empty() => default_window_bounds(fit),
    None => return None,
  };
  if !desktop_position_available() {
    bounds.x = 0;
    bounds.y = 0;
  }
  Some(ResolvedPlacement {
    bounds,
    target: None,
    resize_inset: tauri::PhysicalSize::new(0, 0),
  })
}

/// Wayland does not expose a global top-level window position. Check the actual GTK display,
/// since a Wayland session may still run PLVS through XWayland.
pub fn desktop_position_available() -> bool {
  #[cfg(target_os = "linux")]
  {
    use gtk::prelude::ObjectExt;
    // Initialized by setup on the GTK thread before any placement commands or persistence.
    static POSITION_AVAILABLE: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *POSITION_AVAILABLE.get_or_init(|| {
      gtk::gdk::Display::default().is_some_and(|display| display.type_().name().contains("X11"))
    })
  }
  #[cfg(not(target_os = "linux"))]
  {
    true
  }
}

fn main_window_is_docked<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) -> bool {
  window
    .state::<crate::dock::DockedFlag>()
    .0
    .load(std::sync::atomic::Ordering::Relaxed)
}

fn require_normal_window<R: tauri::Runtime>(
  window: &tauri::WebviewWindow<R>,
) -> Result<(), String> {
  if main_window_is_docked(window) {
    return Err("The main window is docked".into());
  }
  Ok(())
}

#[tauri::command]
pub fn current_window_bounds<R: tauri::Runtime>(
  window: tauri::WebviewWindow<R>,
) -> Result<Option<WindowPlacement>, String> {
  if main_window_is_docked(&window) {
    return Ok(None);
  }
  capture_window_placement(&window)
}

fn capture_window_placement<R: tauri::Runtime>(
  window: &tauri::WebviewWindow<R>,
) -> Result<Option<WindowPlacement>, String> {
  let is_maximized = window
    .is_maximized()
    .map_err(|e| format!("window maximized state: {e}"))?;
  if is_maximized {
    if let Some(mut normal) = read_persisted_window_bounds(window.app_handle()) {
      normal.bounds.is_maximized = true;
      return Ok(Some(normal));
    }
  }
  if window.is_minimized().unwrap_or(false) {
    return Ok(None);
  }
  let bounds = read_window_bounds(window, is_maximized)?;
  if bounds.width == 0 || bounds.height == 0 || has_minimized_position(&bounds) {
    return Ok(None);
  }
  let relative = window
    .current_monitor()
    .ok()
    .flatten()
    .zip(window.outer_size().ok())
    .filter(|(monitor, _)| monitor.scale_factor() > 0.0)
    .map(|(monitor, outer)| {
      let mut target = PlacementTarget::from_monitor(window, &monitor);
      if let Some(name) = target.monitor.as_ref() {
        let count = window
          .available_monitors()
          .unwrap_or_default()
          .iter()
          .filter(|monitor| monitor.name() == Some(name))
          .count();
        if count != 1 {
          target.monitor = None;
        }
      }
      let mut relative = RelativePlacement::capture(bounds, target, outer.width, outer.height);
      // GTK adds its client-side decoration to a native resize request.
      if cfg!(target_os = "linux") {
        if let Ok(viewport) = window.as_ref().size() {
          relative.resize_inset_width =
            f64::from(bounds.width.saturating_sub(viewport.width)) / relative.scale;
          relative.resize_inset_height =
            f64::from(bounds.height.saturating_sub(viewport.height)) / relative.scale;
        }
      }
      relative
    });
  Ok(Some(WindowPlacement { bounds, relative }))
}

fn read_window_bounds<R: tauri::Runtime>(
  window: &tauri::WebviewWindow<R>,
  is_maximized: bool,
) -> Result<WindowBounds, String> {
  let pos = if desktop_position_available() {
    window
      .outer_position()
      .map_err(|e| format!("window position: {e}"))?
  } else {
    tauri::PhysicalPosition::new(0, 0)
  };
  let size = window
    .inner_size()
    .map_err(|e| format!("window size: {e}"))?;
  Ok(WindowBounds {
    x: pos.x,
    y: pos.y,
    width: size.width,
    height: size.height,
    is_maximized,
  })
}

#[tauri::command]
pub fn resolve_window_bounds<R: tauri::Runtime>(
  window: tauri::WebviewWindow<R>,
  bounds: WindowPlacement,
) -> WindowBounds {
  resolve_placement(&window, Some(&bounds)).map_or(bounds.bounds, |resolved| resolved.bounds)
}

#[tauri::command]
pub fn apply_window_bounds<R: tauri::Runtime>(
  window: tauri::WebviewWindow<R>,
  bounds: WindowPlacement,
) -> Result<(), String> {
  require_normal_window(&window)?;
  let Some(resolved) = resolve_placement(&window, Some(&bounds)) else {
    return Ok(());
  };
  apply_resolved_placement(&window, &resolved)?;
  persist_window_bounds(&window, applied_placement(&resolved, Some(&bounds)))
}

pub(crate) fn apply_resolved_placement<R: tauri::Runtime>(
  window: &tauri::WebviewWindow<R>,
  resolved: &ResolvedPlacement,
) -> Result<(), String> {
  if window
    .is_maximized()
    .map_err(|e| format!("window maximized state: {e}"))?
  {
    window
      .unmaximize()
      .map_err(|e| format!("window unmaximize: {e}"))?;
  }

  let bounds = resolved.bounds;
  let size = if cfg!(target_os = "linux") {
    tauri::PhysicalSize::new(
      bounds
        .width
        .saturating_sub(resolved.resize_inset.width)
        .max(1),
      bounds
        .height
        .saturating_sub(resolved.resize_inset.height)
        .max(1),
    )
  } else {
    tauri::PhysicalSize::new(bounds.width, bounds.height)
  };
  // AppKit and GTK convert physical positions using the window's current scale.
  // Apply in the destination's logical coordinate space when it is known.
  if let Some(target) = resolved
    .target
    .as_ref()
    .filter(|_| cfg!(any(target_os = "macos", target_os = "linux")))
  {
    window
      .set_size(size.to_logical::<f64>(target.scale))
      .map_err(|e| format!("window size: {e}"))?;
    if desktop_position_available() {
      window
        .set_position(
          tauri::PhysicalPosition::new(bounds.x, bounds.y).to_logical::<f64>(target.scale),
        )
        .map_err(|e| format!("window position: {e}"))?;
    }
  } else {
    // Windows rescales a window during a cross-DPI move. Apply the physical size again afterwards.
    window
      .set_size(size)
      .map_err(|e| format!("window size: {e}"))?;
    if desktop_position_available() {
      window
        .set_position(tauri::PhysicalPosition::new(bounds.x, bounds.y))
        .map_err(|e| format!("window position: {e}"))?;
      window
        .set_size(size)
        .map_err(|e| format!("window size: {e}"))?;
    }
  }

  if bounds.is_maximized {
    window
      .maximize()
      .map_err(|e| format!("window maximize: {e}"))?;
  }

  Ok(())
}

pub(crate) fn applied_placement(
  resolved: &ResolvedPlacement,
  saved: Option<&WindowPlacement>,
) -> WindowPlacement {
  let bounds = resolved.bounds;
  let relative = resolved
    .target
    .as_ref()
    .zip(saved.and_then(|saved| saved.relative.as_ref()))
    .map(|(target, source)| {
      let width = (source.frame_width * target.scale).round() as u32;
      let height = (source.frame_height * target.scale).round() as u32;
      let mut relative = RelativePlacement::capture(
        bounds,
        target.clone(),
        bounds.width.saturating_add(width),
        bounds.height.saturating_add(height),
      );
      relative.resize_inset_width = f64::from(resolved.resize_inset.width) / target.scale;
      relative.resize_inset_height = f64::from(resolved.resize_inset.height) / target.scale;
      relative
    });
  WindowPlacement { bounds, relative }
}

/// Places the main window's top-left corner at a CSS-pixel offset from one monitor's work-area
/// origin and gives it a CSS-pixel inner size, for Agent Control's `window move`.
///
/// Monitor and window positions do not share one coordinate space on every platform. Windows and
/// X11 report one virtual desktop in physical pixels, so the target is the work area's physical
/// origin plus the offset scaled by that monitor's factor. macOS reports each monitor's position
/// scaled by its own factor, so physical positions from two displays with different factors cannot
/// be compared; there the target is computed and applied in points. Sizes are logical everywhere:
/// the second size call corrects a size a cross-DPI move rescaled. The debounced window-state
/// flush saves the result as it saves a drag.
#[tauri::command]
pub fn move_main_window<R: tauri::Runtime>(
  window: tauri::WebviewWindow<R>,
  monitor: String,
  x: f64,
  y: f64,
  width: f64,
  height: f64,
) -> Result<(), String> {
  require_normal_window(&window)?;
  let target = window
    .available_monitors()
    .map_err(|e| format!("monitors: {e}"))?
    .into_iter()
    .find(|candidate| candidate.name().map(String::as_str) == Some(monitor.as_str()))
    .ok_or_else(|| format!("monitor {monitor} is not connected"))?;
  if window
    .is_maximized()
    .map_err(|e| format!("window maximized state: {e}"))?
  {
    window
      .unmaximize()
      .map_err(|e| format!("window unmaximize: {e}"))?;
  }
  let size = tauri::LogicalSize::new(width, height);
  window
    .set_size(size)
    .map_err(|e| format!("window size: {e}"))?;
  let work_area = target.work_area();
  if cfg!(target_os = "macos") {
    let origin = work_area.position.to_logical::<f64>(target.scale_factor());
    window
      .set_position(tauri::LogicalPosition::new(origin.x + x, origin.y + y))
      .map_err(|e| format!("window position: {e}"))?;
  } else {
    let scale = target.scale_factor();
    window
      .set_position(tauri::PhysicalPosition::new(
        work_area.position.x + (x * scale).round() as i32,
        work_area.position.y + (y * scale).round() as i32,
      ))
      .map_err(|e| format!("window position: {e}"))?;
  }
  window
    .set_size(size)
    .map_err(|e| format!("window size: {e}"))?;
  Ok(())
}

/// Persist the actual normal-window geometry after Agent Control observes the move settling.
#[tauri::command]
pub fn remember_main_window_position<R: tauri::Runtime>(
  window: tauri::WebviewWindow<R>,
) -> Result<(), String> {
  require_normal_window(&window)?;
  let bounds = capture_window_placement(&window)?
    .filter(|placement| !placement.bounds.is_maximized)
    .ok_or_else(|| "No normal window position to save".to_string())?;
  persist_window_bounds(&window, bounds)
}

/// The title bar's Maximize / Restore and the system Minimize, for Agent Control. They stay native
/// so the frontend capability does not grow general window-state permissions.
#[tauri::command]
pub fn set_main_window_state<R: tauri::Runtime>(
  window: tauri::WebviewWindow<R>,
  state: String,
) -> Result<(), String> {
  require_normal_window(&window)?;
  match state.as_str() {
    "maximize" => {
      if !window.is_maximized().unwrap_or(false) {
        save_window_bounds(&window);
      }
      window.maximize()
    }
    "unmaximize" => window.unmaximize(),
    "minimize" => window.minimize(),
    other => return Err(format!("unknown window state {other}")),
  }
  .map_err(|e| format!("window {state}: {e}"))
}

pub(crate) fn persist_window_bounds<R: tauri::Runtime>(
  window: &tauri::WebviewWindow<R>,
  bounds: WindowPlacement,
) -> Result<(), String> {
  let app = window.app_handle();
  let value = serde_json::to_value(&bounds).unwrap_or_default();
  let runtime = app.state::<crate::persistence::commands::PersistenceRuntime>();
  if runtime.is_installed() {
    runtime
      .save_workspace_value(crate::persistence::WorkspaceValue::WindowBounds, &value)
      .map_err(|error| format!("save workspace window bounds: {error}"))?;
  } else {
    let store = app
      .store("plvs-settings.json")
      .map_err(|error| format!("window bounds store: {error}"))?;
    store.set("windowBounds", value);
    store
      .save()
      .map_err(|error| format!("save window bounds: {error}"))?;
  }
  let _ = window.emit("window-bounds-changed", bounds);
  Ok(())
}

pub(crate) fn read_persisted_window_bounds<R: tauri::Runtime>(
  app: &tauri::AppHandle<R>,
) -> Option<WindowPlacement> {
  let runtime = app.state::<crate::persistence::commands::PersistenceRuntime>();
  let value = if runtime.is_installed() {
    runtime
      .workspace_value(crate::persistence::WorkspaceValue::WindowBounds)
      .ok()
      .flatten()
  } else {
    app
      .store("plvs-settings.json")
      .ok()
      .and_then(|store| store.get("windowBounds"))
  }?;
  serde_json::from_value(value).ok()
}

/// Read the current outer bounds of the window and write them to the top-level
/// `windowBounds` store key.
///
/// `windowBounds` is a Rust-owned sibling key — NOT a field inside `plvs:settings`.
/// The JS pluginStoreBackend holds an in-memory copy of `plvs:settings` seeded at boot;
/// if window geometry lived inside that object, a JS settings write would re-persist the
/// stale boot bounds and clobber the geometry Rust just saved. In multi-instance storage this
/// sibling belongs to the owning Workspace rather than the shared Library.
pub fn save_window_bounds<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
  if let Ok(Some(bounds)) = capture_window_placement(window) {
    let _ = persist_window_bounds(window, bounds);
  }
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

  fn target() -> FitTarget {
    FitTarget {
      work_area: mon()[0],
      scale: 1.0,
      frame_width: 0,
      frame_height: 0,
    }
  }

  fn display(name: &str, x: i32, y: i32, width: u32, height: u32, scale: f64) -> PlacementTarget {
    PlacementTarget {
      monitor: Some(name.into()),
      work_area: MonitorRect {
        x,
        y,
        width,
        height,
      },
      scale,
    }
  }

  #[test]
  fn restores_exact_pixels_on_the_same_display_and_stays_centered_on_4k() {
    let original = WindowBounds {
      x: 768,
      y: 432,
      width: 1024,
      height: 576,
      is_maximized: false,
    };
    let source = display("first", 0, 0, 2560, 1440, 1.0);
    let relative = RelativePlacement::capture(original, source.clone(), 1024, 576);
    assert_eq!(relative.resolve(original, &source).bounds, original);
    let target = display("second", 0, 0, 3840, 2160, 1.0);
    assert_eq!(
      relative.resolve(original, &target).bounds,
      WindowBounds {
        x: 1408,
        y: 792,
        ..original
      }
    );
  }

  #[test]
  fn preserves_trailing_edges_and_logical_content_size_in_a_scaled_work_area() {
    let original = WindowBounds {
      x: 1520,
      y: 788,
      width: 1024,
      height: 576,
      is_maximized: true,
    };
    let source = display("first", 0, 0, 2560, 1400, 1.0);
    let relative = RelativePlacement::capture(original, source, 1040, 612);
    let target = display("second", -3840, 30, 3840, 2100, 1.5);
    assert_eq!(
      relative.resolve(original, &target).bounds,
      WindowBounds {
        x: -1560,
        y: 1212,
        width: 1536,
        height: 864,
        is_maximized: true,
      }
    );
  }

  #[test]
  fn fits_the_outer_window_on_a_smaller_work_area() {
    let original = WindowBounds {
      x: 0,
      y: 0,
      width: 2000,
      height: 1000,
      is_maximized: false,
    };
    let source = display("first", 0, 0, 3840, 2160, 1.0);
    let relative = RelativePlacement::capture(original, source, 2020, 1040);
    let target = display("second", 20, 40, 1000, 550, 1.0);
    assert_eq!(
      relative.resolve(original, &target).bounds,
      WindowBounds {
        x: 20,
        y: 40,
        width: 980,
        height: 490,
        is_maximized: false,
      }
    );
  }

  #[test]
  fn malformed_relative_metadata_leaves_the_legacy_rectangle_readable() {
    let legacy = json!({"x": 50, "y": 60, "width": 900, "height": 600, "isMaximized": false});
    let mut malformed = legacy.clone();
    malformed["relative"] = json!({"scale": 0});
    let placement: WindowPlacement = serde_json::from_value(malformed).unwrap();
    assert_eq!(serde_json::to_value(placement).unwrap(), legacy);
  }

  #[test]
  fn resolves_half_point_rounding_before_applying_on_a_scaled_logical_desktop() {
    let mut bounds = WindowBounds {
      x: 446,
      y: 413,
      width: 2048,
      height: 1152,
      is_maximized: false,
    };
    snap_to_logical_pixels(&mut bounds, 2.0);
    assert_eq!(
      (bounds.x, bounds.y, bounds.width, bounds.height),
      (446, 414, 2048, 1152)
    );
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
    assert_eq!(clamp_to_visible(b, &mon(), target()), b);
  }

  #[test]
  fn replaces_a_window_on_a_gone_monitor_with_the_default_window() {
    let b = WindowBounds {
      x: 5000,
      y: 5000,
      width: 1800,
      height: 1000,
      is_maximized: false,
    };
    let c = clamp_to_visible(b, &mon(), target());
    assert_eq!((c.width, c.height), (1280, 800));
    assert_eq!((c.x, c.y), ((1920 - 1280) / 2, (1080 - 800) / 2));
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
    assert_eq!(clamp_to_visible(b, &[], target()), b);
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
    let c = clamp_to_visible(b, &mon(), target());
    assert!(c.is_maximized);
    assert_eq!((c.width, c.height), (1280, 800));
  }

  #[test]
  fn replaces_minimized_windows_sentinel_bounds_with_the_default_window() {
    let b = WindowBounds {
      x: -32000,
      y: -32000,
      width: 0,
      height: 0,
      is_maximized: false,
    };
    let c = clamp_to_visible(b, &mon(), target());
    assert_eq!((c.width, c.height), (1280, 800));
    assert_eq!((c.x, c.y), ((1920 - 1280) / 2, (1080 - 800) / 2));
  }

  #[test]
  fn default_window_is_1280_by_800_logical_centered_when_it_fits() {
    // 2560x1440 at 125% with a 60 px taskbar; chrome is 16 x 40 physical.
    let t = FitTarget {
      work_area: MonitorRect {
        x: 0,
        y: 0,
        width: 2560,
        height: 1380,
      },
      scale: 1.25,
      frame_width: 16,
      frame_height: 40,
    };
    assert_eq!(
      default_window_bounds(t),
      WindowBounds {
        x: 472,
        y: 170,
        width: 1600,
        height: 1000,
        is_maximized: false,
      }
    );
  }

  #[test]
  fn default_window_shrinks_proportionally_into_90_percent_of_the_work_area() {
    // 1920x1080 at 125% with a 48 px taskbar: a 1536x826 logical work area.
    let t = FitTarget {
      work_area: MonitorRect {
        x: 0,
        y: 0,
        width: 1920,
        height: 1032,
      },
      scale: 1.25,
      frame_width: 16,
      frame_height: 40,
    };
    let b = default_window_bounds(t);
    assert_eq!((b.width, b.height), (1422, 888));
    assert!(b.width + 16 <= 1728 && b.height + 40 <= 929);
    assert_eq!((b.x, b.y), (241, 52));
  }

  #[test]
  fn default_window_centers_in_a_work_area_away_from_the_origin() {
    let t = FitTarget {
      work_area: MonitorRect {
        x: -1920,
        y: 40,
        width: 1920,
        height: 1040,
      },
      scale: 1.0,
      frame_width: 0,
      frame_height: 0,
    };
    assert_eq!(
      default_window_bounds(t),
      WindowBounds {
        x: -1600,
        y: 160,
        width: 1280,
        height: 800,
        is_maximized: false,
      }
    );
  }

  #[test]
  fn default_window_treats_an_invalid_scale_as_one() {
    let t = FitTarget {
      work_area: MonitorRect {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
      },
      scale: 0.0,
      frame_width: 0,
      frame_height: 0,
    };
    let b = default_window_bounds(t);
    assert_eq!((b.width, b.height), (1280, 800));
  }

  #[test]
  fn default_window_falls_back_to_the_minimum_size_on_a_zero_size_work_area() {
    let t = FitTarget {
      work_area: MonitorRect {
        x: 100,
        y: 50,
        width: 0,
        height: 0,
      },
      scale: 1.0,
      frame_width: 0,
      frame_height: 0,
    };
    assert_eq!(
      default_window_bounds(t),
      WindowBounds {
        x: 100,
        y: 50,
        width: 320,
        height: 240,
        is_maximized: false,
      }
    );
  }

  #[test]
  fn default_window_falls_back_to_the_minimum_size_when_chrome_exceeds_the_budget() {
    let t = FitTarget {
      work_area: MonitorRect {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
      },
      scale: 1.0,
      frame_width: 2000,
      frame_height: 1200,
    };
    assert_eq!(
      default_window_bounds(t),
      WindowBounds {
        x: 0,
        y: 0,
        width: 320,
        height: 240,
        is_maximized: false,
      }
    );
  }

  #[test]
  fn default_window_falls_back_to_the_minimum_size_on_a_work_area_smaller_than_the_minimum() {
    let t = FitTarget {
      work_area: MonitorRect {
        x: 10,
        y: 20,
        width: 300,
        height: 200,
      },
      scale: 1.0,
      frame_width: 0,
      frame_height: 0,
    };
    assert_eq!(
      default_window_bounds(t),
      WindowBounds {
        x: 10,
        y: 20,
        width: 320,
        height: 240,
        is_maximized: false,
      }
    );
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
  fn clean_active_preset_supplies_bounds_when_the_workspace_has_no_placement() {
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
      startup_window_bounds(&presets, Value::Null).map(|placement| placement.bounds),
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
  fn later_workspace_move_takes_precedence_over_selected_preset_at_startup() {
    let presets = json!({
      "list": [{
        "id": "mix",
        "windowBounds": {"x": 10, "y": 20, "width": 800, "height": 600}
      }],
      "activeId": "mix"
    });
    let moved = json!({"x": 200, "y": 100, "width": 800, "height": 600});

    assert_eq!(
      startup_window_bounds(&presets, moved).map(|placement| placement.bounds.x),
      Some(200)
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

  #[test]
  fn clean_active_preset_supplies_startup_surface_opacity() {
    let settings = json!({ "surfaceOpacity": 80 });
    let presets = json!({
      "list": [{ "id": "mix", "surfaceOpacity": 0 }],
      "activeId": "mix",
      "dirty": false
    });

    assert_eq!(startup_surface_opacity(&settings, &presets), 0);
  }

  #[test]
  fn dirty_or_invalid_preset_uses_current_surface_opacity() {
    let settings = json!({ "surfaceOpacity": 64 });
    let presets = json!({
      "list": [{ "id": "mix", "surfaceOpacity": 101 }],
      "activeId": "mix",
      "dirty": true
    });

    assert_eq!(startup_surface_opacity(&settings, &presets), 64);
    let clean_invalid = json!({
      "list": [{ "id": "mix", "surfaceOpacity": 101 }],
      "activeId": "mix",
      "dirty": false
    });
    assert_eq!(startup_surface_opacity(&settings, &clean_invalid), 64);
    assert_eq!(
      startup_surface_opacity(&json!({ "surfaceOpacity": -1 }), &json!({})),
      100
    );
  }
}
