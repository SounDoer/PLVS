//! X11/EWMH Dock support, including XWayland inside a Wayland desktop.
//! All GTK/GDK access stays on the UI thread. Native Wayland is deliberately refused.
use std::sync::{mpsc, Mutex, OnceLock};

use gtk::{gdk, prelude::*};
use tauri::{Emitter, Manager, WebviewWindow};

use crate::dock::{DockEdge, DockReservationLease};
use crate::window_state::{MonitorRect, WindowBounds};

static SUPPORTED: OnceLock<bool> = OnceLock::new();
static PRESENTATION: Mutex<Option<Presentation>> = Mutex::new(None);

#[derive(Clone, Copy)]
struct Presentation {
  monitor: MonitorRect,
  work_area: MonitorRect,
}

/// Called from setup after GTK initialization, before the boot snapshot is made.
pub fn initialize() {
  SUPPORTED.get_or_init(|| {
    let Some(display) = gdk::Display::default() else {
      return false;
    };
    if !display.type_().name().contains("X11") {
      return false;
    }
    let Some(root) = display.default_screen().root_window() else {
      return false;
    };
    let Some((_, 32, bytes)) = gdk::property_get(
      &root,
      &gdk::Atom::intern("_NET_SUPPORTED"),
      &gdk::SELECTION_TYPE_ATOM,
      0,
      4096,
      0,
    ) else {
      return false;
    };
    // GDK translates X atoms into native-width GdkAtoms, including on LP64.
    [
      "_NET_WM_WINDOW_TYPE_DOCK",
      "_NET_WM_STRUT_PARTIAL",
      "_NET_WM_STATE_ABOVE",
    ]
    .iter()
    .all(|name| {
      let atom = gdk::Atom::intern(name).value();
      bytes
        .as_chunks::<{ std::mem::size_of::<usize>() }>()
        .0
        .iter()
        .any(|word| usize::from_ne_bytes(*word) == atom)
    })
  });
}

pub fn supported() -> bool {
  SUPPORTED.get().copied().unwrap_or(false)
}

fn on_main<R: tauri::Runtime, T: Send + 'static>(
  window: &WebviewWindow<R>,
  operation: impl FnOnce(WebviewWindow<R>) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
  let (send, receive) = mpsc::sync_channel(1);
  let target = window.clone();
  window
    .run_on_main_thread(move || {
      let _ = send.send(operation(target));
    })
    .map_err(|error| error.to_string())?;
  receive.recv().map_err(|error| error.to_string())?
}

fn physical(rect: gdk::Rectangle, scale: i32) -> MonitorRect {
  MonitorRect {
    x: rect.x() * scale,
    y: rect.y() * scale,
    width: (rect.width() * scale) as u32,
    height: (rect.height() * scale) as u32,
  }
}

pub fn work_area<R: tauri::Runtime>(
  window: &WebviewWindow<R>,
  name: Option<&str>,
) -> Result<(MonitorRect, f64, Option<String>), String> {
  let name = name.map(str::to_owned);
  on_main(window, move |window| {
    let gtk = window.gtk_window().map_err(|error| error.to_string())?;
    let display = gtk.display();
    let monitor = (0..display.n_monitors())
      .filter_map(|i| display.monitor(i))
      .find(|monitor| {
        name
          .as_deref()
          .is_some_and(|name| monitor.model().as_deref() == Some(name))
      })
      .or_else(|| {
        gtk
          .window()
          .and_then(|native| display.monitor_at_window(&native))
      })
      .or_else(|| display.primary_monitor())
      .ok_or("No Dock display available.")?;
    let scale = monitor.scale_factor();
    let geometry = physical(monitor.geometry(), scale);
    // While our strut is active, querying the reduced work area would progressively shrink
    // and move the strip on each resize. Retain the pre-reservation area on this display.
    let area = PRESENTATION
      .lock()
      .unwrap_or_else(|e| e.into_inner())
      .as_ref()
      .filter(|saved| same_rect(saved.monitor, geometry))
      .map(|saved| saved.work_area)
      .unwrap_or_else(|| physical(monitor.workarea(), scale));
    Ok((
      area,
      f64::from(scale),
      monitor.model().map(|name| name.to_string()),
    ))
  })
}

