use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

#[cfg(windows)]
mod windows_outside_click;

const LABEL: &str = "tray-workbench";
const TRAY_ID: &str = "plvs-main-tray";
const INITIAL_WIDTH: f64 = 320.0;
const INITIAL_HEIGHT: f64 = 32.0;
const ANCHOR_GAP: i32 = 8;
const PICKER_GAP: f64 = 6.0;
static HOLD_FOCUS: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PickerLayout {
  height: f64,
  trigger_top: f64,
}

#[derive(serde::Serialize)]
struct PanelBounds {
  left: f64,
  top: f64,
  width: f64,
  height: f64,
}

#[derive(serde::Serialize)]
pub struct PanelLayout {
  main: PanelBounds,
  side: Option<PanelBounds>,
}

#[derive(Clone, Copy)]
struct PanelRect {
  position: PhysicalPosition<i32>,
  size: PhysicalSize<u32>,
}

impl PanelRect {
  fn right(self) -> i32 {
    self.position.x + self.size.width as i32
  }

  fn bottom(self) -> i32 {
    self.position.y + self.size.height as i32
  }

  fn relative_to(self, origin: PhysicalPosition<i32>) -> Self {
    Self {
      position: PhysicalPosition::new(self.position.x - origin.x, self.position.y - origin.y),
      size: self.size,
    }
  }

  fn logical(self, scale: f64) -> PanelBounds {
    let position = self.position.to_logical::<f64>(scale);
    let size = self.size.to_logical::<f64>(scale);
    PanelBounds {
      left: position.x,
      top: position.y,
      width: size.width,
      height: size.height,
    }
  }
}

#[tauri::command]
pub fn set_tray_workbench_focus_hold(
  app: tauri::AppHandle,
  window: tauri::WebviewWindow,
  active: bool,
) -> Result<(), String> {
  if window.label() != "main" || app.tray_by_id(TRAY_ID).is_none() {
    return Err("Only the Workbench that owns the Tray can control its panel.".into());
  }
  if active {
    HOLD_FOCUS.store(true, Ordering::Relaxed);
    return Ok(());
  }
  // Locate and Show can focus another Workbench. Return focus to the open menu.
  let result = app.get_webview_window(LABEL).map_or(Ok(()), |panel| {
    if panel.is_visible()? && !panel.is_focused()? {
      panel.set_focus()?;
    }
    Ok::<(), tauri::Error>(())
  });
  HOLD_FOCUS.store(false, Ordering::Relaxed);
  result.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn open_tray_workbench_panel(
  app: tauri::AppHandle,
  window: tauri::WebviewWindow,
  clicked_icon: Option<ClickedIcon>,
) -> Result<(), String> {
  let tray = app
    .tray_by_id(TRAY_ID)
    .filter(|_| window.label() == "main")
    .ok_or("Only the Workbench that owns the Tray can open its panel.")?;
  if cfg!(target_os = "linux") {
    return Err("The Linux Tray host owns the Workbench menu.".into());
  }
  #[cfg(target_os = "macos")]
  {
    let geometry = status_item_geometry(&tray, clicked_icon)?;
    *STATUS_ITEM_GEOMETRY.lock().unwrap() = Some(geometry);
  }
  #[cfg(not(target_os = "macos"))]
  let _ = (clicked_icon, tray);
  if app.get_webview_window(LABEL).is_some() {
    return Ok(());
  }

  let panel = WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::App("tray-workbench.html".into()))
    .title("PLVS — Workbenches")
    .inner_size(INITIAL_WIDTH, INITIAL_HEIGHT)
    .visible(false)
    .decorations(false)
    .resizable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .shadow(false);
  #[cfg(any(windows, target_os = "macos"))]
  let panel = panel.transparent(true);
  let panel = panel.build().map_err(|error| error.to_string())?;
  #[cfg(target_os = "macos")]
  install_outside_click_monitor(&panel)?;
  #[cfg(windows)]
  windows_outside_click::install(&panel)?;
  place_panel(
    &app,
    &window,
    &panel,
    INITIAL_WIDTH,
    INITIAL_HEIGHT,
    None,
    None,
  )?;
  let handle = panel.clone();
  let focused = AtomicBool::new(false);
  panel.on_window_event(move |event| {
    if let tauri::WindowEvent::Focused(is_focused) = event {
      let was_focused = focused.swap(*is_focused, Ordering::Relaxed);
      if was_focused && !is_focused && !HOLD_FOCUS.load(Ordering::Relaxed) {
        let _ = handle.hide();
      }
    }
  });
  Ok(())
}

