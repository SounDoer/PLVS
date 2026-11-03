use std::mem::size_of;
use std::sync::atomic::{AtomicBool, AtomicPtr, Ordering};
use std::sync::{Mutex, OnceLock};

use tauri::{Emitter, Manager, WebviewWindow};
use windows_sys::core::BOOL;
use windows_sys::w;
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows_sys::Win32::Graphics::Dwm::{
  DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS,
};
use windows_sys::Win32::Graphics::Gdi::{
  GetMonitorInfoW, MonitorFromRect, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
use windows_sys::Win32::System::Threading::GetCurrentProcessId;
use windows_sys::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
use windows_sys::Win32::UI::Shell::{
  DefSubclassProc, RemoveWindowSubclass, SHAppBarMessage, SetWindowSubclass, ABE_BOTTOM, ABE_TOP,
  ABM_NEW, ABM_REMOVE, ABM_SETPOS, ABM_WINDOWPOSCHANGED, ABN_FULLSCREENAPP, ABN_POSCHANGED,
  APPBARDATA,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
  CallNextHookEx, EnumWindows, FindWindowExW, GetAncestor, GetClassNameW, GetWindowLongW,
  GetWindowRect, GetWindowThreadProcessId, IsIconic, IsWindowVisible, KillTimer, MoveWindow,
  SendMessageW, SetTimer, SetWindowsHookExW, ShowWindow, UnhookWindowsHookEx, WindowFromPoint,
  EVENT_SYSTEM_FOREGROUND, GA_ROOT, GWL_EXSTYLE, HHOOK, MSLLHOOKSTRUCT, SWP_NOMOVE, SWP_NOSIZE,
  SW_HIDE, SW_SHOWNOACTIVATE, WH_MOUSE_LL, WINDOWPOS, WINEVENT_OUTOFCONTEXT,
  WINEVENT_SKIPOWNPROCESS, WM_APP, WM_LBUTTONDOWN, WM_MBUTTONDOWN, WM_NCDESTROY, WM_RBUTTONDOWN,
  WM_TIMER, WM_WINDOWPOSCHANGED, WM_WINDOWPOSCHANGING, WM_XBUTTONDOWN, WS_EX_TOPMOST,
  WS_EX_TRANSPARENT,
};

use crate::dock::DockEdge;
use crate::window_state::MonitorRect;

const APPBAR_CALLBACK_MESSAGE: u32 = WM_APP + 0x31;
const APPLY_FULL_SCREEN_MESSAGE: u32 = WM_APP + 0x32;
const APPBAR_SUBCLASS_ID: usize = 0x504c5653;
const FULLSCREEN_POLL_TIMER_ID: usize = 0x504c5655;
const FULLSCREEN_POLL_MS: u32 = 500;
/// `APPLY_FULL_SCREEN_MESSAGE`'s wParam that looks for an unreported full-screen window first.
const LOOK_FOR_FULL_SCREEN: WPARAM = 1;

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

/// While the strip fills a full-screen monitor, a PLVS window taking the foreground makes Shell
/// end full screen and bring the taskbar back, moving the strip. The strip and the Dock toolbar
/// refuse activation then; the editors take text and keep it.
fn refuses_activation(mode: FullScreenMode) -> bool {
  mode == FullScreenMode::Fill
}

/// A toolbar opened from a filling strip holds no focus, so no blur closes it when the user clicks
/// the full-screen window again; the foreground does not change either. Watch clicks elsewhere for
/// as long as both hold.
fn watches_outside_clicks(mode: FullScreenMode, toolbar_visible: bool) -> bool {
  refuses_activation(mode) && toolbar_visible
}

fn is_button_press(message: u32) -> bool {
  matches!(
    message,
    WM_LBUTTONDOWN | WM_RBUTTONDOWN | WM_MBUTTONDOWN | WM_XBUTTONDOWN
  )
}

/// Whether the Dock's strip and toolbar refuse activation now.
pub fn dock_refuses_activation() -> bool {
  state()
    .lock()
    .map(|current| refuses_activation(current.mode))
    .unwrap_or(false)
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
  /// Set while a full-screen window is on the Dock's monitor.
  full_screen: Option<FullScreenReport>,
}

/// A full-screen window on the Dock's monitor, followed until it closes or stops covering the
/// monitor. Shell does not report it again when it returns from under another window, so the
/// report outlives the times it is covered.
#[derive(Clone, Copy)]
struct FullScreenReport {
  /// The Dock's monitor rect.
  monitor: RECT,
  window: isize,
  /// Another window is over it on the monitor, so the strip steps back for now.
  covered: bool,
}

impl PartialEq for FullScreenReport {
  fn eq(&self, other: &Self) -> bool {
    same_rect(self.monitor, other.monitor)
      && self.window == other.window
      && self.covered == other.covered
  }
}

impl std::fmt::Debug for FullScreenReport {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    let m = self.monitor;
    f.debug_struct("FullScreenReport")
      .field("monitor", &(m.left, m.top, m.right, m.bottom))
      .field("window", &self.window)
      .field("covered", &self.covered)
      .finish()
  }
}

