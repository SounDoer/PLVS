use std::mem::size_of;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

use tauri::WebviewWindow;
use windows_sys::core::BOOL;
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows_sys::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
use windows_sys::Win32::Graphics::Gdi::{
  GetMonitorInfoW, MonitorFromRect, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
use windows_sys::Win32::System::Threading::GetCurrentProcessId;
use windows_sys::Win32::UI::Shell::{
  DefSubclassProc, RemoveWindowSubclass, SHAppBarMessage, SetWindowSubclass, ABE_BOTTOM, ABE_TOP,
  ABM_NEW, ABM_REMOVE, ABM_SETPOS, ABM_WINDOWPOSCHANGED, ABN_FULLSCREENAPP, ABN_POSCHANGED,
  APPBARDATA,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
  EnumWindows, GetClassNameW, GetWindowLongW, GetWindowRect, GetWindowThreadProcessId, IsIconic,
  IsWindowVisible, KillTimer, MoveWindow, SendMessageW, SetTimer, ShowWindow, GWL_EXSTYLE,
  SWP_NOMOVE, SWP_NOSIZE, SW_HIDE, SW_SHOWNOACTIVATE, WINDOWPOS, WM_APP, WM_NCDESTROY, WM_TIMER,
  WM_WINDOWPOSCHANGED, WM_WINDOWPOSCHANGING, WS_EX_TOPMOST, WS_EX_TRANSPARENT,
};

use crate::dock::DockEdge;
use crate::window_state::MonitorRect;

const APPBAR_CALLBACK_MESSAGE: u32 = WM_APP + 0x31;
const APPLY_FULL_SCREEN_MESSAGE: u32 = WM_APP + 0x32;
const APPBAR_SUBCLASS_ID: usize = 0x504c5653;
const FULLSCREEN_POLL_TIMER_ID: usize = 0x504c5655;
const FULLSCREEN_POLL_MS: u32 = 500;

/// What the strip does while a full-screen window owns its monitor.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum FullScreenMode {
  None,
  /// Above Full Screen is on: the strip stays in the topmost band and lays out
  /// against the whole monitor, where the full-screen window has hidden the taskbar.
  Fill,
  /// Above Full Screen is off. Dropping the strip out of the topmost band would
  /// put it behind the full-screen window too, but Windows silently refuses to
  /// return a background process's window to that band afterwards.
  Hide,
}

fn full_screen_mode(present: bool, above_full_screen: bool) -> FullScreenMode {
  match (present, above_full_screen) {
    (false, _) => FullScreenMode::None,
    (true, true) => FullScreenMode::Fill,
    (true, false) => FullScreenMode::Hide,
  }
}

#[derive(Clone, Copy)]
struct AppBarState {
  hwnd: isize,
  edge: DockEdge,
  height: i32,
  /// The work area the strip lays out against, whether or not it reserves space.
  target_work_area: RECT,
  registered: bool,
  /// The Dock is on screen and wants Shell's full-screen notifications. While
  /// this is set and `registered` is not, the window holds an ABM_NEW
  /// registration without ABM_SETPOS: it reserves nothing, but Shell only sends
  /// ABN_FULLSCREENAPP to registered appbars, and an overlay Dock has to react
  /// too.
  watching: bool,
  positioning: bool,
  transitioning: bool,
  mode: FullScreenMode,
  /// The Dock's monitor rect while a full-screen window owns that monitor.
  full_screen: Option<RECT>,
}

impl AppBarState {
  fn receives_shell_notifications(&self, hwnd: isize) -> bool {
    (self.registered || self.watching) && self.hwnd == hwnd
  }

  fn fill_area(&self) -> Option<RECT> {
    self
      .full_screen
      .filter(|_| self.mode == FullScreenMode::Fill)
  }

  fn requested_position(&self, hwnd: isize) -> Option<(DockEdge, i32, RECT)> {
    (self.registered && !self.positioning && !self.transitioning && self.hwnd == hwnd).then_some((
      self.edge,
      self.height,
      strip_area(self.target_work_area, self.fill_area()),
    ))
  }

