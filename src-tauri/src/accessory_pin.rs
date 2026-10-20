//! Keeps the Dock accessory windows exactly where PLVS placed them.
//!
//! Under a top-edge AppBar, Windows moves a never-shown accessory down by its monitor's
//! work-area offset about 50 ms after its first show, outside any PLVS call, so the first
//! toolbar opened after launch lands one strip height below the strip. Only PLVS positions
//! these windows, so every other move or resize is turned back to the last rect PLVS set,
//! as the strip itself does in `appbar`.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use tauri::WebviewWindow;
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows_sys::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
use windows_sys::Win32::UI::WindowsAndMessaging::{WINDOWPOS, WM_NCDESTROY, WM_WINDOWPOSCHANGING};

use crate::appbar::enforce_window_position;
use crate::window_state::WindowBounds;

const PIN_SUBCLASS_ID: usize = 0x504c5656;

fn pins() -> &'static Mutex<HashMap<isize, RECT>> {
  static PINS: OnceLock<Mutex<HashMap<isize, RECT>>> = OnceLock::new();
  PINS.get_or_init(Default::default)
}

fn to_rect(bounds: WindowBounds) -> RECT {
  RECT {
    left: bounds.x,
    top: bounds.y,
    right: bounds.x + bounds.width as i32,
    bottom: bounds.y + bounds.height as i32,
  }
}

/// Must run on the thread that owns the window.
pub fn install<R: tauri::Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
  let hwnd = window.hwnd().map_err(|e| format!("hwnd: {e}"))?.0;
  if unsafe { SetWindowSubclass(hwnd, Some(subclass_proc), PIN_SUBCLASS_ID, 0) } == 0 {
    return Err("SetWindowSubclass failed".into());
  }
  Ok(())
}

/// Record the rect before moving the window there, so PLVS's own move is not reverted.
pub fn pin<R: tauri::Runtime>(window: &WebviewWindow<R>, bounds: WindowBounds) {
  let Ok(hwnd) = window.hwnd() else {
    return;
  };
  if let Ok(mut pins) = pins().lock() {
    pins.insert(hwnd.0 as isize, to_rect(bounds));
  }
}

unsafe extern "system" fn subclass_proc(
  hwnd: HWND,
  msg: u32,
  wparam: WPARAM,
  lparam: LPARAM,
  _id: usize,
  _ref_data: usize,
) -> LRESULT {
  if msg == WM_WINDOWPOSCHANGING {
    let pinned = pins()
      .lock()
      .ok()
      .and_then(|pins| pins.get(&(hwnd as isize)).copied());
    if let (Some(rect), Some(position)) = (pinned, (lparam as *mut WINDOWPOS).as_mut()) {
      enforce_window_position(position, rect);
    }
  } else if msg == WM_NCDESTROY {
    if let Ok(mut pins) = pins().lock() {
      pins.remove(&(hwnd as isize));
    }
    RemoveWindowSubclass(hwnd, Some(subclass_proc), PIN_SUBCLASS_ID);
  }
  DefSubclassProc(hwnd, msg, wparam, lparam)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn the_first_show_shift_returns_to_the_placed_rect() {
    // Measured at 125% on a 2560x1440 monitor at y=-1440 with a 94 px top strip.
    let placed = WindowBounds {
      x: 0,
      y: -1346,
      width: 2560,
      height: 45,
      is_maximized: false,
    };
    let mut position = WINDOWPOS {
      hwnd: std::ptr::null_mut(),
      hwndInsertAfter: std::ptr::null_mut(),
      x: 0,
      y: -1252,
      cx: 2560,
      cy: 47,
      flags: 0,
    };

    enforce_window_position(&mut position, to_rect(placed));

    assert_eq!(
      (position.x, position.y, position.cx, position.cy),
      (0, -1346, 2560, 45)
    );
  }
}