impl AppBarState {
  fn receives_shell_notifications(&self, hwnd: isize) -> bool {
    (self.registered || self.watching) && self.hwnd == hwnd
  }

  fn fill_area(&self) -> Option<RECT> {
    self
      .full_screen
      .map(|report| report.monitor)
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
/// Tells the frontend the user went to another application; see `on_foreground_change` and
/// `on_mouse`.
static INTERACTION_ELSEWHERE: OnceLock<Box<dyn Fn() + Send + Sync>> = OnceLock::new();
/// Whether the Dock toolbar shows; the outside-click hook runs only while it does.
static TOOLBAR_VISIBLE: AtomicBool = AtomicBool::new(false);
static MOUSE_HOOK: AtomicPtr<core::ffi::c_void> = AtomicPtr::new(std::ptr::null_mut());
/// Sets whether the strip and the Dock toolbar accept activation. Through Tauri, so the window's
/// own style bookkeeping keeps WS_EX_NOACTIVATE when it rewrites the extended style.
static SET_DOCK_FOCUSABLE: OnceLock<Box<dyn Fn(bool) + Send + Sync>> = OnceLock::new();
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

/// Shell's taskbars. Shell drops a taskbar's topmost style before moving it under a full-screen
/// window, and notifies appbars in between, so one can sit above that window for a moment.
fn is_shell_taskbar_class(class: &str) -> bool {
  matches!(class, "Shell_TrayWnd" | "Shell_SecondaryTrayWnd")
}

/// What a window covers on screen. GetWindowRect includes the invisible resize border, which
/// reaches about 8 px into the neighbouring display for a maximized window; DWM's frame bounds do
/// not.
fn visible_bounds(window_rect: RECT, frame_bounds: Option<RECT>) -> RECT {
  frame_bounds.unwrap_or(window_rect)
}

#[derive(Clone, Copy)]
struct StackedWindow {
  hwnd: isize,
  rect: RECT,
  topmost: bool,
  /// PLVS's own windows, click-through overlays and Shell's taskbars, which say
  /// nothing about what the user is looking at.
  ignored: bool,
  desktop: bool,
}

/// Looking down the z-order at one monitor, past always-on-top windows that do
/// not cover it, is the first ordinary window full screen? Shell judges alike:
/// focusing the strip leaves the taskbar hidden, while raising any ordinary
/// window over the full-screen one brings it back. Answers with that window.
fn full_screen_window_in_z_order(
  windows: impl IntoIterator<Item = StackedWindow>,
  monitor: RECT,
) -> Option<isize> {
  for window in windows {
    if window.desktop {
      return None;
    }
    if window.ignored || !intersects(window.rect, monitor) {
      continue;
    }
    if covers_monitor(window.rect, monitor) {
      return Some(window.hwnd);
    }
    if !window.topmost {
      return None;
    }
  }
  None
}

/// Whether a followed window is still a full-screen window: shown, and either minimized, from
/// where it returns full screen, or covering the monitor.
fn keeps_full_screen(iconic: bool, visible: bool, bounds: Option<RECT>, monitor: RECT) -> bool {
  visible && (iconic || bounds.is_some_and(|bounds| covers_monitor(bounds, monitor)))
}

/// The report after a poll. Whichever full-screen window is on top owns it; without one, the
/// followed window keeps it for as long as it stays full screen. Where a taskbar shows Shell's
/// state, that state decides whether the strip steps back, so the strip takes the taskbar's place
/// exactly while Shell keeps it empty: a window from the neighbouring display over one corner
/// leaves Shell's full screen as it was, while going to another window on this monitor, even one
/// of PLVS's own below which the full-screen window is still first, ends it. Elsewhere the
/// z-order decides.
fn report_after_check(
  report: FullScreenReport,
  followed_keeps_full_screen: bool,
  on_top: Option<isize>,
  shell_full_screen: Option<bool>,
) -> Option<FullScreenReport> {
  if on_top.is_none() && !followed_keeps_full_screen {
    return None;
  }
  Some(FullScreenReport {
    window: on_top.unwrap_or(report.window),
    covered: match shell_full_screen {
      Some(full_screen) => !full_screen,
      None => on_top.is_none(),
    },
    ..report
  })
}

/// One of Shell's taskbars.
#[derive(Clone, Copy)]
struct Taskbar {
  rect: RECT,
  topmost: bool,
}

/// Shell's own full-screen state for a monitor, read from the taskbar there: Shell drops the
/// taskbar's topmost style and moves it under the full-screen window for as long as it treats the
/// monitor as full screen, wherever the foreground goes on other monitors. `None` where no
/// taskbar shows on the monitor.
fn taskbar_shows_full_screen(
  taskbars: impl IntoIterator<Item = Taskbar>,
  monitor: RECT,
) -> Option<bool> {
  taskbars
    .into_iter()
    .find(|taskbar| intersects(taskbar.rect, monitor))
    .map(|taskbar| !taskbar.topmost)
}

/// A report started without Shell's notification, which Shell sends only when its state changes:
/// the strip began watching after a full-screen window had already taken the monitor. Shell's
/// state decides, because entering Dock by clicking PLVS over that window ends full screen while
/// the window stays first below PLVS.
fn report_without_notification(
  monitor: RECT,
  shell_full_screen: Option<bool>,
  on_top: Option<isize>,
) -> Option<FullScreenReport> {
  on_top
    .filter(|_| shell_full_screen == Some(true))
    .map(|window| FullScreenReport {
      monitor,
      window,
      covered: false,
    })
}

unsafe fn shell_full_screen_on(monitor: RECT) -> Option<bool> {
  let mut taskbars = Vec::new();
  for class in [w!("Shell_TrayWnd"), w!("Shell_SecondaryTrayWnd")] {
    let mut hwnd: HWND = std::ptr::null_mut();
    loop {
      hwnd = FindWindowExW(std::ptr::null_mut(), hwnd, class, std::ptr::null());
      if hwnd.is_null() {
        break;
      }
      let mut rect = RECT::default();
      if IsWindowVisible(hwnd) != 0 && GetWindowRect(hwnd, &mut rect) != 0 {
        taskbars.push(Taskbar {
          rect,
          topmost: GetWindowLongW(hwnd, GWL_EXSTYLE) as u32 & WS_EX_TOPMOST != 0,
        });
      }
    }
  }
  taskbar_shows_full_screen(taskbars, monitor)
}

/// What a window covers on screen, from DWM's frame bounds where it has them.
unsafe fn window_bounds(hwnd: HWND) -> Option<RECT> {
  let mut rect = RECT::default();
  if GetWindowRect(hwnd, &mut rect) == 0 {
    return None;
  }
  let mut frame = RECT::default();
  let frame = (DwmGetWindowAttribute(
    hwnd,
    DWMWA_EXTENDED_FRAME_BOUNDS as u32,
    (&mut frame as *mut RECT).cast(),
    size_of::<RECT>() as u32,
  ) == 0)
    .then_some(frame);
  Some(visible_bounds(rect, frame))
}

unsafe fn followed_window_keeps_full_screen(report: FullScreenReport) -> bool {
  let hwnd = report.window as HWND;
  keeps_full_screen(
    IsIconic(hwnd) != 0,
    IsWindowVisible(hwnd) != 0,
    window_bounds(hwnd),
    report.monitor,
  )
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
  let rect = window_bounds(hwnd)?;
  let mut owner = 0u32;
  GetWindowThreadProcessId(hwnd, &mut owner);
  let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
  let mut class = [0u16; 64];
  let length = GetClassNameW(hwnd, class.as_mut_ptr(), class.len() as i32);
  let class = String::from_utf16_lossy(&class[..length.max(0) as usize]);
  Some(StackedWindow {
    hwnd: hwnd as isize,
    rect,
    topmost: ex_style & WS_EX_TOPMOST != 0,
    ignored: owner == process
      || ex_style & WS_EX_TRANSPARENT != 0
      || is_shell_taskbar_class(&class),
    desktop: is_desktop_class(&class),
  })
}

unsafe extern "system" fn collect_window(hwnd: HWND, windows: LPARAM) -> BOOL {
  (*(windows as *mut Vec<HWND>)).push(hwnd);
  1
}

/// The full-screen window that owns `monitor` now, if any. EnumWindows walks
/// the z-order from the top.
unsafe fn full_screen_window_on(monitor: RECT) -> Option<isize> {
  let mut windows: Vec<HWND> = Vec::new();
  if EnumWindows(
    Some(collect_window),
    &mut windows as *mut Vec<HWND> as LPARAM,
  ) == 0
  {
    return None;
  }
  let process = GetCurrentProcessId();
  full_screen_window_in_z_order(
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
  let window = monitor
    .filter(|_| full_screen)
    .and_then(|monitor| full_screen_window_on(monitor));
  let seen = window.is_some();
  let reported = reports_full_screen(full_screen, seen);
  let area = monitor.map(|m| (m.left, m.top, m.right, m.bottom));
  log::info!(
    "dock fullscreen notification: fullscreen={full_screen} on dock monitor={seen} monitor={area:?}"
  );
  if let Ok(mut current) = state().lock() {
    current.full_screen = monitor
      .zip(window)
      .filter(|_| reported)
      .map(|(monitor, window)| FullScreenReport {
        monitor,
        window,
        covered: false,
      });
  }
  apply_full_screen(hwnd);
}

/// Shell never reports a full-screen window gone to a registration made while
/// it was open, nor reports one again when it returns from under another
/// window, so the strip checks for itself while a report stands.
unsafe fn check_full_screen_report(hwnd: HWND) {
  let Some(report) = state().lock().ok().and_then(|current| current.full_screen) else {
    return;
  };
  let next = report_after_check(
    report,
    followed_window_keeps_full_screen(report),
    full_screen_window_on(report.monitor),
    shell_full_screen_on(report.monitor),
  );
  if next == Some(report) {
    return;
  }
  match next {
    None => log::info!("dock full-screen window gone without a notification"),
    Some(next) if next.covered => log::info!("dock full-screen window covered"),
    Some(_) => log::info!("dock full-screen window on top"),
  }
  if let Ok(mut current) = state().lock() {
    current.full_screen = next;
  }
  apply_full_screen(hwnd);
}

/// Start a report Shell will not send: the strip began watching, or moved to a monitor, after a
/// full-screen window had already taken it. Only then: right after Shell reports full screen gone,
/// its taskbar may not be topmost yet.
unsafe fn look_for_unreported_full_screen(hwnd: HWND) {
  let Some(monitor) = dock_monitor() else {
    return;
  };
  let unreported = state().lock().is_ok_and(|current| {
    current.receives_shell_notifications(hwnd as isize)
      && current
        .full_screen
        .is_none_or(|report| !same_rect(report.monitor, monitor))
  });
  if !unreported {
    return;
  }
  // The taskbar first: it is cheap, and settles the common case of no full screen at all.
  let shell_full_screen = shell_full_screen_on(monitor);
  if shell_full_screen != Some(true) {
    return;
  }
  let Some(report) =
    report_without_notification(monitor, shell_full_screen, full_screen_window_on(monitor))
  else {
    return;
  };
  log::info!("dock full-screen window found without a notification");
  if let Ok(mut current) = state().lock() {
    current.full_screen = Some(report);
  }
}

/// Bring the strip in line with the full-screen report and the switch. Runs on
/// the window's thread, which serialises it with Shell's notifications and the
/// backstop timer.
unsafe fn apply_full_screen(hwnd: HWND) {
  let monitor = dock_monitor();
  let Some((before, after, reported)) = state().lock().ok().map(|mut current| {
    let on_dock_monitor = match (current.full_screen, monitor) {
      (Some(report), Some(monitor)) => same_rect(report.monitor, monitor),
      _ => false,
    };
    if current.full_screen.is_some() && !on_dock_monitor {
      // The Dock has moved off the monitor the report was for.
      current.full_screen = None;
    }
    let present = current.full_screen.is_some_and(|report| !report.covered)
      && current.receives_shell_notifications(hwnd as isize);
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
  sync_outside_click_watch(after);
  if before == after {
    return;
  }
  log::info!("dock full-screen mode: {before:?} -> {after:?}");
  if (before == FullScreenMode::Fill) != (after == FullScreenMode::Fill) {
    relayout(hwnd);
    if let Some(set_focusable) = SET_DOCK_FOCUSABLE.get() {
      set_focusable(!refuses_activation(after));
    }
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

/// Re-apply on the window's thread after looking for a full-screen window Shell will not report.
fn request_full_screen_look(hwnd: HWND) {
  unsafe { SendMessageW(hwnd, APPLY_FULL_SCREEN_MESSAGE, LOOK_FOR_FULL_SCREEN, 0) };
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
    if wparam == LOOK_FOR_FULL_SCREEN {
      look_for_unreported_full_screen(hwnd);
    }
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

fn report_interaction_elsewhere() {
  if let Some(report) = INTERACTION_ELSEWHERE.get() {
    report();
  }
}

/// Install or remove the outside-click hook. Runs on the strip's thread, whose message loop the
/// low-level hook reports on.
unsafe fn sync_outside_click_watch(mode: FullScreenMode) {
  let wanted = watches_outside_clicks(mode, TOOLBAR_VISIBLE.load(Ordering::Relaxed));
  let installed = MOUSE_HOOK.load(Ordering::Relaxed);
  if wanted && installed.is_null() {
    let hook = SetWindowsHookExW(WH_MOUSE_LL, Some(on_mouse), std::ptr::null_mut(), 0);
    if hook.is_null() {
      log::warn!("dock outside-click hook could not be installed");
    } else {
      log::info!("dock outside-click hook installed");
    }
    MOUSE_HOOK.store(hook, Ordering::Relaxed);
  } else if !wanted && !installed.is_null() {
    UnhookWindowsHookEx(installed as HHOOK);
    MOUSE_HOOK.store(std::ptr::null_mut(), Ordering::Relaxed);
    log::info!("dock outside-click hook removed");
  }
}

/// Reports a press outside every PLVS window. Never consumes the input.
unsafe extern "system" fn on_mouse(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
  if code >= 0 && is_button_press(wparam as u32) {
    if let Some(event) = (lparam as *const MSLLHOOKSTRUCT).as_ref() {
      let root = GetAncestor(WindowFromPoint(event.pt), GA_ROOT);
      let mut owner = 0u32;
      GetWindowThreadProcessId(root, &mut owner);
      if owner != GetCurrentProcessId() {
        report_interaction_elsewhere();
      }
    }
  }
  CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
}

/// Record whether the Dock toolbar shows, and start or stop watching clicks elsewhere.
pub fn set_dock_toolbar_visible<R: tauri::Runtime>(window: &WebviewWindow<R>, visible: bool) {
  TOOLBAR_VISIBLE.store(visible, Ordering::Relaxed);
  if let Ok(hwnd) = window.hwnd() {
    request_full_screen_apply(hwnd.0);
  }
}

/// A filling strip refuses activation, so a toolbar opened from it never holds focus and the
/// frontend's blur rule cannot close it. Report another process taking the foreground instead.
unsafe extern "system" fn on_foreground_change(
  _hook: HWINEVENTHOOK,
  _event: u32,
  _hwnd: HWND,
  _object: i32,
  _child: i32,
  _thread: u32,
  _time: u32,
) {
  let filling = state()
    .lock()
    .map(|current| current.mode == FullScreenMode::Fill)
    .unwrap_or(false);
  if filling {
    report_interaction_elsewhere();
  }
}

/// Must run on the thread that owns the window: the foreground hook reports on it.
pub fn install_window_subclass<R: tauri::Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
  let hwnd = window.hwnd().map_err(|e| format!("hwnd: {e}"))?.0;
  let installed = unsafe { SetWindowSubclass(hwnd, Some(subclass_proc), APPBAR_SUBCLASS_ID, 0) };
  if installed == 0 {
    return Err("SetWindowSubclass failed".into());
  }
  let app = window.app_handle().clone();
  let _ = INTERACTION_ELSEWHERE.set(Box::new(move || {
    let _ = app.emit("dock-interaction-elsewhere", ());
  }));
  let app = window.app_handle().clone();
  let _ = SET_DOCK_FOCUSABLE.set(Box::new(move |focusable| {
    for label in ["main", crate::dock_accessories::DOCK_HEADER_LABEL] {
      if let Some(window) = app.get_webview_window(label) {
        let _ = window.set_focusable(focusable);
      }
    }
  }));
  // Skipping PLVS's own windows leaves only other applications taking the foreground.
  let hook = unsafe {
    SetWinEventHook(
      EVENT_SYSTEM_FOREGROUND,
      EVENT_SYSTEM_FOREGROUND,
      std::ptr::null_mut(),
      Some(on_foreground_change),
      0,
      0,
      WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
    )
  };
  if hook.is_null() {
    log::warn!("dock foreground hook could not be installed");
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
  if enabled {
    // Entering or resuming Dock, or moving it to another monitor or edge.
    request_full_screen_look(hwnd);
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
  use windows_sys::Win32::UI::WindowsAndMessaging::{WM_LBUTTONUP, WM_MOUSEMOVE};

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
      full_screen: Some(report(false)),
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
      full_screen: Some(report(false)),
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
  fn outside_clicks_are_watched_only_for_a_toolbar_over_a_full_screen_window() {
    assert!(watches_outside_clicks(FullScreenMode::Fill, true));
    assert!(!watches_outside_clicks(FullScreenMode::Fill, false));
    assert!(!watches_outside_clicks(FullScreenMode::None, true));
    assert!(!watches_outside_clicks(FullScreenMode::Hide, true));
  }

  #[test]
  fn any_button_press_counts_as_a_click_elsewhere() {
    for message in [
      WM_LBUTTONDOWN,
      WM_RBUTTONDOWN,
      WM_MBUTTONDOWN,
      WM_XBUTTONDOWN,
    ] {
      assert!(is_button_press(message));
    }
    assert!(!is_button_press(WM_LBUTTONUP));
    assert!(!is_button_press(WM_MOUSEMOVE));
  }

  #[test]
  fn only_a_filling_strip_refuses_activation() {
    assert!(refuses_activation(FullScreenMode::Fill));
    assert!(!refuses_activation(FullScreenMode::None));
    assert!(!refuses_activation(FullScreenMode::Hide));
  }

  #[test]
  fn a_maximized_window_next_door_does_not_reach_this_monitor() {
    // A maximized window on the display below reports its invisible resize border 9 px into
    // this one; DWM's frame bounds stop at its own display.
    let with_border = RECT {
      left: -9,
      top: 1431,
      right: 2569,
      bottom: 2829,
    };
    let frame = RECT {
      left: 0,
      top: 1440,
      right: 2560,
      bottom: 2820,
    };
    assert_eq!(visible_bounds(with_border, Some(frame)).top, 1440);
    assert_eq!(visible_bounds(with_border, None).top, 1431);
    let neighbour = StackedWindow {
      rect: visible_bounds(with_border, Some(frame)),
      ..window(0, 0, 0, 0)
    };
    assert!(full_screen_in_z_order(
      [neighbour, window(0, 0, 2560, 1440)],
      screen()
    ));
  }

  #[test]
  fn shell_taskbars_are_looked_past() {
    // Shell drops a taskbar's topmost style before moving it under the full-screen window, and
    // notifies appbars in between.
    assert!(is_shell_taskbar_class("Shell_TrayWnd"));
    assert!(is_shell_taskbar_class("Shell_SecondaryTrayWnd"));
    assert!(!is_shell_taskbar_class("Chrome_WidgetWin_1"));
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

  fn full_screen_in_z_order(
    windows: impl IntoIterator<Item = StackedWindow>,
    monitor: RECT,
  ) -> bool {
    full_screen_window_in_z_order(windows, monitor).is_some()
  }

  fn window(left: i32, top: i32, right: i32, bottom: i32) -> StackedWindow {
    StackedWindow {
      hwnd: 0,
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
  fn the_covering_window_is_the_one_a_report_follows() {
    let full = StackedWindow {
      hwnd: 7,
      ..window(0, 0, 2560, 1440)
    };
    let note = StackedWindow {
      hwnd: 3,
      topmost: true,
      ..window(100, 100, 400, 400)
    };
    assert_eq!(
      full_screen_window_in_z_order([note, full], screen()),
      Some(7)
    );
    assert_eq!(
      full_screen_window_in_z_order([window(0, 0, 900, 900), full], screen()),
      None
    );
  }

  fn report(covered: bool) -> FullScreenReport {
    FullScreenReport {
      monitor: screen(),
      window: 7,
      covered,
    }
  }

  #[test]
  fn shell_showing_the_taskbar_again_steps_the_strip_back() {
    // The user went to another window on this monitor, an editor of PLVS's own included: Shell
    // ended full screen though the full-screen window may still be first below PLVS. The report
    // stays, because Shell does not report the window again when the user returns to it.
    assert_eq!(
      report_after_check(report(false), true, None, Some(false)),
      Some(report(true))
    );
    assert_eq!(
      report_after_check(report(false), true, Some(7), Some(false)),
      Some(report(true))
    );
    assert_eq!(
      report_after_check(report(true), true, Some(7), Some(true)),
      Some(report(false))
    );
  }

  #[test]
  fn a_covered_full_screen_window_still_fills_while_shell_hides_the_taskbar() {
    // A window from the neighbouring display over one corner leaves Shell's full screen in place,
    // and the taskbar's place empty.
    assert_eq!(
      report_after_check(report(false), true, None, Some(true)),
      Some(report(false))
    );
  }

  #[test]
  fn without_a_taskbar_the_z_order_decides_whether_it_is_covered() {
    assert_eq!(
      report_after_check(report(false), true, None, None),
      Some(report(true))
    );
    assert_eq!(
      report_after_check(report(true), true, Some(7), None),
      Some(report(false))
    );
  }

  #[test]
  fn a_report_ends_when_its_window_stops_being_full_screen() {
    assert_eq!(report_after_check(report(false), false, None, None), None);
    assert_eq!(
      report_after_check(report(true), false, None, Some(true)),
      None
    );
  }

  fn taskbar(rect: RECT, topmost: bool) -> Taskbar {
    Taskbar { rect, topmost }
  }

  #[test]
  fn shell_full_screen_is_read_from_the_monitors_taskbar() {
    let here = RECT {
      top: 1392,
      ..screen()
    };
    let elsewhere = RECT {
      left: 2560,
      right: 5120,
      ..here
    };
    assert_eq!(
      taskbar_shows_full_screen([taskbar(elsewhere, false), taskbar(here, true)], screen()),
      Some(false)
    );
    assert_eq!(
      taskbar_shows_full_screen([taskbar(elsewhere, true), taskbar(here, false)], screen()),
      Some(true)
    );
    assert_eq!(
      taskbar_shows_full_screen([taskbar(elsewhere, false)], screen()),
      None
    );
  }

  #[test]
  fn a_report_starts_without_a_notification_only_when_shell_agrees() {
    let started = report_without_notification(screen(), Some(true), Some(7));
    assert_eq!(started, Some(report(false)));
    // The user clicked PLVS over the full-screen window to enter Dock: Shell ended full screen
    // and the taskbar is back, though the full-screen window is still the first one below PLVS.
    assert_eq!(
      report_without_notification(screen(), Some(false), Some(7)),
      None
    );
    // Without a taskbar there, only Shell's notification starts a report.
    assert_eq!(report_without_notification(screen(), None, Some(7)), None);
    assert_eq!(
      report_without_notification(screen(), Some(true), None),
      None
    );
  }

  #[test]
  fn another_full_screen_window_on_top_takes_over_the_report() {
    let next = FullScreenReport {
      window: 9,
      ..report(false)
    };
    assert_eq!(
      report_after_check(report(true), false, Some(9), Some(true)),
      Some(next)
    );
  }

  #[test]
  fn a_minimized_full_screen_window_is_still_followed() {
    let windowed = RECT {
      right: 1280,
      ..screen()
    };
    assert!(keeps_full_screen(true, true, None, screen()));
    assert!(keeps_full_screen(false, true, Some(screen()), screen()));
    assert!(!keeps_full_screen(false, true, Some(windowed), screen()));
    assert!(!keeps_full_screen(false, false, Some(screen()), screen()));
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
