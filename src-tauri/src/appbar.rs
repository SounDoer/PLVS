use std::mem::size_of;
use std::sync::{Mutex, OnceLock};

use tauri::WebviewWindow;
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows_sys::Win32::Graphics::Gdi::{
  GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
use windows_sys::Win32::UI::Shell::{
  DefSubclassProc, RemoveWindowSubclass, SHAppBarMessage, SetWindowSubclass, ABE_BOTTOM, ABE_TOP,
  ABM_NEW, ABM_REMOVE, ABM_SETPOS, ABM_WINDOWPOSCHANGED, ABN_POSCHANGED, APPBARDATA,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
  MoveWindow, SWP_NOMOVE, SWP_NOSIZE, WINDOWPOS, WM_APP, WM_NCDESTROY, WM_WINDOWPOSCHANGED,
  WM_WINDOWPOSCHANGING,
};

use crate::dock::{DockEdge, DOCK_STRIP_LOGICAL_HEIGHT};
use crate::window_state::MonitorRect;

const APPBAR_CALLBACK_MESSAGE: u32 = WM_APP + 0x31;
const APPBAR_SUBCLASS_ID: usize = 0x504c5653;

#[derive(Clone, Copy)]
struct AppBarState {
  hwnd: isize,
  edge: DockEdge,
  height: i32,
  registered: bool,
  positioning: bool,
  transitioning: bool,
}

impl AppBarState {
  fn requested_position(&self, hwnd: isize) -> Option<(DockEdge, i32)> {
    (self.registered && !self.positioning && !self.transitioning && self.hwnd == hwnd)
      .then_some((self.edge, self.height))
  }

  fn should_notify_window_position_changed(&self, hwnd: isize) -> bool {
    self.registered && !self.positioning && !self.transitioning && self.hwnd == hwnd
  }
}

static STATE: OnceLock<Mutex<AppBarState>> = OnceLock::new();
static TRANSITION_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn state() -> &'static Mutex<AppBarState> {
  STATE.get_or_init(|| {
    Mutex::new(AppBarState {
      hwnd: 0,
      edge: DockEdge::Bottom,
      height: 72,
      registered: false,
      positioning: false,
      transitioning: false,
    })
  })
}

fn transition_lock() -> &'static Mutex<()> {
  TRANSITION_LOCK.get_or_init(|| Mutex::new(()))
}

fn appbar_data(hwnd: HWND) -> APPBARDATA {
  APPBARDATA {
    cbSize: size_of::<APPBARDATA>() as u32,
    hWnd: hwnd,
    uCallbackMessage: APPBAR_CALLBACK_MESSAGE,
    uEdge: 0,
    rc: RECT::default(),
    lParam: 0,
  }
}

fn constrain_to_edge(rect: &mut RECT, edge: DockEdge, height: i32) {
  let height = height.max(1);
  match edge {
    DockEdge::Top => rect.bottom = rect.top + height,
    DockEdge::Bottom => rect.top = rect.bottom - height,
  }
}

fn work_area_without_self(mut work_area: RECT, edge: DockEdge, height: i32) -> RECT {
  let height = height.max(1);
  match edge {
    DockEdge::Top => work_area.top -= height,
    DockEdge::Bottom => work_area.bottom += height,
  }
  work_area
}

fn appbar_rect_from_work_area(
  work_area: RECT,
  edge: DockEdge,
  height: i32,
  includes_self: bool,
) -> RECT {
  let mut rect = if includes_self {
    work_area_without_self(work_area, edge, height)
  } else {
    work_area
  };
  constrain_to_edge(&mut rect, edge, height);
  rect
}

fn enforce_window_position(position: &mut WINDOWPOS, rect: RECT) {
  position.x = rect.left;
  position.y = rect.top;
  position.cx = rect.right - rect.left;
  position.cy = rect.bottom - rect.top;
  position.flags &= !(SWP_NOMOVE | SWP_NOSIZE);
}

unsafe fn monitor_work_area(hwnd: HWND) -> Result<RECT, String> {
  let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
  let mut info = MONITORINFO {
    cbSize: size_of::<MONITORINFO>() as u32,
    rcMonitor: RECT::default(),
    rcWork: RECT::default(),
    dwFlags: 0,
  };
  if monitor.is_null() || GetMonitorInfoW(monitor, &mut info) == 0 {
    return Err("unable to resolve appbar monitor".into());
  }
  Ok(info.rcWork)
}

