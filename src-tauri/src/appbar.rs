use std::mem::size_of;
use std::sync::{Mutex, OnceLock};

use tauri::WebviewWindow;
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows_sys::Win32::Graphics::Gdi::{
  GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
use windows_sys::Win32::UI::Shell::{
  DefSubclassProc, RemoveWindowSubclass, SHAppBarMessage, SetWindowSubclass, ABE_BOTTOM, ABE_TOP,
  ABM_NEW, ABM_QUERYPOS, ABM_REMOVE, ABM_SETPOS, ABM_WINDOWPOSCHANGED, ABN_POSCHANGED, APPBARDATA,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
  MoveWindow, WM_APP, WM_NCDESTROY, WM_WINDOWPOSCHANGED,
};

use crate::dock::{DockEdge, DOCK_STRIP_LOGICAL_HEIGHT};

const APPBAR_CALLBACK_MESSAGE: u32 = WM_APP + 0x31;
const APPBAR_SUBCLASS_ID: usize = 0x504c5653;

#[derive(Clone, Copy)]
struct AppBarState {
  hwnd: isize,
  edge: DockEdge,
  height: i32,
  registered: bool,
}

static STATE: OnceLock<Mutex<AppBarState>> = OnceLock::new();

fn state() -> &'static Mutex<AppBarState> {
  STATE.get_or_init(|| {
    Mutex::new(AppBarState {
      hwnd: 0,
      edge: DockEdge::Bottom,
      height: 72,
      registered: false,
    })
  })
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

unsafe fn position(hwnd: HWND, edge: DockEdge, height: i32) -> Result<(), String> {
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

  let mut data = appbar_data(hwnd);
  data.uEdge = match edge {
    DockEdge::Top => ABE_TOP,
    DockEdge::Bottom => ABE_BOTTOM,
  };
  data.rc = info.rcMonitor;
  SHAppBarMessage(ABM_QUERYPOS, &mut data);
  match edge {
    DockEdge::Top => data.rc.bottom = data.rc.top + height,
    DockEdge::Bottom => data.rc.top = data.rc.bottom - height,
  }
  SHAppBarMessage(ABM_SETPOS, &mut data);
  if MoveWindow(
    hwnd,
    data.rc.left,
    data.rc.top,
    data.rc.right - data.rc.left,
    data.rc.bottom - data.rc.top,
    1,
  ) == 0
  {
    return Err("MoveWindow failed while positioning appbar".into());
  }
  Ok(())
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
    let requested = state().lock().ok().and_then(|current| {
      (current.registered && current.hwnd == hwnd as isize)
        .then_some((current.edge, current.height))
    });
    if let Some((edge, height)) = requested {
      let _ = position(hwnd, edge, height);
    }
    return 0;
  }
  if msg == WM_WINDOWPOSCHANGED {
    let registered = state()
      .lock()
      .map(|current| current.registered && current.hwnd == hwnd as isize)
      .unwrap_or(false);
    if registered {
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
  let hwnd = window.hwnd().map_err(|e| format!("hwnd: {e}"))?.0;
  let height = (DOCK_STRIP_LOGICAL_HEIGHT * window.scale_factor().unwrap_or(1.0)).round() as i32;
  let was_registered = {
    let mut current = state().lock().map_err(|_| "appbar state poisoned")?;
    let registered = current.registered;
    current.registered = false;
    registered
  };

  unsafe {
    if was_registered {
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
      if let Err(error) = position(hwnd, edge, height) {
        SHAppBarMessage(ABM_REMOVE, &mut data);
        if let Ok(mut current) = state().lock() {
          current.registered = false;
        }
        return Err(error);
      }
    }
  }
  Ok(())
}
