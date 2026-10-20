use std::sync::Mutex;

use tauri::{Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::dock::{dock_accessory_rects, DockEdge};
use crate::window_state::{MonitorRect, WindowBounds};

pub const DOCK_HEADER_LABEL: &str = "dock-header";
pub const DOCK_EDITOR_LABEL: &str = "dock-editor";
pub const DOCK_UPDATE_LABEL: &str = "dock-update";

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
  .title("PLVS")
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
  // Subclassing must happen on the thread that owns the window; this command runs elsewhere.
  #[cfg(target_os = "windows")]
  {
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

fn set_rect<R: tauri::Runtime>(
  window: &WebviewWindow<R>,
  rect: WindowBounds,
) -> Result<(), String> {
  #[cfg(target_os = "windows")]
  crate::accessory_pin::pin(window, rect);
  window
    .set_size(tauri::PhysicalSize::new(rect.width, rect.height))
    .map_err(|e| format!("{} size: {e}", window.label()))?;
  window
    .set_position(tauri::PhysicalPosition::new(rect.x, rect.y))
    .map_err(|e| format!("{} position: {e}", window.label()))?;
  Ok(())
}

fn show_or_hide<R: tauri::Runtime>(
  window: &WebviewWindow<R>,
  visible: bool,
  focus_on_show: bool,
) -> Result<(), String> {
  if visible {
    let was_visible = window
      .is_visible()
      .map_err(|e| format!("{} visibility: {e}", window.label()))?;
    window
      .show()
      .map_err(|e| format!("{} show: {e}", window.label()))?;
    if focus_on_show && !was_visible {
      window
        .set_focus()
        .map_err(|e| format!("{} focus: {e}", window.label()))?;
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
  for label in [DOCK_HEADER_LABEL, DOCK_EDITOR_LABEL, DOCK_UPDATE_LABEL] {
    if let Some(window) = app.get_webview_window(label) {
      let _ = window.hide();
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
    show_or_hide(header, header_visible, false)?;
  }
  // Hiding the window that holds focus hands focus to whatever is behind PLVS. The
  // frontend would read that as the user leaving and close the toolbar under them, so
  // the header takes focus first and no other application is activated in between.
  if editor_had_focus && !editor_visible && header_visible {
    if let Some(header) = &header {
      let _ = header.set_focus();
    }
  }
  if let Some(editor) = &editor {
    set_rect(editor, rects.editor)?;
    show_or_hide(editor, editor_visible, true)?;
  }
  Ok(())
}