unsafe fn position(
  hwnd: HWND,
  edge: DockEdge,
  height: i32,
  work_area: RECT,
  includes_self: bool,
) -> Result<(), String> {
  let mut data = appbar_data(hwnd);
  data.uEdge = match edge {
    DockEdge::Top => ABE_TOP,
    DockEdge::Bottom => ABE_BOTTOM,
  };
  data.rc = appbar_rect_from_work_area(work_area, edge, height, includes_self);
  SHAppBarMessage(ABM_SETPOS, &mut data);
  move_window(hwnd, data.rc, "appbar")?;
  Ok(())
}

unsafe fn move_window(hwnd: HWND, rect: RECT, context: &str) -> Result<(), String> {
  if MoveWindow(
    hwnd,
    rect.left,
    rect.top,
    rect.right - rect.left,
    rect.bottom - rect.top,
    1,
  ) == 0
  {
    return Err(format!("MoveWindow failed while positioning {context}"));
  }
  Ok(())
}

fn move_overlay(hwnd: HWND, edge: DockEdge, height: i32, work_area: RECT) -> Result<(), String> {
  {
    let mut current = state().lock().map_err(|_| "appbar state poisoned")?;
    if current.positioning {
      return Ok(());
    }
    current.positioning = true;
  }
  let rect = appbar_rect_from_work_area(work_area, edge, height, false);
  let result = unsafe { move_window(hwnd, rect, "dock overlay") };
  if let Ok(mut current) = state().lock() {
    current.positioning = false;
  }
  result
}

pub fn position_overlay<R: tauri::Runtime>(
  window: &WebviewWindow<R>,
  edge: DockEdge,
  work_area: MonitorRect,
  scale: f64,
) -> Result<(), String> {
  let _transition = transition_lock()
    .lock()
    .map_err(|_| "appbar transition lock poisoned")?;
  let hwnd = window.hwnd().map_err(|e| format!("hwnd: {e}"))?.0;
  let height = (DOCK_STRIP_LOGICAL_HEIGHT * scale).round() as i32;
  move_overlay(
    hwnd,
    edge,
    height.max(1),
    RECT {
      left: work_area.x,
      top: work_area.y,
      right: work_area.x + work_area.width as i32,
      bottom: work_area.y + work_area.height as i32,
    },
  )
}

fn reposition(
  hwnd: HWND,
  edge: DockEdge,
  height: i32,
  initial_work_area: Option<RECT>,
) -> Result<(), String> {
  {
    let mut current = state().lock().map_err(|_| "appbar state poisoned")?;
    if current.positioning {
      return Ok(());
    }
    current.positioning = true;
  }
  let result = unsafe {
    match initial_work_area {
      Some(work_area) => position(hwnd, edge, height, work_area, false),
      None => {
        monitor_work_area(hwnd).and_then(|work_area| position(hwnd, edge, height, work_area, true))
      }
    }
  };
  if let Ok(mut current) = state().lock() {
    current.positioning = false;
  }
  result
}