#[tauri::command]
pub fn layout_tray_workbench_panel(
  app: tauri::AppHandle,
  window: tauri::WebviewWindow,
  width: f64,
  height: f64,
  side: Option<PickerLayout>,
  webview_scale: f64,
  show: bool,
) -> Result<PanelLayout, String> {
  if window.label() != LABEL {
    return Err("Only the Tray panel can submit its layout.".into());
  }
  if [width, height, webview_scale]
    .into_iter()
    .any(|value| !value.is_finite() || value <= 0.0)
    || side.is_some_and(|side| {
      !side.height.is_finite() || side.height <= 0.0 || !side.trigger_top.is_finite()
    })
  {
    return Err("Invalid Tray panel dimensions.".into());
  }
  let main = app
    .get_webview_window("main")
    .ok_or("The Tray panel has no owning Workbench.")?;
  let layout = place_panel(
    &app,
    &main,
    &window,
    width,
    height,
    Some(webview_scale),
    side,
  )?;
  if show {
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
  }
  Ok(layout)
}

#[repr(C)]
#[derive(Clone, Copy, Default, serde::Deserialize)]
pub struct ClickedIcon {
  x: f64,
  y: f64,
  width: f64,
  height: f64,
}

#[cfg(target_os = "macos")]
static STATUS_ITEM_GEOMETRY: std::sync::Mutex<Option<StatusItemGeometry>> =
  std::sync::Mutex::new(None);

#[cfg(target_os = "macos")]
#[repr(C)]
#[derive(Clone, Copy, Default)]
struct StatusItemGeometry {
  x: f64,
  y: f64,
  width: f64,
  height: f64,
  screen_x: f64,
  screen_y: f64,
  screen_width: f64,
  screen_height: f64,
  scale: f64,
}

#[cfg(target_os = "macos")]
fn status_item_geometry(
  tray: &tauri::tray::TrayIcon,
  clicked_icon: Option<ClickedIcon>,
) -> Result<StatusItemGeometry, String> {
  extern "C" {
    fn plvs_tray_status_item_geometry(
      status_item: *const std::ffi::c_void,
      clicked_icon: ClickedIcon,
      geometry: *mut StatusItemGeometry,
    ) -> bool;
  }
  tray
    .with_inner_tray_icon(move |icon| {
      let status_item = icon.ns_status_item()?;
      let mut geometry = StatusItemGeometry::default();
      // The retained NSStatusItem stays alive throughout this main-thread call.
      unsafe {
        plvs_tray_status_item_geometry(
          std::ptr::from_ref(&**status_item).cast(),
          clicked_icon.unwrap_or_default(),
          &mut geometry,
        )
      }
      .then_some(geometry)
    })
    .map_err(|error| error.to_string())?
    .ok_or_else(|| "The macOS Tray icon has no screen bounds.".into())
}

#[cfg(target_os = "macos")]
fn install_outside_click_monitor(panel: &tauri::WebviewWindow) -> Result<(), String> {
  extern "C" {
    fn plvs_tray_dismiss_on_outside_click(window: *mut std::ffi::c_void);
  }
  let handle = panel.clone();
  panel
    .run_on_main_thread(move || {
      if let Ok(window) = handle.ns_window() {
        // The retained WebviewWindow owns the NSWindow on this thread.
        unsafe { plvs_tray_dismiss_on_outside_click(window) };
      }
    })
    .map_err(|error| error.to_string())
}

