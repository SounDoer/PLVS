use std::sync::Mutex;

use tauri::{Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::dock::{dock_accessory_rects, DockEdge};
use crate::window_state::{MonitorRect, WindowBounds};

pub const DOCK_HEADER_LABEL: &str = "dock-header";
pub const DOCK_EDITOR_LABEL: &str = "dock-editor";
pub const DOCK_UPDATE_LABEL: &str = "dock-update";
pub const DOCK_IMPORT_LABEL: &str = "dock-import";
pub const DOCK_SETTINGS_LABEL: &str = "dock-settings";
pub const DOCK_AUTHORING_LABEL: &str = "dock-authoring";

fn accessory_builder<'a, R: tauri::Runtime, M: Manager<R>>(
  manager: &'a M,
  label: &str,
  init_script: &str,
) -> WebviewWindowBuilder<'a, R, M> {
  // Each accessory's label is also its frontend surface name.
  let builder = WebviewWindowBuilder::new(
    manager,
    label,
    WebviewUrl::App(format!("index.html?surface={label}").into()),
  )
  .title(
    if matches!(label, DOCK_SETTINGS_LABEL | DOCK_AUTHORING_LABEL) {
      "PLVS — Settings"
    } else {
      "PLVS"
    },
  )
  .inner_size(1.0, 1.0)
  .initialization_script(init_script)
  .visible(false)
  .focused(false)
  .focusable(true)
  .decorations(false)
  .resizable(false)
  .always_on_top(true)
  .skip_taskbar(true)
  .shadow(false);
  // Switching between the strip, toolbar and editor must not consume a click
  // solely to activate the destination window on macOS.
  #[cfg(target_os = "macos")]
  let builder = builder.accept_first_mouse(true);
  #[cfg(any(target_os = "windows", target_os = "macos"))]
  let builder = builder.transparent(true);
  builder
}

/// The boot initialization script, kept for accessories created after setup.
pub struct AccessoryInitScript(pub String);

/// Serializes accessory creation. Tauri's duplicate-label check does not cover a build that is
/// still in flight, so two concurrent requests would each create a window and leak a renderer.
static ACCESSORY_CREATION: Mutex<()> = Mutex::new(());

/// Build an accessory unless it already exists. Each one costs a WebView renderer (about 33 MB
/// private, 70 MB working set measured on Windows), so none is created at startup.
fn ensure_accessory<R: tauri::Runtime>(
  app: &tauri::AppHandle<R>,
  label: &str,
) -> Result<(), String> {
  let _creation = ACCESSORY_CREATION
    .lock()
    .unwrap_or_else(|poisoned| poisoned.into_inner());
  if app.get_webview_window(label).is_some() {
    return Ok(());
  }
  let init_script = app.state::<AccessoryInitScript>().0.clone();
  let window = accessory_builder(app, label, &init_script)
    .build()
    .map_err(|error| format!("{label} window: {error}"))?;
  if matches!(label, DOCK_SETTINGS_LABEL | DOCK_AUTHORING_LABEL) {
    let owner = app.clone();
    let label = label.to_owned();
    window.on_window_event(move |event| {
      if label == DOCK_AUTHORING_LABEL {
        if let Ok(mut saved) = AUTHORING_BOUNDS.lock() {
          if let Some((bounds, false)) = saved.as_mut() {
            match event {
              tauri::WindowEvent::Moved(position) => {
                bounds.x = position.x;
                bounds.y = position.y;
              }
              tauri::WindowEvent::Resized(size) => {
                bounds.width = size.width;
                bounds.height = size.height;
              }
              _ => {}
            }
          }
        }
      }
      if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = owner.emit_to(
          &label,
          "dock-accessory://action",
          serde_json::json!({
            "surface": label, "type": "settings-dismiss", "payload": {}
          }),
        );
      }
    });
  }
  #[cfg(target_os = "macos")]
  crate::macos_dock_window::configure_accessory(&window)?;
  // Subclassing must happen on the thread that owns the window; this command runs elsewhere.
  #[cfg(target_os = "windows")]
  if label != DOCK_AUTHORING_LABEL {
    let pinned = window.clone();
    window
      .run_on_main_thread(move || {
        if let Err(error) = crate::accessory_pin::install(&pinned) {
          log::warn!("{} position pin: {error}", pinned.label());
        }
      })
      .map_err(|error| format!("{label} position pin: {error}"))?;
  }
  #[cfg(not(target_os = "windows"))]
  let _ = window;
  Ok(())
}