fn same_rect(a: MonitorRect, b: MonitorRect) -> bool {
  (a.x, a.y, a.width, a.height) == (b.x, b.y, b.width, b.height)
}

/// EWMH distances are measured from the root screen, not the monitor or work area.
fn strut(
  area: MonitorRect,
  edge: DockEdge,
  height: u32,
  root_height: u32,
) -> Result<[libc::c_ulong; 12], String> {
  if area.x < 0 || area.y < 0 || area.width == 0 || height > area.height {
    return Err("The display geometry cannot reserve Dock space.".into());
  }
  let mut values = [0; 12];
  let (start, end) = match edge {
    DockEdge::Top => {
      values[2] = area.y as u32 + height;
      (8, 9)
    }
    DockEdge::Bottom => {
      values[3] = root_height.saturating_sub(area.y as u32 + area.height - height);
      (10, 11)
    }
  };
  values[start] = area.x as u32;
  values[end] = area.x as u32 + area.width - 1;
  Ok(values.map(libc::c_ulong::from))
}

pub fn configure<R: tauri::Runtime>(
  window: &WebviewWindow<R>,
  edge: DockEdge,
  height: u32,
  reserve: bool,
  monitor_name: Option<&str>,
) -> Result<bool, String> {
  if !supported() {
    return Err("Dock requires an X11 or XWayland window backend with EWMH support.".into());
  }
  let (area, scale, name) = work_area(window, monitor_name)?;
  let root = window
    .app_handle()
    .state::<crate::persistence::commands::PersistenceRuntime>()
    .identity_root()?;
  let lease = window.app_handle().state::<DockReservationLease>();
  let reserved = reserve && lease.acquire(&root, name.as_deref().unwrap_or("primary"), edge)?;
  if !reserved {
    lease.release();
  }
  let result = on_main(window, move |window| {
    let gtk = window.gtk_window().map_err(|error| error.to_string())?;
    let display = gtk.display();
    gtk.realize();
    let native = gtk.window().ok_or("Dock native window is unavailable.")?;
    let monitor = display
      .monitor_at_window(&native)
      .ok_or("Dock display is unavailable.")?;
    // Select by requested model before a queued move has reached the compositor.
    let monitor = (0..display.n_monitors())
      .filter_map(|i| display.monitor(i))
      .find(|m| {
        name
          .as_deref()
          .is_some_and(|name| m.model().as_deref() == Some(name))
      })
      .unwrap_or(monitor);
    let geometry = physical(monitor.geometry(), monitor.scale_factor());
    let root = display
      .default_screen()
      .root_window()
      .ok_or("X11 root is unavailable.")?;
    let root_height = (root.height() * root.scale_factor()) as u32;
    let physical_height = (f64::from(height) * scale).round() as u32;
    if reserved
      && match edge {
        DockEdge::Top => geometry.y != 0,
        DockEdge::Bottom => geometry.y + geometry.height as i32 != root_height as i32,
      }
    {
      return Err("Reserve Space requires an outer top or bottom display edge on X11.".into());
    }
    let values = if reserved {
      strut(area, edge, physical_height, root_height)?
    } else {
      [0; 12]
    };
    gtk.set_type_hint(gdk::WindowTypeHint::Dock);
    gtk.set_keep_above(true);
    place_strip(&gtk, area, edge, height, scale);
    *PRESENTATION.lock().unwrap_or_else(|e| e.into_inner()) = Some(Presentation {
      monitor: geometry,
      work_area: area,
    });
    gdk::property_change(
      &native,
      &gdk::Atom::intern("_NET_WM_STRUT_PARTIAL"),
      &gdk::Atom::intern("CARDINAL"),
      32,
      gdk::PropMode::Replace,
      gdk::ChangeData::ULongs(&values),
    );
    display.flush();
    Ok(reserved)
  });
  if result.is_err() {
    lease.release();
  }
  result
}