fn place_panel(
  app: &tauri::AppHandle,
  _main: &tauri::WebviewWindow,
  panel: &tauri::WebviewWindow,
  width: f64,
  height: f64,
  webview_scale: Option<f64>,
  side: Option<PickerLayout>,
) -> Result<PanelLayout, String> {
  #[cfg(target_os = "macos")]
  let (origin, area, anchor, monitor_scale) = {
    let geometry = STATUS_ITEM_GEOMETRY
      .lock()
      .unwrap()
      .ok_or("The macOS Tray menu has no opening anchor.")?;
    let scale = geometry.scale;
    let position = |x, y| tauri::LogicalPosition::new(x, y).to_physical::<i32>(scale);
    let size = |width, height| tauri::LogicalSize::new(width, height).to_physical::<u32>(scale);
    (
      position(geometry.screen_x, geometry.screen_y),
      size(geometry.screen_width, geometry.screen_height),
      Some((
        position(geometry.x, geometry.y),
        size(geometry.width, geometry.height),
      )),
      scale,
    )
  };
  #[cfg(not(target_os = "macos"))]
  let (origin, area, anchor, monitor_scale) = {
    let tray = app
      .tray_by_id(TRAY_ID)
      .ok_or("The Workbench does not own the Tray.")?;
    let anchor = tray.rect().ok().flatten().map(|rect| {
      (
        rect.position.to_physical::<i32>(1.0),
        rect.size.to_physical::<u32>(1.0),
      )
    });
    let monitor = anchor
      .and_then(|(point, size)| {
        app
          .monitor_from_point(
            f64::from(point.x) + f64::from(size.width) / 2.0,
            f64::from(point.y) + f64::from(size.height) / 2.0,
          )
          .ok()
          .flatten()
      })
      .or_else(|| _main.current_monitor().ok().flatten())
      .ok_or("No monitor is available for the Tray Workbench panel.")?;
    // The tray icon already marks the shell edge. The work area includes space reserved by
    // PLVS Dock, which would push an anchored menu away from its icon.
    let (origin, area) = if anchor.is_some() {
      (*monitor.position(), *monitor.size())
    } else {
      let work_area = monitor.work_area();
      (work_area.position, work_area.size)
    };
    (origin, area, anchor, monitor.scale_factor())
  };
  // WKWebView follows the backing scale. A reused window may still report the previous
  // screen's ratio when it starts moving to the clicked status item.
  #[cfg(target_os = "macos")]
  let scale = {
    let _ = (app, webview_scale);
    monitor_scale
  };
  #[cfg(not(target_os = "macos"))]
  let scale = webview_scale.unwrap_or(monitor_scale);
  let bounds = panel_work_area(origin, area, anchor);
  let size = PhysicalSize::new(
    ((width * scale).ceil() as u32).clamp(1, area.width),
    ((height * scale).ceil() as u32).clamp(1, bounds.size.height),
  );
  let main = PanelRect {
    position: panel_position(origin, area, size, anchor),
    size,
  };
  let side = side.and_then(|side| picker_rect(bounds, main, side, scale));
  let (point, size) = side.map_or((main.position, main.size), |side| {
    let x = main.position.x.min(side.position.x);
    let y = main.position.y.min(side.position.y);
    (
      PhysicalPosition::new(x, y),
      PhysicalSize::new(
        (main.right().max(side.right()) - x) as u32,
        (main.bottom().max(side.bottom()) - y) as u32,
      ),
    )
  });
  // AppKit uses the existing window's scale to convert physical setters. Supply points
  // based on the destination screen so a status item on a different display stays anchored.
  #[cfg(target_os = "macos")]
  let (window_point, window_size) = (
    point.to_logical::<f64>(monitor_scale),
    size.to_logical::<f64>(monitor_scale),
  );
  #[cfg(not(target_os = "macos"))]
  let (window_point, window_size) = (point, size);
  panel
    .set_position(window_point)
    .map_err(|error| error.to_string())?;
  panel
    .set_size(window_size)
    .map_err(|error| error.to_string())?;
  let main = main.relative_to(point);
  let side = side.map(|side| side.relative_to(point));
  #[cfg(windows)]
  clip_panel_window(panel, main, side)?;
  Ok(PanelLayout {
    main: main.logical(scale),
    side: side.map(|side| side.logical(scale)),
  })
}

