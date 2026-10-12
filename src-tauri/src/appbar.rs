use std::mem::size_of;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Mutex, OnceLock};

use tauri::WebviewWindow;
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows_sys::Win32::Graphics::Gdi::{
  GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
use windows_sys::Win32::UI::Shell::{
  DefSubclassProc, RemoveWindowSubclass, SHAppBarMessage, SetWindowSubclass, ABE_BOTTOM, ABE_TOP,
  ABM_NEW, ABM_REMOVE, ABM_SETPOS, ABM_WINDOWPOSCHANGED, ABN_FULLSCREENAPP, ABN_POSCHANGED,
  APPBARDATA,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
  GetWindowLongW, KillTimer, MoveWindow, SetTimer, SetWindowPos, GWL_EXSTYLE, HWND_BOTTOM,
  HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, WINDOWPOS, WM_APP, WM_NCDESTROY, WM_TIMER,
  WM_WINDOWPOSCHANGED, WM_WINDOWPOSCHANGING, WS_EX_TOPMOST,
};

use crate::dock::DockEdge;
use crate::window_state::MonitorRect;

const APPBAR_CALLBACK_MESSAGE: u32 = WM_APP + 0x31;
const APPBAR_SUBCLASS_ID: usize = 0x504c5653;
const RESTORE_TIMER_ID: usize = 0x504c5654;
const RESTORE_RETRY_MS: u32 = 250;
const RESTORE_MAX_ATTEMPTS: u32 = 20;

#[derive(Clone, Copy)]
struct AppBarState {
  hwnd: isize,
  edge: DockEdge,
  height: i32,
  target_work_area: RECT,
  registered: bool,
  /// The Dock is on screen and wants Shell's full-screen notifications. While
  /// this is set and `registered` is not, the window holds an ABM_NEW
  /// registration without ABM_SETPOS: it reserves nothing, but Shell only sends
  /// ABN_FULLSCREENAPP to registered appbars, and an overlay Dock has to yield
  /// too.
  watching: bool,
  positioning: bool,
  transitioning: bool,
}

impl AppBarState {
  fn receives_shell_notifications(&self, hwnd: isize) -> bool {
    (self.registered || self.watching) && self.hwnd == hwnd
  }

  fn requested_position(&self, hwnd: isize) -> Option<(DockEdge, i32, RECT)> {
    (self.registered && !self.positioning && !self.transitioning && self.hwnd == hwnd).then_some((
      self.edge,
      self.height,
      self.target_work_area,
    ))
  }

  fn should_notify_window_position_changed(&self, hwnd: isize) -> bool {
    self.registered && !self.positioning && !self.transitioning && self.hwnd == hwnd
  }
}

/// A full-screen window owns the Dock's monitor, so the strip has dropped out
/// of the topmost band until Shell reports that window gone.
static YIELDED: AtomicBool = AtomicBool::new(false);
static RESTORE_ATTEMPTS: AtomicU32 = AtomicU32::new(0);
static STATE: OnceLock<Mutex<AppBarState>> = OnceLock::new();
static TRANSITION_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn state() -> &'static Mutex<AppBarState> {
  STATE.get_or_init(|| {
    Mutex::new(AppBarState {
      hwnd: 0,
      edge: DockEdge::Bottom,
      height: 72,
      target_work_area: RECT::default(),
      registered: false,
      watching: false,
      positioning: false,
      transitioning: false,
    })
  })
}

fn is_yielded() -> bool {
  YIELDED.load(Ordering::Relaxed)
}

/// Step behind a full-screen window, or return to the topmost band. Shell lowers
/// its own taskbar for full-screen windows but only notifies other appbars;
/// HWND_BOTTOM is what removes the topmost style.
unsafe fn set_yielded(hwnd: HWND, yielded: bool) {
  YIELDED.store(yielded, Ordering::Relaxed);
  SetWindowPos(
    hwnd,
    if yielded { HWND_BOTTOM } else { HWND_TOPMOST },
    0,
    0,
    0,
    0,
    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
  );
  if yielded || is_topmost(hwnd) {
    KillTimer(hwnd, RESTORE_TIMER_ID);
  } else {
    RESTORE_ATTEMPTS.store(0, Ordering::Relaxed);
    SetTimer(hwnd, RESTORE_TIMER_ID, RESTORE_RETRY_MS, None);
  }
}

unsafe fn is_topmost(hwnd: HWND) -> bool {
  GetWindowLongW(hwnd, GWL_EXSTYLE) as u32 & WS_EX_TOPMOST != 0
}