/// Remove reservation before hiding/restoring the strip; a crashed X client releases it in the WM.
pub fn clear<R: tauri::Runtime>(window: &WebviewWindow<R>, restore: bool) -> Result<(), String> {
  if !supported() {
    return Ok(());
  }
  on_main(window, move |window| {
    let gtk = window.gtk_window().map_err(|error| error.to_string())?;
    if let Some(native) = gtk.window() {
      gdk::property_delete(&native, &gdk::Atom::intern("_NET_WM_STRUT_PARTIAL"));
      gtk.display().flush();
    }
    if restore {
      gtk.set_type_hint(gdk::WindowTypeHint::Normal);
      gtk.set_geometry_hints(None::<&gtk::Widget>, None, gdk::WindowHints::empty());
    }
    if restore {
      *PRESENTATION.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }
    Ok(())
  })?;
  window
    .app_handle()
    .state::<DockReservationLease>()
    .release();
  Ok(())
}

pub fn prepare_accessory<R: tauri::Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
  if !supported() {
    return Ok(());
  }
  on_main(window, move |window| {
    let gtk = window.gtk_window().map_err(|error| error.to_string())?;
    gtk.set_type_hint(gdk::WindowTypeHint::Dock);
    // Tao's initially unfocused GTK windows also start with accept-focus=false. Editors must
    // accept later keyboard focus without stealing it merely because a hidden host was built.
    gtk.set_accept_focus(true);
    gtk.set_focus_on_map(false);
    Ok(())
  })
}

fn lock_size(window: &gtk::ApplicationWindow, width: i32, height: i32) {
  // GtkWindow::set_resizable(false) uses WebKit's natural height (at least 200 px, or the
  // previous default size) as a minimum. Explicit min/max hints allow a real 36 px toolbar.
  let geometry = gdk::Geometry::new(
    width,
    height,
    width,
    height,
    0,
    0,
    1,
    1,
    0.0,
    0.0,
    gdk::Gravity::NorthWest,
  );
  window.set_geometry_hints(
    None::<&gtk::Widget>,
    Some(&geometry),
    gdk::WindowHints::MIN_SIZE | gdk::WindowHints::MAX_SIZE,
  );
  window.set_default_size(width, height);
  window.resize(width, height);
}

fn place_strip(
  window: &gtk::ApplicationWindow,
  area: MonitorRect,
  edge: DockEdge,
  height: u32,
  scale: f64,
) {
  lock_size(
    window,
    (f64::from(area.width) / scale).round() as i32,
    height as i32,
  );
  let y = match edge {
    DockEdge::Top => area.y,
    DockEdge::Bottom => area.y + area.height as i32 - (f64::from(height) * scale).round() as i32,
  };
  window.move_(
    (f64::from(area.x) / scale).round() as i32,
    (f64::from(y) / scale).round() as i32,
  );
}

/// Drag previews update fixed GTK geometry without reflowing maximized applications on every move.
pub fn preview_height<R: tauri::Runtime>(
  window: &WebviewWindow<R>,
  edge: DockEdge,
  height: u32,
  monitor: Option<&str>,
) -> Result<(), String> {
  let (area, scale, _) = work_area(window, monitor)?;
  on_main(window, move |window| {
    let gtk = window.gtk_window().map_err(|error| error.to_string())?;
    place_strip(&gtk, area, edge, height, scale);
    Ok(())
  })
}

pub fn position_accessory<R: tauri::Runtime>(
  window: &WebviewWindow<R>,
  rect: WindowBounds,
) -> Result<(), String> {
  if !supported() {
    return Ok(());
  }
  on_main(window, move |window| {
    let gtk = window.gtk_window().map_err(|error| error.to_string())?;
    let scale = f64::from(gtk.scale_factor());
    lock_size(
      &gtk,
      (f64::from(rect.width) / scale).round() as i32,
      (f64::from(rect.height) / scale).round() as i32,
    );
    gtk.move_(
      (f64::from(rect.x) / scale).round() as i32,
      (f64::from(rect.y) / scale).round() as i32,
    );
    Ok(())
  })
}