/// Create the toolbar and editor accessories when the main window enters or boots into Dock, so
/// sessions that never dock never pay for them. They are kept after Dock exits: an editor draft
/// must survive, and re-entering Dock should not wait for new WebViews. A new accessory announces
/// readiness, which republishes the current state to it before it is shown.
/// Async: building a window from a synchronous command can deadlock on Windows.
#[tauri::command]
pub async fn prepare_dock_accessories<R: tauri::Runtime>(
  window: WebviewWindow<R>,
) -> Result<(), String> {
  if window.label() != "main" {
    return Err("Only the main window owns Dock accessories.".into());
  }
  let app = window.app_handle();
  ensure_accessory(app, DOCK_HEADER_LABEL)?;
  ensure_accessory(app, DOCK_EDITOR_LABEL)
}

/// Create the update accessory only when Dock may need it. The main window calls this as soon
/// as an update or first-launch setup exists, so the window is normally ready before a click.
/// Async: building a window from a synchronous command can deadlock on Windows.
#[tauri::command]
pub async fn prepare_dock_update_window<R: tauri::Runtime>(
  window: WebviewWindow<R>,
) -> Result<(), String> {
  if window.label() != "main" {
    return Err("Only the main window owns update presentation.".into());
  }
  if cfg!(feature = "preview-identity") {
    return Err("Updates are unavailable in Preview.".into());
  }
  ensure_accessory(window.app_handle(), DOCK_UPDATE_LABEL)
}

#[tauri::command]
pub async fn prepare_dock_import_window<R: tauri::Runtime>(
  window: WebviewWindow<R>,
) -> Result<(), String> {
  if window.label() != "main" {
    return Err("Only the main window owns import presentation.".into());
  }
  ensure_accessory(window.app_handle(), DOCK_IMPORT_LABEL)
}

fn set_rect<R: tauri::Runtime>(
  window: &WebviewWindow<R>,
  rect: WindowBounds,
) -> Result<(), String> {
  #[cfg(target_os = "windows")]
  if window.label() != DOCK_AUTHORING_LABEL {
    crate::accessory_pin::pin(window, rect);
  }
  window
    .set_size(tauri::PhysicalSize::new(rect.width, rect.height))
    .map_err(|e| format!("{} size: {e}", window.label()))?;
  window
    .set_position(tauri::PhysicalPosition::new(rect.x, rect.y))
    .map_err(|e| format!("{} position: {e}", window.label()))?;
  Ok(())
}

fn focus_window<R: tauri::Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  {
    crate::macos_dock_window::present(window, true, true)
  }
  #[cfg(not(target_os = "macos"))]
  {
    window
      .set_focus()
      .map_err(|error| format!("{} focus: {error}", window.label()))
  }
}

fn show_or_hide<R: tauri::Runtime>(
  window: &WebviewWindow<R>,
  visible: bool,
  focus_on_show: bool,
) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  {
    let was_visible = window.is_visible().map_err(|error| error.to_string())?;
    crate::macos_dock_window::present(window, visible, focus_on_show && !was_visible)
  }
  #[cfg(not(target_os = "macos"))]
  if visible {
    let was_visible = window
      .is_visible()
      .map_err(|e| format!("{} visibility: {e}", window.label()))?;
    window
      .show()
      .map_err(|e| format!("{} show: {e}", window.label()))?;
    if focus_on_show && !was_visible {
      focus_window(window)?;
    }
    Ok(())
  } else {
    window
      .hide()
      .map_err(|e| format!("{} hide: {e}", window.label()))
  }
}

