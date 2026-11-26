use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

const LABEL: &str = "tray-workbench";
const TRAY_ID: &str = "plvs-main-tray";
const WIDTH: f64 = 410.0;
const HEIGHT: f64 = 420.0;
static LOCATING: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub fn set_tray_workbench_locating(
  app: tauri::AppHandle,
  window: tauri::WebviewWindow,
  active: bool,
) -> Result<(), String> {
  if window.label() != "main" || app.tray_by_id(TRAY_ID).is_none() {
    return Err("Only the Workbench that owns the Tray can control its panel.".into());
  }
  if active {
    LOCATING.store(true, Ordering::Relaxed);
    return Ok(());
  }
  // Locate can focus another Workbench. Return keyboard focus to the still-open menu.
  let result = app.get_webview_window(LABEL).map_or(Ok(()), |panel| {
    if panel.is_visible()? && !panel.is_focused()? {
      panel.set_focus()?;
    }
    Ok::<(), tauri::Error>(())
  });
  LOCATING.store(false, Ordering::Relaxed);
  result.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn open_tray_workbench_panel(
  app: tauri::AppHandle,
  window: tauri::WebviewWindow,
  show: bool,
) -> Result<(), String> {
  if window.label() != "main" {
    return Err("Only the Workbench that owns the Tray can open its panel.".into());
  }

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
    .or_else(|| window.current_monitor().ok().flatten())
    .ok_or("No monitor is available for the Tray Workbench panel.")?;
  // The tray icon already marks the shell edge. The work area includes space reserved by
  // PLVS Dock, which would push an anchored menu away from its icon.
  let (origin, area) = if anchor.is_some() {
    (*monitor.position(), *monitor.size())
  } else {
    let work_area = monitor.work_area();
    (work_area.position, work_area.size)
  };
  let scale = monitor.scale_factor();
  let size = PhysicalSize::new(
    ((WIDTH * scale).round() as u32).min(area.width),
    ((HEIGHT * scale).round() as u32).min(area.height),
  );
  let point = panel_position(origin, area, size, anchor);

  let panel = if let Some(panel) = app.get_webview_window(LABEL) {
    panel
  } else {
    let panel =
      WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::App("tray-workbench.html".into()))
        .title("PLVS — Workbenches")
        .inner_size(WIDTH, HEIGHT)
        .visible(false)
        .decorations(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .build()
        .map_err(|error| error.to_string())?;
    let handle = panel.clone();
    let focused = AtomicBool::new(false);
    panel.on_window_event(move |event| {
      if let tauri::WindowEvent::Focused(is_focused) = event {
        let was_focused = focused.swap(*is_focused, Ordering::Relaxed);
        if was_focused && !is_focused && !LOCATING.load(Ordering::Relaxed) {
          let _ = handle.hide();
        }
      }
    });
    panel
  };
  // Some Linux hosts have no tray rect or global positioning.
  let _ = panel.set_position(point);
  panel.set_size(size).map_err(|error| error.to_string())?;
  if !show {
    return Ok(());
  }
  panel.show().map_err(|error| error.to_string())?;
  panel.set_focus().map_err(|error| error.to_string())
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
    anchor.y - panel_height - 8
  } else {
    anchor.y + icon.height as i32 + 8
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