/// Geometry/scale changes are rare. Reconcile after GDK has processed the display change and
/// the WM has removed our old root-coordinate strut, rather than reserving stale monitor pixels.
pub fn watch<R: tauri::Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
  if !supported() {
    return Ok(());
  }
  on_main(window, move |window| {
    let display = window.gtk_window().map_err(|e| e.to_string())?.display();
    let pending = std::rc::Rc::new(std::cell::Cell::new(false));
    for monitor in (0..display.n_monitors()).filter_map(|i| display.monitor(i)) {
      watch_monitor(&monitor, &window, &pending);
    }
    let owner = window.clone();
    let queued = pending.clone();
    display.connect_monitor_added(move |_, monitor| {
      watch_monitor(monitor, &owner, &queued);
      queue_refresh(&owner, &queued);
    });
    display.connect_monitor_removed(move |_, _| queue_refresh(&window, &pending));
    Ok(())
  })
}

fn watch_monitor<R: tauri::Runtime>(
  monitor: &gdk::Monitor,
  window: &WebviewWindow<R>,
  pending: &std::rc::Rc<std::cell::Cell<bool>>,
) {
  let owner = window.clone();
  let queued = pending.clone();
  monitor.connect_geometry_notify(move |_| queue_refresh(&owner, &queued));
  let owner = window.clone();
  let queued = pending.clone();
  monitor.connect_scale_factor_notify(move |_| queue_refresh(&owner, &queued));
}

fn active<R: tauri::Runtime>(window: &WebviewWindow<R>) -> bool {
  window
    .state::<crate::dock::DockedFlag>()
    .0
    .load(std::sync::atomic::Ordering::Relaxed)
    && window.is_visible().unwrap_or(false)
}

fn queue_refresh<R: tauri::Runtime>(
  window: &WebviewWindow<R>,
  pending: &std::rc::Rc<std::cell::Cell<bool>>,
) {
  if !active(window) || pending.replace(true) {
    return;
  }
  let owner = window.clone();
  let queued = pending.clone();
  gtk::glib::idle_add_local_once(move || {
    if !active(&owner) {
      queued.set(false);
      return;
    }
    let _ = clear(&owner, false);
    *PRESENTATION.lock().unwrap_or_else(|e| e.into_inner()) = None;
    gtk::glib::timeout_add_local_once(std::time::Duration::from_millis(150), move || {
      queued.set(false);
      if !active(&owner) {
        return;
      }
      let result = (|| -> Result<(), String> {
        let mut state =
          crate::dock::read_dock_state(owner.app_handle()).ok_or("Dock state unavailable.")?;
        state.height = crate::dock::fitted_height(&owner, state.monitor.as_deref(), state.height)?;
        state.monitor = crate::dock::apply_dock_form(
          &owner,
          state.edge,
          state.monitor.as_deref(),
          state.height,
          false,
        )?;
        // A display moved onto an interior edge still gets a usable overlay.
        state.reserve_space = configure(
          &owner,
          state.edge,
          state.height,
          state.reserve_space,
          state.monitor.as_deref(),
        )
        .unwrap_or(false);
        if !state.reserve_space {
          configure(
            &owner,
            state.edge,
            state.height,
            false,
            state.monitor.as_deref(),
          )?;
        }
        crate::dock::write_dock_state(owner.app_handle(), &state);
        owner
          .emit("dock-native-geometry-changed", ())
          .map_err(|e| e.to_string())
      })();
      if let Err(error) = result {
        log::warn!("Linux Dock display reconciliation failed: {error}");
      }
    });
  });
}

#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn struts_include_existing_desktop_panels_and_limit_the_horizontal_range() {
    let area = MonitorRect {
      x: 66,
      y: 40,
      width: 1854,
      height: 1040,
    };
    let top = strut(area, DockEdge::Top, 90, 1080).unwrap();
    assert_eq!((top[2], top[8], top[9]), (130, 66, 1919));
    let bottom = strut(area, DockEdge::Bottom, 90, 1080).unwrap();
    assert_eq!((bottom[3], bottom[10], bottom[11]), (90, 66, 1919));
  }
  #[test]
  fn struts_use_root_coordinates_on_a_second_display() {
    let area = MonitorRect {
      x: 1920,
      y: 40,
      width: 1920,
      height: 1040,
    };
    let bottom = strut(area, DockEdge::Bottom, 180, 1080).unwrap();
    assert_eq!((bottom[3], bottom[10], bottom[11]), (180, 1920, 3839));
    assert!(strut(area, DockEdge::Top, 2000, 1080).is_err());
  }
}