  fn should_notify_window_position_changed(&self, hwnd: isize) -> bool {
    self.registered && !self.positioning && !self.transitioning && self.hwnd == hwnd
  }
}

/// The Dock's Above Full Screen switch.
static ABOVE_FULL_SCREEN: AtomicBool = AtomicBool::new(true);
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
      mode: FullScreenMode::None,
      full_screen: None,
    })
  })
}

fn same_rect(a: RECT, b: RECT) -> bool {
  (a.left, a.top, a.right, a.bottom) == (b.left, b.top, b.right, b.bottom)
}

fn contains(outer: RECT, inner: RECT) -> bool {
  inner.left >= outer.left
    && inner.top >= outer.top
    && inner.right <= outer.right
    && inner.bottom <= outer.bottom
}

/// The area the strip lays out against: the whole monitor while it fills a
/// full-screen monitor, otherwise the work area. A fill area left over from
/// another monitor never applies.
fn strip_area(work_area: RECT, fill: Option<RECT>) -> RECT {
  match fill {
    Some(monitor) if contains(monitor, work_area) => monitor,
    _ => work_area,
  }
}

/// Shell reports full-screen windows on other monitors too, so a report starts
/// only where one is seen. Its "gone" always ends one.
fn reports_full_screen(shell_says_full_screen: bool, seen_on_dock_monitor: bool) -> bool {
  shell_says_full_screen && seen_on_dock_monitor
}

fn covers_monitor(window: RECT, monitor: RECT) -> bool {
  window.left <= monitor.left
    && window.top <= monitor.top
    && window.right >= monitor.right
    && window.bottom >= monitor.bottom
}

fn intersects(a: RECT, b: RECT) -> bool {
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
}

/// The desktop's windows span every monitor but are never a full-screen application.
fn is_desktop_class(class: &str) -> bool {
  matches!(class, "Progman" | "WorkerW")
}

#[derive(Clone, Copy)]
struct StackedWindow {
  rect: RECT,
  topmost: bool,
  /// PLVS's own windows and click-through overlays, which say nothing about
  /// what the user is looking at.
  ignored: bool,
  desktop: bool,
}

/// Looking down the z-order at one monitor, past always-on-top windows that do
/// not cover it, is the first ordinary window full screen? Shell judges alike:
/// focusing the strip leaves the taskbar hidden, while raising any ordinary
/// window over the full-screen one brings it back.
fn full_screen_in_z_order(windows: impl IntoIterator<Item = StackedWindow>, monitor: RECT) -> bool {
  for window in windows {
    if window.desktop {
      return false;
    }
    if window.ignored || !intersects(window.rect, monitor) {
      continue;
    }
    if covers_monitor(window.rect, monitor) {
      return true;
    }
    if !window.topmost {
      return false;
    }
  }
  false
}

unsafe fn stacked_window(hwnd: HWND, process: u32) -> Option<StackedWindow> {
  if IsWindowVisible(hwnd) == 0 || IsIconic(hwnd) != 0 {
    return None;
  }
  let mut cloaked: u32 = 0;
  if DwmGetWindowAttribute(
    hwnd,
    DWMWA_CLOAKED as u32,
    (&mut cloaked as *mut u32).cast(),
    size_of::<u32>() as u32,
  ) == 0
    && cloaked != 0
  {
    return None;
  }
  let mut rect = RECT::default();
  if GetWindowRect(hwnd, &mut rect) == 0 {
    return None;
  }
  let mut owner = 0u32;
  GetWindowThreadProcessId(hwnd, &mut owner);
  let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
  let mut class = [0u16; 64];
  let length = GetClassNameW(hwnd, class.as_mut_ptr(), class.len() as i32);
  Some(StackedWindow {
    rect,
    topmost: ex_style & WS_EX_TOPMOST != 0,
    ignored: owner == process || ex_style & WS_EX_TRANSPARENT != 0,
    desktop: length > 0 && is_desktop_class(&String::from_utf16_lossy(&class[..length as usize])),
  })
}