fn main_geometry<R: tauri::Runtime>(
  main: &WebviewWindow<R>,
) -> Result<(MonitorRect, WindowBounds, f64), String> {
  let monitor = main
    .current_monitor()
    .map_err(|e| format!("accessory current monitor: {e}"))?
    .or_else(|| main.primary_monitor().ok().flatten())
    .ok_or_else(|| "no monitor available for dock accessories".to_string())?;
  let position = main
    .outer_position()
    .map_err(|e| format!("accessory strip position: {e}"))?;
  let size = main
    .inner_size()
    .map_err(|e| format!("accessory strip size: {e}"))?;
  Ok((
    MonitorRect {
      x: monitor.position().x,
      y: monitor.position().y,
      width: monitor.size().width,
      height: monitor.size().height,
    },
    WindowBounds {
      x: position.x,
      y: position.y,
      width: size.width,
      height: size.height,
      is_maximized: false,
    },
    monitor.scale_factor(),
  ))
}

pub fn hide_all<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
  for label in [
    DOCK_HEADER_LABEL,
    DOCK_EDITOR_LABEL,
    DOCK_UPDATE_LABEL,
    DOCK_IMPORT_LABEL,
    DOCK_SETTINGS_LABEL,
    DOCK_AUTHORING_LABEL,
  ] {
    if let Some(window) = app.get_webview_window(label) {
      let _ = show_or_hide(&window, false, false);
    }
  }
}

/// Independent from the toolbar/editor so opening update details cannot replace an editor draft.
#[tauri::command]
pub fn set_dock_update_window<R: tauri::Runtime>(
  window: WebviewWindow<R>,
  visible: bool,
  edge: DockEdge,
  webview_scale: f64,
  content_height: f64,
) -> Result<Option<WindowBounds>, String> {
  if window.label() != "main" {
    return Err("Only the main window owns update presentation.".into());
  }
  // The main webview can hydrate before setup finishes creating its accessories.
  // Hiding a window that does not exist yet is already satisfied; showing it is not.
  let Some(update) = window.app_handle().get_webview_window(DOCK_UPDATE_LABEL) else {
    return if visible {
      Err("Dock update window unavailable.".into())
    } else {
      Ok(None)
    };
  };
  if !visible {
    show_or_hide(&update, false, false)?;
    return Ok(None);
  }
  if !webview_scale.is_finite() || webview_scale <= 0.0 {
    return Err("Invalid update window scale.".into());
  }
  let (monitor, strip, _) = main_geometry(&window)?;
  if !content_height.is_finite() || content_height <= 0.0 {
    return Err("Invalid update content height.".into());
  }
  let rects = dock_accessory_rects(
    monitor,
    strip,
    edge,
    webview_scale,
    480.0,
    content_height.min(2000.0),
    None,
  );
  set_rect(&update, rects.editor)?;
  show_or_hide(&update, true, true)?;
  Ok(Some(rects.editor))
}