fn panel_work_area(
  origin: PhysicalPosition<i32>,
  area: PhysicalSize<u32>,
  anchor: Option<(PhysicalPosition<i32>, PhysicalSize<u32>)>,
) -> PanelRect {
  let bottom = origin.y + area.height as i32;
  let (top, end) = match anchor {
    Some((point, _)) if point.y >= origin.y + area.height as i32 / 2 => {
      (origin.y, (point.y - ANCHOR_GAP).clamp(origin.y + 1, bottom))
    }
    Some((point, icon)) => (
      (point.y + icon.height as i32 + ANCHOR_GAP).clamp(origin.y, bottom - 1),
      bottom,
    ),
    None => (origin.y, bottom),
  };
  PanelRect {
    position: PhysicalPosition::new(origin.x, top),
    size: PhysicalSize::new(area.width, (end - top) as u32),
  }
}

fn picker_rect(
  bounds: PanelRect,
  main: PanelRect,
  picker: PickerLayout,
  scale: f64,
) -> Option<PanelRect> {
  let gap = (PICKER_GAP * scale).round() as i32;
  let left_space = main.position.x - bounds.position.x - gap;
  let right_space = bounds.right() - main.right() - gap;
  let preferred = main.size.width as i32;
  let right = right_space >= preferred || right_space >= left_space;
  let available = if right { right_space } else { left_space };
  let height = ((picker.height * scale).ceil() as u32).clamp(1, bounds.size.height);
  if available < preferred / 2 {
    let above = main.position.y - bounds.position.y - gap;
    let below = bounds.bottom() - main.bottom() - gap;
    let room = above.max(below);
    if room > 0 {
      let height = height.min(room as u32);
      return Some(PanelRect {
        position: PhysicalPosition::new(
          main.position.x,
          if above > below {
            main.position.y - gap - height as i32
          } else {
            main.bottom() + gap
          },
        ),
        size: PhysicalSize::new(main.size.width, height),
      });
    }
  }
  if available <= 0 {
    return None;
  }
  let width = preferred.min(available);
  let trigger_top = (picker.trigger_top * scale)
    .round()
    .clamp(0.0, f64::from(main.size.height)) as i32;
  Some(PanelRect {
    position: PhysicalPosition::new(
      if right {
        main.right() + gap
      } else {
        main.position.x - gap - width
      },
      (main.position.y + trigger_top).clamp(bounds.position.y, bounds.bottom() - height as i32),
    ),
    size: PhysicalSize::new(width as u32, height),
  })
}

#[cfg(windows)]
fn clip_panel_window(
  panel: &tauri::WebviewWindow,
  main: PanelRect,
  side: Option<PanelRect>,
) -> Result<(), String> {
  use windows_sys::Win32::Graphics::Gdi::{
    CombineRgn, CreateRectRgn, DeleteObject, SetWindowRgn, RGN_OR,
  };

  let hwnd = panel.hwnd().map_err(|error| error.to_string())?.0;
  // The use of one WebView must not make the gap or the area beside a shorter menu capture clicks.
  // Windows owns the combined region after a successful SetWindowRgn call.
  unsafe {
    let region = CreateRectRgn(
      main.position.x,
      main.position.y,
      main.right(),
      main.bottom(),
    );
    if region.is_null() {
      return Err("Unable to create the Tray window region.".into());
    }
    if let Some(side) = side {
      let part = CreateRectRgn(
        side.position.x,
        side.position.y,
        side.right(),
        side.bottom(),
      );
      if part.is_null() {
        let _ = DeleteObject(region);
        return Err("Unable to create the Tray picker region.".into());
      }
      let combined = CombineRgn(region, region, part, RGN_OR);
      let _ = DeleteObject(part);
      if combined == 0 {
        let _ = DeleteObject(region);
        return Err("Unable to combine the Tray menu regions.".into());
      }
    }
    if SetWindowRgn(hwnd, region, 1) == 0 {
      let _ = DeleteObject(region);
      return Err("Unable to apply the Tray window region.".into());
    }
  }
  Ok(())
}