unsafe extern "system" fn collect_window(hwnd: HWND, windows: LPARAM) -> BOOL {
  (*(windows as *mut Vec<HWND>)).push(hwnd);
  1
}

/// Whether a full-screen window owns `monitor` now. EnumWindows walks the
/// z-order from the top.
unsafe fn full_screen_window_on(monitor: RECT) -> bool {
  let mut windows: Vec<HWND> = Vec::new();
  if EnumWindows(
    Some(collect_window),
    &mut windows as *mut Vec<HWND> as LPARAM,
  ) == 0
  {
    return false;
  }
  let process = GetCurrentProcessId();
  full_screen_in_z_order(
    windows
      .into_iter()
      .filter_map(|hwnd| stacked_window(hwnd, process)),
    monitor,
  )
}

/// The Dock's monitor rect, found from the work area the strip lays out against.
unsafe fn dock_monitor() -> Option<RECT> {
  let work_area = state().lock().ok()?.target_work_area;
  let monitor = MonitorFromRect(&work_area, MONITOR_DEFAULTTONEAREST);
  let mut info = MONITORINFO {
    cbSize: size_of::<MONITORINFO>() as u32,
    rcMonitor: RECT::default(),
    rcWork: RECT::default(),
    dwFlags: 0,
  };
  (!monitor.is_null() && GetMonitorInfoW(monitor, &mut info) != 0).then_some(info.rcMonitor)
}

/// Start or end the full-screen report from a Shell notification.
unsafe fn take_shell_report(hwnd: HWND, full_screen: bool) {
  let monitor = dock_monitor();
  let seen = full_screen && monitor.is_some_and(|monitor| full_screen_window_on(monitor));
  let reported = reports_full_screen(full_screen, seen);
  log::info!("dock fullscreen notification: fullscreen={full_screen} on dock monitor={seen}");
  if let Ok(mut current) = state().lock() {
    current.full_screen = monitor.filter(|_| reported);
  }
  apply_full_screen(hwnd);
}

/// Shell never reports a full-screen window gone to a registration made while
/// it was open, so the strip checks for itself while a report stands.
unsafe fn check_full_screen_report(hwnd: HWND) {
  let Some(monitor) = state().lock().ok().and_then(|current| current.full_screen) else {
    return;
  };
  if !full_screen_window_on(monitor) {
    log::info!("dock full-screen window gone without a notification");
    if let Ok(mut current) = state().lock() {
      current.full_screen = None;
    }
    apply_full_screen(hwnd);
  }
}

/// Bring the strip in line with the full-screen report and the switch. Runs on
/// the window's thread, which serialises it with Shell's notifications and the
/// backstop timer.
unsafe fn apply_full_screen(hwnd: HWND) {
  let monitor = dock_monitor();
  let Some((before, after, reported)) = state().lock().ok().map(|mut current| {
    let on_dock_monitor = match (current.full_screen, monitor) {
      (Some(report), Some(monitor)) => same_rect(report, monitor),
      _ => false,
    };
    if current.full_screen.is_some() && !on_dock_monitor {
      // The Dock has moved off the monitor the report was for.
      current.full_screen = None;
    }
    let present =
      current.full_screen.is_some() && current.receives_shell_notifications(hwnd as isize);
    let before = current.mode;
    current.mode = full_screen_mode(present, ABOVE_FULL_SCREEN.load(Ordering::Relaxed));
    (before, current.mode, current.full_screen.is_some())
  }) else {
    return;
  };
  if reported {
    SetTimer(hwnd, FULLSCREEN_POLL_TIMER_ID, FULLSCREEN_POLL_MS, None);
  } else {
    KillTimer(hwnd, FULLSCREEN_POLL_TIMER_ID);
  }
  if before == after {
    return;
  }
  log::info!("dock full-screen mode: {before:?} -> {after:?}");
  if (before == FullScreenMode::Fill) != (after == FullScreenMode::Fill) {
    relayout(hwnd);
  }
  if after == FullScreenMode::Hide {
    ShowWindow(hwnd, SW_HIDE);
  } else if before == FullScreenMode::Hide {
    ShowWindow(hwnd, SW_SHOWNOACTIVATE);
  }
}