unsafe extern "system" fn subclass_proc(
  hwnd: HWND,
  msg: u32,
  wparam: WPARAM,
  lparam: LPARAM,
  _id: usize,
  _ref_data: usize,
) -> LRESULT {
  if msg == APPBAR_CALLBACK_MESSAGE && wparam as u32 == ABN_POSCHANGED {
    let requested = state()
      .lock()
      .ok()
      .and_then(|current| current.requested_position(hwnd as isize));
    if let Some((edge, height)) = requested {
      let _ = reposition(hwnd, edge, height, None);
    }
    return 0;
  }
  if msg == WM_WINDOWPOSCHANGING {
    let requested = state()
      .lock()
      .ok()
      .and_then(|current| current.requested_position(hwnd as isize));
    if let Some((edge, height)) = requested {
      if let Ok(work_area) = monitor_work_area(hwnd) {
        let rect = appbar_rect_from_work_area(work_area, edge, height, true);
        if let Some(position) = (lparam as *mut WINDOWPOS).as_mut() {
          enforce_window_position(position, rect);
        }
      }
    }
  }
  if msg == WM_WINDOWPOSCHANGED {
    // MoveWindow sends this synchronously while repositioning. Reporting that
    // internal move back to Shell can enqueue a self-induced ABN_POSCHANGED.
    let should_notify = state()
      .lock()
      .map(|current| current.should_notify_window_position_changed(hwnd as isize))
      .unwrap_or(false);
    if should_notify {
      let mut data = appbar_data(hwnd);
      SHAppBarMessage(ABM_WINDOWPOSCHANGED, &mut data);
    }
  } else if msg == WM_NCDESTROY {
    let registered = state()
      .lock()
      .map(|mut current| {
        let registered = current.registered && current.hwnd == hwnd as isize;
        current.registered = false;
        registered
      })
      .unwrap_or(false);
    if registered {
      let mut data = appbar_data(hwnd);
      SHAppBarMessage(ABM_REMOVE, &mut data);
    }
    RemoveWindowSubclass(hwnd, Some(subclass_proc), APPBAR_SUBCLASS_ID);
  }
  DefSubclassProc(hwnd, msg, wparam, lparam)
}

pub fn install_window_subclass<R: tauri::Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
  let hwnd = window.hwnd().map_err(|e| format!("hwnd: {e}"))?.0;
  let installed = unsafe { SetWindowSubclass(hwnd, Some(subclass_proc), APPBAR_SUBCLASS_ID, 0) };
  if installed == 0 {
    return Err("SetWindowSubclass failed".into());
  }
  state().lock().map_err(|_| "appbar state poisoned")?.hwnd = hwnd as isize;
  Ok(())
}

pub fn set_reserved<R: tauri::Runtime>(
  window: &WebviewWindow<R>,
  enabled: bool,
  edge: DockEdge,
) -> Result<(), String> {
  let _transition = transition_lock()
    .lock()
    .map_err(|_| "appbar transition lock poisoned")?;
  state()
    .lock()
    .map_err(|_| "appbar state poisoned")?
    .transitioning = true;
  let result = set_reserved_inner(window, enabled, edge);
  if let Ok(mut current) = state().lock() {
    current.transitioning = false;
  }
  result
}