fn panel_position(
  origin: PhysicalPosition<i32>,
  area: PhysicalSize<u32>,
  panel: PhysicalSize<u32>,
  anchor: Option<(PhysicalPosition<i32>, PhysicalSize<u32>)>,
) -> PhysicalPosition<i32> {
  let right = origin.x + area.width as i32;
  let bottom = origin.y + area.height as i32;
  let panel_width = panel.width as i32;
  let panel_height = panel.height as i32;
  let Some((anchor, icon)) = anchor else {
    return PhysicalPosition::new(
      origin.x + (area.width as i32 - panel_width) / 2,
      origin.y + (area.height as i32 - panel_height) / 2,
    );
  };
  let desired_y = if anchor.y >= origin.y + area.height as i32 / 2 {
    anchor.y - panel_height - ANCHOR_GAP
  } else {
    anchor.y + icon.height as i32 + ANCHOR_GAP
  };
  PhysicalPosition::new(
    (anchor.x + (icon.width as i32 - panel_width) / 2).clamp(origin.x, right - panel_width),
    desired_y.clamp(origin.y, bottom - panel_height),
  )
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn picker_stays_next_to_its_trigger_and_flips_inside_the_tray_edge() {
    let bounds = PanelRect {
      position: PhysicalPosition::new(-1600, 0),
      size: PhysicalSize::new(1600, 920),
    };
    let mut main = PanelRect {
      position: PhysicalPosition::new(-1540, 500),
      size: PhysicalSize::new(400, 420),
    };
    let spec = PickerLayout {
      height: 256.0,
      trigger_top: 160.0,
    };
    let right = picker_rect(bounds, main, spec, 1.25).unwrap();
    assert_eq!(right.position, PhysicalPosition::new(-1132, 600));
    assert_eq!(right.size, PhysicalSize::new(400, 320));
    main.position.x = -400;
    let left = picker_rect(bounds, main, spec, 1.25).unwrap();
    assert_eq!(left.position, PhysicalPosition::new(-808, 600));
    assert_eq!(left.bottom(), bounds.bottom());
  }

  #[test]
  fn picker_uses_vertical_space_when_the_display_is_too_narrow() {
    let bounds = PanelRect {
      position: PhysicalPosition::new(0, 0),
      size: PhysicalSize::new(420, 860),
    };
    let main = PanelRect {
      position: PhysicalPosition::new(18, 460),
      size: PhysicalSize::new(400, 400),
    };
    let picker = picker_rect(
      bounds,
      main,
      PickerLayout {
        height: 200.0,
        trigger_top: 130.0,
      },
      1.0,
    )
    .unwrap();
    assert_eq!(picker.position, PhysicalPosition::new(18, 254));
    assert_eq!(picker.size.width, 400);
  }

  #[test]
  fn tray_anchor_uses_monitor_edges_and_fallback_centers_in_available_area() {
    let origin = PhysicalPosition::new(-1920, 0);
    let area = PhysicalSize::new(1920, 1040);
    let panel = PhysicalSize::new(410, 420);
    let icon = PhysicalSize::new(24, 24);

    assert_eq!(
      panel_position(
        origin,
        area,
        panel,
        Some((PhysicalPosition::new(-50, 1048), icon))
      ),
      PhysicalPosition::new(-410, 620)
    );
    assert_eq!(
      panel_position(
        origin,
        area,
        panel,
        Some((PhysicalPosition::new(-1910, -14), icon))
      ),
      PhysicalPosition::new(-1920, 18)
    );
    assert_eq!(
      panel_position(origin, area, panel, None),
      PhysicalPosition::new(-1165, 310)
    );
  }

  #[test]
  fn anchored_menu_extends_into_plvs_docks_reserved_area() {
    let monitor = PhysicalSize::new(1920, 1080);
    let panel = PhysicalSize::new(410, 420);
    let icon = (PhysicalPosition::new(1810, 1048), PhysicalSize::new(24, 24));
    let below_reserved_work_area = 840;
    let point = panel_position(PhysicalPosition::new(0, 0), monitor, panel, Some(icon));

    assert_eq!(point.y + panel.height as i32, icon.0.y - 8);
    assert!(point.y + panel.height as i32 > below_reserved_work_area);
  }
}