/// Move the strip to where its layout now puts it, carrying any open Dock
/// accessories along so they stay attached to it.
unsafe fn relayout(hwnd: HWND) {
  let Some((registered, edge, height, work_area)) = state().lock().ok().map(|current| {
    (
      current.registered,
      current.edge,
      current.height,
      current.target_work_area,
    )
  }) else {
    return;
  };
  let mut before = RECT::default();
  let had_rect = GetWindowRect(hwnd, &mut before) != 0;
  let result = if registered {
    reposition(hwnd, edge, height, Some(work_area))
  } else {
    move_overlay(hwnd, edge, height, work_area)
  };
  if let Err(error) = result {
    log::warn!("dock strip could not follow a full-screen window: {error}");
    return;
  }
  let mut after = RECT::default();
  if had_rect && GetWindowRect(hwnd, &mut after) != 0 {
    crate::accessory_pin::shift_all(after.left - before.left, after.top - before.top);
  }
}

/// Re-apply on the window's thread and wait for it.
fn request_full_screen_apply(hwnd: HWND) {
  unsafe { SendMessageW(hwnd, APPLY_FULL_SCREEN_MESSAGE, 0, 0) };
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

/// The OS work area excludes our reservation. Only restore it on the same display.
pub(crate) fn own_reserved_height<R: tauri::Runtime>(
  window: &WebviewWindow<R>,
  monitor_name: Option<&str>,
) -> (u32, i32) {
  let current_monitor = window.current_monitor().ok().flatten();
  if current_monitor
    .as_ref()
    .and_then(|monitor| monitor.name().map(String::as_str))
    != monitor_name
  {
    return (0, 0);
  }
  state()
    .lock()
    .ok()
    .filter(|state| state.registered)
    .map(|state| {
      (
        state.height.max(0) as u32,
        if state.edge == DockEdge::Top {
          state.height
        } else {
          0
        },
      )
    })
    .unwrap_or((0, 0))
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

pub(crate) fn enforce_window_position(position: &mut WINDOWPOS, rect: RECT) {
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
  // The reservation always comes from the work area; only the window fills.
  let fill = state().lock().ok().and_then(|current| current.fill_area());
  let rect = match fill {
    Some(monitor) if contains(monitor, data.rc) => {
      appbar_rect_from_work_area(monitor, edge, height, false)
    }
    _ => data.rc,
  };
  move_window(hwnd, rect, "appbar")?;
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
  let fill = {
    let mut current = state().lock().map_err(|_| "appbar state poisoned")?;
    if current.positioning {
      return Ok(());
    }
    current.positioning = true;
    current.edge = edge;
    current.height = height;
    current.target_work_area = work_area;
    current.fill_area()
  };
  let rect = appbar_rect_from_work_area(strip_area(work_area, fill), edge, height, false);
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
    (current.edge, current.height, current.fill_area())
  };

  let result = unsafe {
    (|| -> Result<(), String> {
      let reserved_work_area = monitor_work_area(hwnd)?;
      let available_work_area = work_area_without_self(reserved_work_area, previous.0, previous.1);
      let area = strip_area(available_work_area, previous.2);
      let rect = appbar_rect_from_work_area(area, edge, height, false);
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
    // Renegotiate against the work area; `position` decides whether the window fills.
    let requested = state().lock().ok().and_then(|current| {
      current
        .requested_position(hwnd as isize)
        .map(|(edge, height, _)| (edge, height, current.target_work_area))
    });
    if let Some((edge, height, target_work_area)) = requested {
      let _ = reposition(hwnd, edge, height, Some(target_work_area));
    }
    return 0;
  }
  if msg == APPBAR_CALLBACK_MESSAGE && wparam as u32 == ABN_FULLSCREENAPP {
    take_shell_report(hwnd, lparam != 0);
    return 0;
  }
  if msg == APPLY_FULL_SCREEN_MESSAGE {
    apply_full_screen(hwnd);
    return 0;
  }
  if msg == WM_TIMER && wparam == FULLSCREEN_POLL_TIMER_ID {
    check_full_screen_report(hwnd);
    return 0;
  }
  if msg == WM_WINDOWPOSCHANGING {
    let requested = state()
      .lock()
      .ok()
      .and_then(|current| current.requested_position(hwnd as isize));
    if let Some((edge, height, area)) = requested {
      let rect = appbar_rect_from_work_area(area, edge, height, false);
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
/// caller owns the window's topmost state on both sides of that, and turning it
/// off shows a strip that was hidden for a full-screen window.
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
    state()
      .lock()
      .map_err(|_| "appbar state poisoned")?
      .full_screen = None;
    request_full_screen_apply(hwnd);
  }
  if changes_registration {
    let mut data = appbar_data(hwnd);
    unsafe {
      SHAppBarMessage(if enabled { ABM_NEW } else { ABM_REMOVE }, &mut data);
    }
  }
  Ok(())
}

/// Set the Above Full Screen switch. While the strip follows Shell's
/// notifications, the change applies at once against the standing report.
pub fn set_above_full_screen<R: tauri::Runtime>(
  window: &WebviewWindow<R>,
  enabled: bool,
) -> Result<(), String> {
  let hwnd = window.hwnd().map_err(|e| format!("hwnd: {e}"))?.0;
  ABOVE_FULL_SCREEN.store(enabled, Ordering::Relaxed);
  let notified = state()
    .lock()
    .map_err(|_| "appbar state poisoned")?
    .receives_shell_notifications(hwnd as isize);
  if notified {
    request_full_screen_apply(hwnd);
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
    let scale = window.scale_factor().unwrap_or(1.0);
    let height = (crate::dock::fit_dock_height(
      logical_height,
      (available_work_area.bottom - available_work_area.top).max(0) as u32,
      scale,
    ) as f64
      * scale)
      .round() as i32;
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
      mode: FullScreenMode::None,
      full_screen: None,
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
      mode: FullScreenMode::None,
      full_screen: None,
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
      mode: FullScreenMode::None,
      full_screen: None,
    };

    assert!(current.receives_shell_notifications(42));
    assert!(!current.receives_shell_notifications(7));
    assert!(current.requested_position(42).is_none());
    assert!(!current.should_notify_window_position_changed(42));
  }

  #[test]
  fn a_filling_registered_strip_enforces_the_monitor_edge() {
    let current = AppBarState {
      mode: FullScreenMode::Fill,
      full_screen: Some(screen()),
      ..appbar_state(true, work_area())
    };
    let (edge, height, area) = current.requested_position(42).unwrap();
    let rect = appbar_rect_from_work_area(area, edge, height, false);
    assert_eq!((rect.top, rect.bottom), (1252, 1440));
  }

  #[test]
  fn a_report_kept_while_hidden_does_not_move_the_strip() {
    let current = AppBarState {
      mode: FullScreenMode::Hide,
      full_screen: Some(screen()),
      ..appbar_state(true, work_area())
    };
    let (_, _, area) = current.requested_position(42).unwrap();
    assert_eq!(area.bottom, 1380);
  }

  fn appbar_state(registered: bool, target_work_area: RECT) -> AppBarState {
    AppBarState {
      hwnd: 42,
      edge: DockEdge::Bottom,
      height: 188,
      target_work_area,
      registered,
      watching: true,
      positioning: false,
      transitioning: false,
      mode: FullScreenMode::None,
      full_screen: None,
    }
  }

  #[test]
  fn a_window_counts_as_full_screen_only_when_it_covers_the_monitor() {
    let monitor = RECT {
      left: 0,
      top: 0,
      right: 2560,
      bottom: 1440,
    };
    assert!(covers_monitor(monitor, monitor));
    assert!(covers_monitor(
      RECT {
        left: -8,
        top: -8,
        right: 2568,
        bottom: 1448
      },
      monitor
    ));
    assert!(!covers_monitor(
      RECT {
        left: 0,
        top: 0,
        right: 2560,
        bottom: 1392
      },
      monitor
    ));
    assert!(!covers_monitor(
      RECT {
        left: 2560,
        top: 0,
        right: 5120,
        bottom: 1440
      },
      monitor
    ));
  }

  #[test]
  fn the_desktop_is_never_a_full_screen_window() {
    assert!(is_desktop_class("Progman"));
    assert!(is_desktop_class("WorkerW"));
    assert!(!is_desktop_class("Chrome_WidgetWin_1"));
  }

  #[test]
  fn shell_starts_a_full_screen_report_only_where_one_is_seen() {
    assert!(reports_full_screen(true, true));
    assert!(!reports_full_screen(true, false));
    // Shell's "gone" is never second-guessed: a maximized window over an
    // auto-hidden taskbar covers the monitor without being full screen.
    assert!(!reports_full_screen(false, true));
  }

  #[test]
  fn a_full_screen_window_hides_or_fills_by_the_switch() {
    assert_eq!(full_screen_mode(false, true), FullScreenMode::None);
    assert_eq!(full_screen_mode(false, false), FullScreenMode::None);
    assert_eq!(full_screen_mode(true, true), FullScreenMode::Fill);
    assert_eq!(full_screen_mode(true, false), FullScreenMode::Hide);
  }

  fn screen() -> RECT {
    RECT {
      left: 0,
      top: 0,
      right: 2560,
      bottom: 1440,
    }
  }

  fn work_area() -> RECT {
    RECT {
      bottom: 1380,
      ..screen()
    }
  }

  #[test]
  fn a_filling_strip_lays_out_against_the_whole_monitor() {
    let area = strip_area(work_area(), Some(screen()));
    let rect = appbar_rect_from_work_area(area, DockEdge::Bottom, 188, false);
    assert_eq!((rect.top, rect.bottom), (1252, 1440));
    assert_eq!(strip_area(work_area(), None).bottom, 1380);
  }

  #[test]
  fn a_fill_area_on_another_monitor_is_ignored() {
    let other = RECT {
      left: 2560,
      right: 5120,
      ..screen()
    };
    assert_eq!(strip_area(work_area(), Some(other)).bottom, 1380);
  }

  fn window(left: i32, top: i32, right: i32, bottom: i32) -> StackedWindow {
    StackedWindow {
      rect: RECT {
        left,
        top,
        right,
        bottom,
      },
      topmost: false,
      ignored: false,
      desktop: false,
    }
  }

  #[test]
  fn the_first_ordinary_window_on_the_monitor_decides_full_screen() {
    let full = window(0, 0, 2560, 1440);
    let maximized = window(-8, -8, 2568, 1388);
    assert!(full_screen_in_z_order([full, maximized], screen()));
    assert!(!full_screen_in_z_order([maximized, full], screen()));
  }

  #[test]
  fn always_on_top_accessories_do_not_hide_a_full_screen_window() {
    let note = StackedWindow {
      topmost: true,
      ..window(100, 100, 400, 400)
    };
    assert!(full_screen_in_z_order(
      [note, window(0, 0, 2560, 1440)],
      screen()
    ));
  }

  #[test]
  fn plvs_windows_and_other_monitors_are_looked_past() {
    let own = StackedWindow {
      ignored: true,
      ..window(0, 1252, 2560, 1440)
    };
    let elsewhere = window(2560, 0, 5120, 1000);
    assert!(full_screen_in_z_order(
      [own, elsewhere, window(0, 0, 2560, 1440)],
      screen()
    ));
  }

  #[test]
  fn reaching_the_desktop_means_no_full_screen_window() {
    let desktop = StackedWindow {
      desktop: true,
      ..window(-2560, -1452, 4000, 1440)
    };
    assert!(!full_screen_in_z_order([desktop], screen()));
    assert!(!full_screen_in_z_order([], screen()));
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
      mode: FullScreenMode::None,
      full_screen: None,
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
      mode: FullScreenMode::None,
      full_screen: None,
    };

    assert!(current.requested_position(42).is_none());
    assert!(!current.should_notify_window_position_changed(42));
  }
}