fn set_reserved_inner<R: tauri::Runtime>(
  window: &WebviewWindow<R>,
  enabled: bool,
  edge: DockEdge,
) -> Result<(), String> {
  let hwnd = window.hwnd().map_err(|e| format!("hwnd: {e}"))?.0;
  let height = (DOCK_STRIP_LOGICAL_HEIGHT * window.scale_factor().unwrap_or(1.0)).round() as i32;
  let previous_registration = {
    let mut current = state().lock().map_err(|_| "appbar state poisoned")?;
    let registration = current.registered.then_some((current.edge, current.height));
    current.registered = false;
    registration
  };

  unsafe {
    // Capture before ABM_REMOVE/NEW. When this window is already registered,
    // rcWork excludes its current reservation; add only that slice back so the
    // whole transition uses one stable, pre-transition work area.
    let work_area = monitor_work_area(hwnd)?;
    let available_work_area = match previous_registration {
      Some((previous_edge, previous_height)) => {
        work_area_without_self(work_area, previous_edge, previous_height)
      }
      None => work_area,
    };
    if previous_registration.is_some() {
      let mut data = appbar_data(hwnd);
      SHAppBarMessage(ABM_REMOVE, &mut data);
    }
    if enabled {
      let mut data = appbar_data(hwnd);
      if SHAppBarMessage(ABM_NEW, &mut data) == 0 {
        return Err("ABM_NEW rejected the appbar registration".into());
      }
      let height = height.max(1);
      {
        let mut current = state().lock().map_err(|_| "appbar state poisoned")?;
        current.hwnd = hwnd as isize;
        current.edge = edge;
        current.height = height;
        current.registered = true;
      }
      if let Err(error) = reposition(hwnd, edge, height, Some(available_work_area)) {
        SHAppBarMessage(ABM_REMOVE, &mut data);
        if let Ok(mut current) = state().lock() {
          current.registered = false;
        }
        return Err(error);
      }
    } else if previous_registration.is_some() {
      move_overlay(hwnd, edge, height.max(1), available_work_area)?;
    }
  }
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  fn monitor_rect() -> RECT {
    RECT {
      left: -1920,
      top: -200,
      right: 0,
      bottom: 1000,
    }
  }

  #[test]
  fn appbar_rect_uses_only_the_top_strip() {
    let mut rect = monitor_rect();

    constrain_to_edge(&mut rect, DockEdge::Top, 108);

    assert_eq!(
      (rect.left, rect.top, rect.right, rect.bottom),
      (-1920, -200, 0, -92)
    );
  }

  #[test]
  fn appbar_rect_uses_only_the_bottom_strip() {
    let mut rect = monitor_rect();

    constrain_to_edge(&mut rect, DockEdge::Bottom, 108);

    assert_eq!(
      (rect.left, rect.top, rect.right, rect.bottom),
      (-1920, 892, 0, 1000)
    );
  }

  #[test]
  fn appbar_rect_restores_the_requested_height() {
    let mut rect = RECT {
      left: -1920,
      top: -92,
      right: 0,
      bottom: -92,
    };

    constrain_to_edge(&mut rect, DockEdge::Top, 108);

    assert_eq!(rect.bottom - rect.top, 108);
  }

  #[test]
  fn bottom_appbar_rect_is_stable_after_work_area_includes_its_reservation() {
    let initial = appbar_rect_from_work_area(monitor_rect(), DockEdge::Bottom, 108, false);
    let reserved_work_area = RECT {
      bottom: 892,
      ..monitor_rect()
    };
    let repeated = appbar_rect_from_work_area(reserved_work_area, DockEdge::Bottom, 108, true);

    assert_eq!(
      (initial.left, initial.top, initial.right, initial.bottom),
      (repeated.left, repeated.top, repeated.right, repeated.bottom)
    );
  }

  #[test]
  fn top_appbar_rect_is_stable_after_work_area_includes_its_reservation() {
    let initial = appbar_rect_from_work_area(monitor_rect(), DockEdge::Top, 108, false);
    let reserved_work_area = RECT {
      top: -92,
      ..monitor_rect()
    };
    let repeated = appbar_rect_from_work_area(reserved_work_area, DockEdge::Top, 108, true);

    assert_eq!(
      (initial.left, initial.top, initial.right, initial.bottom),
      (repeated.left, repeated.top, repeated.right, repeated.bottom)
    );
  }

  #[test]
  fn edge_change_recovers_the_previous_reservation_before_repositioning() {
    let top_reserved_work_area = RECT {
      top: -92,
      ..monitor_rect()
    };
    let available = work_area_without_self(top_reserved_work_area, DockEdge::Top, 108);

    let bottom = appbar_rect_from_work_area(available, DockEdge::Bottom, 108, false);

    assert_eq!((bottom.top, bottom.bottom), (892, 1000));
  }

  #[test]
  fn registered_appbar_overrides_external_window_position() {
    let mut position = WINDOWPOS {
      hwnd: std::ptr::null_mut(),
      hwndInsertAfter: std::ptr::null_mut(),
      x: 0,
      y: 784,
      cx: 1920,
      cy: 108,
      flags: SWP_NOMOVE | SWP_NOSIZE,
    };
    let expected = RECT {
      left: 0,
      top: 892,
      right: 1920,
      bottom: 1000,
    };

    enforce_window_position(&mut position, expected);

    assert_eq!(
      (position.x, position.y, position.cx, position.cy),
      (0, 892, 1920, 108)
    );
    assert_eq!(position.flags & (SWP_NOMOVE | SWP_NOSIZE), 0);
  }

  #[test]
  fn appbar_ignores_position_notifications_caused_by_its_own_reposition() {
    let current = AppBarState {
      hwnd: 42,
      edge: DockEdge::Top,
      height: 72,
      registered: true,
      positioning: true,
      transitioning: false,
    };

    assert_eq!(current.requested_position(42), None);
    assert!(!current.should_notify_window_position_changed(42));
  }

  #[test]
  fn appbar_ignores_position_notifications_during_a_transition() {
    let current = AppBarState {
      hwnd: 42,
      edge: DockEdge::Bottom,
      height: 72,
      registered: true,
      positioning: false,
      transitioning: true,
    };

    assert_eq!(current.requested_position(42), None);
    assert!(!current.should_notify_window_position_changed(42));
  }
}