/// Shell can report the full-screen window gone while it is still being torn
/// down, and Windows then places the strip behind it instead of in the topmost
/// band. No later notification follows, so retry until the style sticks.
unsafe fn retry_topmost(hwnd: HWND) {
  let wanted = !is_yielded()
    && state()
      .lock()
      .map(|current| current.receives_shell_notifications(hwnd as isize))
      .unwrap_or(false);
  if wanted && !is_topmost(hwnd) {
    SetWindowPos(
      hwnd,
      HWND_TOPMOST,
      0,
      0,
      0,
      0,
      SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
    );
  }
  let attempts = RESTORE_ATTEMPTS.fetch_add(1, Ordering::Relaxed) + 1;
  if !wanted || is_topmost(hwnd) {
    KillTimer(hwnd, RESTORE_TIMER_ID);
  } else if attempts >= RESTORE_MAX_ATTEMPTS {
    KillTimer(hwnd, RESTORE_TIMER_ID);
    log::warn!("dock strip could not return to the topmost band after a full-screen window");
  }
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
  logical_height: u32,
) -> Result<(), String> {
  let _transition = transition_lock()
    .lock()
    .map_err(|_| "appbar transition lock poisoned")?;
  let hwnd = window.hwnd().map_err(|e| format!("hwnd: {e}"))?.0;
  let height = (logical_height as f64 * scale).round() as i32;
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

/// Preview a height change without renegotiating the Shell reservation. The
/// registered work area stays unchanged until pointer release; only the Dock
/// window follows the pointer during the drag.
pub fn preview_reserved_height<R: tauri::Runtime>(
  window: &WebviewWindow<R>,
  edge: DockEdge,
  logical_height: u32,
) -> Result<(), String> {
  let _transition = transition_lock()
    .lock()
    .map_err(|_| "appbar transition lock poisoned")?;
  let hwnd = window.hwnd().map_err(|e| format!("hwnd: {e}"))?.0;
  let height = (logical_height as f64 * window.scale_factor().unwrap_or(1.0)).round() as i32;
  let previous = {
    let mut current = state().lock().map_err(|_| "appbar state poisoned")?;
    if !current.registered || current.hwnd != hwnd as isize {
      return Err("dock is not registered as an appbar".into());
    }
    current.transitioning = true;
    (current.edge, current.height)
  };

  let result = unsafe {
    (|| -> Result<(), String> {
      let reserved_work_area = monitor_work_area(hwnd)?;
      let available_work_area = work_area_without_self(reserved_work_area, previous.0, previous.1);
      let rect = appbar_rect_from_work_area(available_work_area, edge, height, false);
      move_window(hwnd, rect, "dock height preview")
    })()
  };
  if let Ok(mut current) = state().lock() {
    current.transitioning = false;
  }
  result
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
    if let Some((edge, height, target_work_area)) = requested {
      let _ = reposition(hwnd, edge, height, Some(target_work_area));
    }
    return 0;
  }
  if msg == APPBAR_CALLBACK_MESSAGE && wparam as u32 == ABN_FULLSCREENAPP {
    let notified = state()
      .lock()
      .map(|current| current.receives_shell_notifications(hwnd as isize))
      .unwrap_or(false);
    log::info!(
      "dock fullscreen notification: fullscreen={} applied={notified}",
      lparam != 0
    );
    if notified {
      set_yielded(hwnd, lparam != 0);
    }
    return 0;
  }
  if msg == WM_TIMER && wparam == RESTORE_TIMER_ID {
    retry_topmost(hwnd);
    return 0;
  }
  if msg == WM_WINDOWPOSCHANGING {
    let requested = state()
      .lock()
      .ok()
      .and_then(|current| current.requested_position(hwnd as isize));
    if let Some((edge, height, target_work_area)) = requested {
      let rect = appbar_rect_from_work_area(target_work_area, edge, height, false);
      if let Some(position) = (lparam as *mut WINDOWPOS).as_mut() {
        enforce_window_position(position, rect);
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
        let registered = current.receives_shell_notifications(hwnd as isize);
        current.registered = false;
        current.watching = false;
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

/// Start or stop following full-screen windows on the Dock's monitor. Turn it
/// on once the strip is on screen and off before the strip goes away; the
/// caller owns the window's topmost state on both sides of that.
pub fn watch_fullscreen<R: tauri::Runtime>(
  window: &WebviewWindow<R>,
  enabled: bool,
) -> Result<(), String> {
  let _transition = transition_lock()
    .lock()
    .map_err(|_| "appbar transition lock poisoned")?;
  let hwnd = window.hwnd().map_err(|e| format!("hwnd: {e}"))?.0;
  let changes_registration = {
    let mut current = state().lock().map_err(|_| "appbar state poisoned")?;
    let changed = current.watching != enabled;
    current.watching = enabled;
    if enabled {
      current.hwnd = hwnd as isize;
    }
    changed && !current.registered
  };
  if !enabled {
    YIELDED.store(false, Ordering::Relaxed);
  }
  if changes_registration {
    let mut data = appbar_data(hwnd);
    unsafe {
      SHAppBarMessage(if enabled { ABM_NEW } else { ABM_REMOVE }, &mut data);
    }
  }
  Ok(())
}

pub fn set_reserved<R: tauri::Runtime>(
  window: &WebviewWindow<R>,
  enabled: bool,
  edge: DockEdge,
  logical_height: u32,
) -> Result<(), String> {
  let _transition = transition_lock()
    .lock()
    .map_err(|_| "appbar transition lock poisoned")?;
  state()
    .lock()
    .map_err(|_| "appbar state poisoned")?
    .transitioning = true;
  let result = set_reserved_inner(window, enabled, edge, logical_height);
  if let Ok(mut current) = state().lock() {
    current.transitioning = false;
  }
  result
}

fn set_reserved_inner<R: tauri::Runtime>(
  window: &WebviewWindow<R>,
  enabled: bool,
  edge: DockEdge,
  logical_height: u32,
) -> Result<(), String> {
  let hwnd = window.hwnd().map_err(|e| format!("hwnd: {e}"))?.0;
  let height = (logical_height as f64 * window.scale_factor().unwrap_or(1.0)).round() as i32;
  let (previous_registration, watching) = {
    let mut current = state().lock().map_err(|_| "appbar state poisoned")?;
    let registration = current.registered.then_some((current.edge, current.height));
    current.registered = false;
    (registration, current.watching)
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
    if previous_registration.is_some() || watching {
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
        current.target_work_area = available_work_area;
        current.registered = true;
      }
      if let Err(error) = reposition(hwnd, edge, height, Some(available_work_area)) {
        SHAppBarMessage(ABM_REMOVE, &mut data);
        if let Ok(mut current) = state().lock() {
          current.registered = false;
        }
        return Err(error);
      }
    } else {
      if previous_registration.is_some() {
        move_overlay(hwnd, edge, height.max(1), available_work_area)?;
      }
      if watching {
        let mut data = appbar_data(hwnd);
        SHAppBarMessage(ABM_NEW, &mut data);
      }
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
  fn reserved_height_preview_recovers_the_unreserved_work_area() {
    let reserved = RECT {
      left: 0,
      top: 0,
      right: 1920,
      bottom: 968,
    };
    let available = work_area_without_self(reserved, DockEdge::Bottom, 72);
    let preview = appbar_rect_from_work_area(available, DockEdge::Bottom, 120, false);
    assert_eq!(
      (preview.left, preview.top, preview.right, preview.bottom),
      (0, 920, 1920, 1040)
    );
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
  fn registered_appbar_keeps_its_target_monitor_while_window_moves_offscreen() {
    let target_work_area = monitor_rect();
    let current = AppBarState {
      hwnd: 42,
      edge: DockEdge::Bottom,
      height: 108,
      target_work_area,
      registered: true,
      watching: false,
      positioning: false,
      transitioning: false,
    };

    let (_, _, restored_work_area) = current.requested_position(42).unwrap();

    assert_eq!(
      (
        restored_work_area.left,
        restored_work_area.top,
        restored_work_area.right,
        restored_work_area.bottom,
      ),
      (
        target_work_area.left,
        target_work_area.top,
        target_work_area.right,
        target_work_area.bottom,
      )
    );
  }

  #[test]
  fn appbar_ignores_position_notifications_caused_by_its_own_reposition() {
    let current = AppBarState {
      hwnd: 42,
      edge: DockEdge::Top,
      height: 72,
      target_work_area: monitor_rect(),
      registered: true,
      watching: false,
      positioning: true,
      transitioning: false,
    };

    assert!(current.requested_position(42).is_none());
    assert!(!current.should_notify_window_position_changed(42));
  }

  #[test]
  fn overlay_dock_follows_fullscreen_notifications_without_enforcing_a_position() {
    let current = AppBarState {
      hwnd: 42,
      edge: DockEdge::Bottom,
      height: 72,
      target_work_area: monitor_rect(),
      registered: false,
      watching: true,
      positioning: false,
      transitioning: false,
    };

    assert!(current.receives_shell_notifications(42));
    assert!(!current.receives_shell_notifications(7));
    assert!(current.requested_position(42).is_none());
    assert!(!current.should_notify_window_position_changed(42));
  }

  #[test]
  fn undocked_window_ignores_fullscreen_notifications() {
    let current = AppBarState {
      hwnd: 42,
      edge: DockEdge::Bottom,
      height: 72,
      target_work_area: monitor_rect(),
      registered: false,
      watching: false,
      positioning: false,
      transitioning: false,
    };

    assert!(!current.receives_shell_notifications(42));
  }

  #[test]
  fn appbar_ignores_position_notifications_during_a_transition() {
    let current = AppBarState {
      hwnd: 42,
      edge: DockEdge::Bottom,
      height: 72,
      target_work_area: monitor_rect(),
      registered: true,
      watching: false,
      positioning: false,
      transitioning: true,
    };

    assert!(current.requested_position(42).is_none());
    assert!(!current.should_notify_window_position_changed(42));
  }
}
