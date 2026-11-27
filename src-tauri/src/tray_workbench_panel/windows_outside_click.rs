use std::cell::{Cell, RefCell};
use std::ptr::null_mut;

use tauri::WebviewWindow;
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows_sys::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
use windows_sys::Win32::UI::WindowsAndMessaging::{
  CallNextHookEx, GetAncestor, IsWindowVisible, PostMessageW, SetWindowsHookExW,
  UnhookWindowsHookEx, WindowFromPoint, GA_ROOT, HHOOK, MSLLHOOKSTRUCT, WH_MOUSE_LL, WM_APP,
  WM_LBUTTONDOWN, WM_MBUTTONDOWN, WM_NCDESTROY, WM_RBUTTONDOWN, WM_SHOWWINDOW, WM_XBUTTONDOWN,
};

const OUTSIDE_CLICK_MESSAGE: u32 = WM_APP + 0x34;
const SUBCLASS_ID: usize = 0x504c5654;

#[derive(Clone, Copy)]
struct ClickWatch {
  panel: HWND,
  hook: HHOOK,
  presentation: usize,
}

// The subclass and low-level hook both run on the panel's owning thread.
thread_local! {
  static PANEL: RefCell<Option<WebviewWindow>> = const { RefCell::new(None) };
  static WATCH: Cell<ClickWatch> = const { Cell::new(ClickWatch {
    panel: null_mut(),
    hook: null_mut(),
    presentation: 0,
  }) };
}

pub(super) fn install(panel: &WebviewWindow) -> Result<(), String> {
  // Windows can show the panel without foreground focus, and some windows accept clicks
  // without activating. Observe presses for the lifetime of the visible panel.
  let window = panel.clone();
  panel
    .run_on_main_thread(move || {
      let Ok(hwnd) = window.hwnd() else {
        log::warn!("Tray panel has no HWND for outside-click dismissal");
        return;
      };
      unsafe {
        if SetWindowSubclass(hwnd.0, Some(subclass_proc), SUBCLASS_ID, 0) == 0 {
          log::warn!("Could not install the Tray panel outside-click subclass");
          return;
        }
        PANEL.set(Some(window));
        if IsWindowVisible(hwnd.0) != 0 {
          start_watch(hwnd.0);
        }
      }
    })
    .map_err(|error| error.to_string())
}

unsafe fn start_watch(panel: HWND) {
  let previous = WATCH.get();
  if !previous.hook.is_null() {
    return;
  }
  let hook = SetWindowsHookExW(WH_MOUSE_LL, Some(on_mouse), null_mut(), 0);
  if hook.is_null() {
    log::warn!(
      "Could not watch outside clicks for the Tray: {}",
      std::io::Error::last_os_error()
    );
    return;
  }
  WATCH.set(ClickWatch {
    panel,
    hook,
    presentation: previous.presentation.wrapping_add(1),
  });
}

unsafe fn stop_watch(panel: HWND) {
  let watch = WATCH.get();
  if watch.panel == panel {
    WATCH.set(ClickWatch {
      panel: null_mut(),
      hook: null_mut(),
      ..watch
    });
    UnhookWindowsHookEx(watch.hook);
  }
}

unsafe extern "system" fn subclass_proc(
  hwnd: HWND,
  message: u32,
  wparam: WPARAM,
  lparam: LPARAM,
  _id: usize,
  _data: usize,
) -> LRESULT {
  match message {
    WM_SHOWWINDOW if wparam != 0 => start_watch(hwnd),
    WM_SHOWWINDOW => stop_watch(hwnd),
    WM_NCDESTROY => {
      stop_watch(hwnd);
      RemoveWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID);
      PANEL.take();
    }
    OUTSIDE_CLICK_MESSAGE => {
      let watch = WATCH.get();
      // A queued click from the previous presentation must not dismiss a reopened panel.
      if watch.panel == hwnd && watch.presentation == wparam {
        let panel = PANEL.with_borrow(Clone::clone);
        if let Some(panel) = panel {
          // Keep Tao's visibility state in sync so the reused window can reopen.
          let _ = panel.hide();
        }
      }
      return 0;
    }
    _ => {}
  }
  DefSubclassProc(hwnd, message, wparam, lparam)
}

unsafe extern "system" fn on_mouse(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
  if code >= 0
    && matches!(
      wparam as u32,
      WM_LBUTTONDOWN | WM_RBUTTONDOWN | WM_MBUTTONDOWN | WM_XBUTTONDOWN
    )
  {
    let watch = WATCH.get();
    if let Some(event) = (lparam as *const MSLLHOOKSTRUCT).as_ref() {
      // Resolve WebView children to the panel HWND. Its window region covers both menus.
      if !watch.panel.is_null() && GetAncestor(WindowFromPoint(event.pt), GA_ROOT) != watch.panel {
        PostMessageW(watch.panel, OUTSIDE_CLICK_MESSAGE, watch.presentation, 0);
      }
    }
  }
  // Let the original recipient receive the click, including when it takes no focus.
  CallNextHookEx(null_mut(), code, wparam, lparam)
}