#[tauri::command]
pub fn set_dock_import_window<R: tauri::Runtime>(
  window: WebviewWindow<R>,
  visible: bool,
  edge: DockEdge,
  webview_scale: f64,
  content_height: f64,
) -> Result<Option<WindowBounds>, String> {
  if window.label() != "main" {
    return Err("Only the main window owns import presentation.".into());
  }
  // The main webview can hydrate before setup finishes creating its accessories.
  // Hiding a window that does not exist yet is already satisfied; showing it is not.
  let Some(import) = window.app_handle().get_webview_window(DOCK_IMPORT_LABEL) else {
    return if visible {
      Err("Dock import window unavailable.".into())
    } else {
      Ok(None)
    };
  };
  if !visible {
    show_or_hide(&import, false, false)?;
    return Ok(None);
  }
  if !webview_scale.is_finite() || webview_scale <= 0.0 {
    return Err("Invalid import window scale.".into());
  }
  let (monitor, strip, _) = main_geometry(&window)?;
  if !content_height.is_finite() || content_height <= 0.0 {
    return Err("Invalid import content height.".into());
  }
  let rects = dock_accessory_rects(
    monitor,
    strip,
    edge,
    webview_scale,
    480.0,
    content_height.min(2000.0),
    None,
  );
  set_rect(&import, rects.editor)?;
  show_or_hide(&import, true, true)?;
  Ok(Some(rects.editor))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn set_dock_accessories<R: tauri::Runtime>(
  window: WebviewWindow<R>,
  edge: DockEdge,
  header_visible: bool,
  editor_visible: bool,
  editor_width: f64,
  editor_height: f64,
  editor_anchor_x: Option<f64>,
  webview_scale: Option<f64>,
) -> Result<(), String> {
  let app = window.app_handle();
  let main = app
    .get_webview_window("main")
    .ok_or_else(|| "main window unavailable".to_string())?;
  let header = app.get_webview_window(DOCK_HEADER_LABEL);
  let editor = app.get_webview_window(DOCK_EDITOR_LABEL);
  if header_visible && header.is_none() {
    return Err("dock header window unavailable".to_string());
  }
  if editor_visible && editor.is_none() {
    return Err("dock editor window unavailable".to_string());
  }
  let (monitor, strip, monitor_scale) = main_geometry(&main)?;
  // The caller's devicePixelRatio, not `monitor_scale`: only the webview sees the
  // Windows text-scaling factor. Fall back to the monitor when JS sends nothing.
  let scale = webview_scale
    .filter(|value| value.is_finite() && *value > 0.0)
    .unwrap_or(monitor_scale);
  let rects = dock_accessory_rects(
    monitor,
    strip,
    edge,
    scale,
    editor_width,
    editor_height,
    editor_anchor_x,
  );

  let editor_had_focus = editor
    .as_ref()
    .is_some_and(|editor| editor.is_focused().unwrap_or(false));
  if let Some(header) = &header {
    set_rect(header, rects.header)?;
    // Created on first use, so it may appear after the strip began refusing activation.
    #[cfg(target_os = "windows")]
    let _ = header.set_focusable(!crate::appbar::dock_refuses_activation());
    show_or_hide(header, header_visible, false)?;
  }
  #[cfg(target_os = "windows")]
  crate::appbar::set_dock_toolbar_visible(&main, header_visible);
  // Hiding the window that holds focus hands focus to whatever is behind PLVS. The
  // frontend would read that as the user leaving and close the toolbar under them, so
  // the header takes focus first and no other application is activated in between.
  if editor_had_focus && !editor_visible && header_visible {
    if let Some(header) = &header {
      let _ = focus_window(header);
    }
  }
  if let Some(editor) = &editor {
    set_rect(editor, rects.editor)?;
    show_or_hide(editor, editor_visible, true)?;
  }
  Ok(())
}

/// Settings is a long-lived interaction, independent of transient toolbar/editor focus.
#[tauri::command]
pub async fn prepare_dock_settings_window<R: tauri::Runtime>(
  window: WebviewWindow<R>,
  surface: String,
) -> Result<(), String> {
  if window.label() != "main" {
    return Err("Only main owns Settings presentation.".into());
  }
  if !cfg!(any(target_os = "windows", target_os = "macos")) {
    return Err("Dock is unavailable on this platform.".into());
  }
  validate_settings_surface(&surface)?;
  ensure_accessory(window.app_handle(), &surface)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsWindowLayout {
  logical_width: f64,
  logical_height: f64,
  preview: bool,
}

#[tauri::command]
pub fn set_dock_settings_window<R: tauri::Runtime>(
  window: WebviewWindow<R>,
  surface: String,
  visible: bool,
  edge: DockEdge,
  webview_scale: f64,
  focus: bool,
  layout: SettingsWindowLayout,
) -> Result<Option<WindowBounds>, String> {
  if window.label() != "main" {
    return Err("Only main owns Settings presentation.".into());
  }
  let SettingsWindowLayout {
    logical_width,
    logical_height,
    preview,
  } = layout;
  validate_settings_surface(&surface)?;
  let Some(settings) = window.app_handle().get_webview_window(&surface) else {
    return if visible {
      Err("Dock Settings window unavailable.".into())
    } else {
      Ok(None)
    };
  };
  if !visible {
    show_or_hide(&settings, false, false)?;
    return Ok(None);
  }
  if !webview_scale.is_finite() || webview_scale <= 0.0 {
    return Err("Invalid Settings window scale.".into());
  }
  let (monitor, strip, _) = main_geometry(&window)?;
  if !logical_width.is_finite() || logical_width <= 0.0 {
    return Err("Invalid Settings window width.".into());
  }
  if !logical_height.is_finite() || logical_height <= 0.0 {
    return Err("Invalid Settings window height.".into());
  }
  let rect = if surface == DOCK_AUTHORING_LABEL {
    authoring_window_bounds(
      &settings,
      monitor,
      strip,
      edge,
      webview_scale,
      SettingsWindowLayout {
        logical_width,
        logical_height,
        preview,
      },
    )?
  } else {
    settings_window_bounds(monitor, strip, edge, webview_scale, logical_width)
  };
  set_rect(&settings, rect)?;
  show_or_hide(&settings, true, true)?;
  if focus {
    focus_window(&settings)?;
  }
  Ok(Some(rect))
}

fn settings_window_bounds(
  monitor: MonitorRect,
  strip: WindowBounds,
  edge: DockEdge,
  scale: f64,
  logical_width: f64,
) -> WindowBounds {
  let header = dock_accessory_rects(monitor, strip, edge, scale, 400.0, 400.0, None).header;
  let inset = (8.0 * scale).round().max(1.0) as u32;
  let width = ((logical_width * scale).round() as u32)
    .min(monitor.width.saturating_sub(2 * inset))
    .max(1);
  let available = match edge {
    DockEdge::Top => {
      monitor.y + monitor.height as i32 - (header.y + header.height as i32) - inset as i32
    }
    DockEdge::Bottom => header.y - monitor.y - inset as i32,
  }
  .max(1) as u32;
  let height = ((800.0 * scale).round() as u32).min(available).max(1);
  WindowBounds {
    x: monitor.x + monitor.width.saturating_sub(width + inset) as i32,
    y: match edge {
      DockEdge::Top => header.y + header.height as i32,
      DockEdge::Bottom => header.y - height as i32,
    },
    width,
    height,
    is_maximized: false,
  }
}

#[cfg(test)]
mod settings_tests {
  use super::*;
  #[test]
  fn settings_fits_each_edge_and_uses_webview_scale() {
    let monitor = MonitorRect {
      x: -1600,
      y: 0,
      width: 1600,
      height: 1000,
    };
    for edge in [DockEdge::Top, DockEdge::Bottom] {
      let strip = WindowBounds {
        x: -1600,
        y: if edge == DockEdge::Top { 0 } else { 850 },
        width: 1600,
        height: 150,
        is_maximized: false,
      };
      let bounds = settings_window_bounds(monitor, strip, edge, 1.25, 640.0);
      assert_eq!(bounds.width, 800);
      assert!(bounds.height > 0 && bounds.y >= monitor.y);
      assert!(
        bounds.x >= monitor.x && bounds.x + bounds.width as i32 <= monitor.x + monitor.width as i32
      );
      assert!(bounds.y + bounds.height as i32 <= monitor.y + monitor.height as i32);
    }
  }
}

/// The main application's file actions keep their business owner, but their native dialog must
/// belong to the visible Settings host. The strip can deliberately refuse activation.
#[tauri::command]
pub async fn settings_file_dialog<R: tauri::Runtime>(
  window: WebviewWindow<R>,
  save: bool,
  filter_name: String,
  extensions: Vec<String>,
  default_path: Option<String>,
) -> Result<Option<String>, String> {
  use tauri_plugin_dialog::DialogExt;
  if window.label() != "main" {
    return Err("Only main owns Settings file operations.".into());
  }
  let app = window.app_handle();
  let docked = app
    .try_state::<crate::dock::DockedFlag>()
    .is_some_and(|state| state.0.load(std::sync::atomic::Ordering::Acquire));
  let parent = [DOCK_AUTHORING_LABEL, DOCK_SETTINGS_LABEL]
    .iter()
    .filter_map(|label| app.get_webview_window(label))
    .find(|candidate| candidate.is_visible().unwrap_or(false))
    .or_else(|| (!docked).then(|| window.clone()));
  let extension_refs: Vec<_> = extensions.iter().map(String::as_str).collect();
  let mut builder = app.dialog().file().add_filter(filter_name, &extension_refs);
  #[cfg(any(target_os = "windows", target_os = "macos"))]
  {
    if let Some(parent) = &parent {
      builder = builder.set_parent(parent);
    }
  }
  #[cfg(not(any(target_os = "windows", target_os = "macos")))]
  let _ = parent;
  if let Some(path) = default_path {
    let path = std::path::PathBuf::from(path);
    if path.is_dir() {
      builder = builder.set_directory(path);
    } else {
      if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
      {
        builder = builder.set_directory(parent);
      }
      if let Some(name) = path.file_name() {
        builder = builder.set_file_name(name.to_string_lossy());
      }
    }
  }
  tauri::async_runtime::spawn_blocking(move || {
    let selected = if save {
      builder.blocking_save_file()
    } else {
      builder.blocking_pick_file()
    };
    selected
      .map(|path| {
        path
          .into_path()
          .map(|path| path.to_string_lossy().into_owned())
          .map_err(|error| error.to_string())
      })
      .transpose()
  })
  .await
  .map_err(|error| error.to_string())?
}

fn validate_settings_surface(surface: &str) -> Result<(), String> {
  if matches!(surface, DOCK_SETTINGS_LABEL | DOCK_AUTHORING_LABEL) {
    Ok(())
  } else {
    Err("Unknown Settings presentation host.".into())
  }
}

// Positions live only for this process and remain physical pixels. Preview temporarily expands
// around the editor, then restores its base position, including a user-dragged position.
static AUTHORING_BOUNDS: Mutex<Option<(WindowBounds, bool)>> = Mutex::new(None);
fn authoring_window_bounds<R: tauri::Runtime>(
  window: &WebviewWindow<R>,
  mut monitor: MonitorRect,
  strip: WindowBounds,
  edge: DockEdge,
  scale: f64,
  layout: SettingsWindowLayout,
) -> Result<WindowBounds, String> {
  let SettingsWindowLayout {
    logical_width: width,
    logical_height: height,
    preview,
  } = layout;
  let mut saved = *AUTHORING_BOUNDS
    .lock()
    .unwrap_or_else(|error| error.into_inner());
  if let Some((base, _)) = saved {
    if let Ok(monitors) = window.available_monitors() {
      if let Some(candidate) = monitors.iter().find(|candidate| {
        let position = candidate.position();
        let size = candidate.size();
        base.x >= position.x
          && base.x < position.x + size.width as i32
          && base.y >= position.y
          && base.y < position.y + size.height as i32
      }) {
        monitor = MonitorRect {
          x: candidate.position().x,
          y: candidate.position().y,
          width: candidate.size().width,
          height: candidate.size().height,
        };
      }
    }
  }
  let mut rect = settings_window_bounds(monitor, strip, edge, scale, width);
  rect.height = ((height * scale).round() as u32)
    .min(monitor.height.saturating_sub((16.0 * scale) as u32))
    .max(1);
  let visible = window.is_visible().unwrap_or(false);
  if visible {
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let size = window.inner_size().map_err(|error| error.to_string())?;
    let current = WindowBounds {
      x: position.x,
      y: position.y,
      width: size.width,
      height: size.height,
      is_maximized: false,
    };
    let was_preview = saved.as_ref().is_some_and(|(_, expanded)| *expanded);
    if !was_preview {
      saved = Some((current, preview));
    }
    if preview && !was_preview {
      rect.x = current.x - (rect.width as i32 - current.width as i32) / 2;
      rect.y = current.y - (rect.height as i32 - current.height as i32) / 2;
    } else if !preview && was_preview {
      if let Some((base, _)) = saved {
        rect.x = base.x;
        rect.y = base.y;
      }
    } else {
      rect.x = current.x;
      rect.y = current.y;
    }
  } else if let Some((base, _)) = saved {
    rect.x = base.x;
    rect.y = base.y;
  }
  rect.x = rect.x.clamp(
    monitor.x,
    monitor.x + monitor.width.saturating_sub(rect.width) as i32,
  );
  rect.y = rect.y.clamp(
    monitor.y,
    monitor.y + monitor.height.saturating_sub(rect.height) as i32,
  );
  if !preview {
    saved = Some((rect, false));
  } else if let Some((base, _)) = saved {
    saved = Some((base, true));
  }
  *AUTHORING_BOUNDS
    .lock()
    .unwrap_or_else(|error| error.into_inner()) = saved;
  Ok(rect)
}

#[tauri::command]
pub fn destroy_dock_settings_window<R: tauri::Runtime>(
  window: WebviewWindow<R>,
  surface: String,
) -> Result<(), String> {
  if window.label() != "main" {
    return Err("Only main owns Settings presentation.".into());
  }
  validate_settings_surface(&surface)?;
  if let Some(host) = window.app_handle().get_webview_window(&surface) {
    host.destroy().map_err(|error| error.to_string())?;
  }
  Ok(())
}
