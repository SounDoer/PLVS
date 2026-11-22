//! Reveal a PLVS window so its WebView renders again, without taking keyboard focus.
//!
//! A WebView stops producing animation frames while its window is hidden, minimized or fully
//! covered, so Agent Control visual capture cannot settle. Activating PLVS would fix that but
//! interrupts whatever the user is typing into. Each platform therefore uses its native
//! "show without activating" primitive, the same ones the Dock already relies on:
//! `orderFrontRegardless` on macOS, `SW_SHOWNOACTIVATE` + `SWP_NOACTIVATE` on Windows, and
//! `focus-on-map=false` + `gdk_window_raise` on Linux. Window managers may still decline the
//! raise (notably Wayland compositors); focus is never requested.

use std::sync::atomic::Ordering;
use tauri::{Manager, Runtime, WebviewWindow};

/// Restores a minimized window and, when `raise` is set, orders it above other windows.
pub fn reveal_without_focus<R: Runtime>(
  window: &WebviewWindow<R>,
  raise: bool,
) -> Result<(), String> {
  let docked = window
    .try_state::<crate::dock::DockedFlag>()
    .is_some_and(|flag| flag.0.load(Ordering::Relaxed));
  if docked {
    // The Dock lifecycle owns a docked strip's visibility (Space gate, full-screen suspension).
    // macOS exposes a reveal that honours those gates; elsewhere the strip is left alone.
    #[cfg(target_os = "macos")]
    return crate::macos_dock_window::reveal(window);
    #[cfg(not(target_os = "macos"))]
    return Ok(());
  }
  let target = window.clone();
  window
    .run_on_main_thread(move || {
      if let Err(error) = reveal_on_main(&target, raise) {
        log::warn!("reveal without focus failed: {error}");
      }
    })
    .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
fn reveal_on_main<R: Runtime>(window: &WebviewWindow<R>, raise: bool) -> Result<(), String> {
  extern "C" {
    fn plvs_macos_reveal_without_focus(window: *mut std::ffi::c_void, raise: bool);
  }
  let raw = window.ns_window().map_err(|error| error.to_string())?;
  unsafe { plvs_macos_reveal_without_focus(raw as *mut _, raise) };
  Ok(())
}

#[cfg(target_os = "windows")]
fn reveal_on_main<R: Runtime>(window: &WebviewWindow<R>, raise: bool) -> Result<(), String> {
  use windows_sys::Win32::UI::WindowsAndMessaging::{
    IsIconic, IsWindowVisible, SetWindowPos, ShowWindow, HWND_TOP, SWP_NOACTIVATE, SWP_NOMOVE,
    SWP_NOSIZE, SWP_SHOWWINDOW, SW_SHOWNOACTIVATE,
  };
  let hwnd = window.hwnd().map_err(|error| error.to_string())?.0;
  unsafe {
    if IsIconic(hwnd) != 0 || IsWindowVisible(hwnd) == 0 {
      // Restores a minimized window to its previous placement; the active window stays active.
      ShowWindow(hwnd, SW_SHOWNOACTIVATE);
    }
    if !raise {
      return Ok(());
    }
    SetWindowPos(
      hwnd,
      HWND_TOP,
      0,
      0,
      0,
      0,
      SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
    );
  }
  Ok(())
}

#[cfg(target_os = "linux")]
fn reveal_on_main<R: Runtime>(window: &WebviewWindow<R>, raise: bool) -> Result<(), String> {
  use gtk::prelude::*;
  let gtk = window.gtk_window().map_err(|error| error.to_string())?;
  let focus_on_map = gtk.gets_focus_on_map();
  gtk.set_focus_on_map(false);
  gtk.deiconify();
  gtk.show();
  if raise {
    if let Some(gdk) = gtk.window() {
      gdk.raise();
    }
  }
  gtk.set_focus_on_map(focus_on_map);
  Ok(())
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn reveal_on_main<R: Runtime>(_window: &WebviewWindow<R>, _raise: bool) -> Result<(), String> {
  Ok(())
}
