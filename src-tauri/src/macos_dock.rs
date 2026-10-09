//! Opt-in AX avoidance. Native code owns window identity and guarded recovery; this module
//! owns the process lease and invokes it under PLVS's own application identity.
use std::ffi::CString;

use tauri::{Emitter, Manager, WebviewWindow};

use crate::dock::{DockEdge, DockReservationLease};

unsafe extern "C" {
  fn plvs_macos_dock_reservation_set(
    window: *mut std::ffi::c_void,
    enabled: bool,
    top: bool,
    height: u32,
    path: *const std::ffi::c_char,
    prompt: bool,
  ) -> i32;
  fn plvs_macos_dock_reservation_recover(path: *const std::ffi::c_char) -> i32;
  fn plvs_macos_dock_reservation_active() -> bool;
}

fn checked(status: i32) -> Result<(), String> {
  match status {
    0 => Ok(()),
    1 => Err("Enable PLVS in System Settings > Privacy & Security > Accessibility, then enable Reserve Screen Space again.".into()),
    2 => Err("The Dock display is no longer available.".into()),
    _ => Err("Some windows could not be restored or their recovery journal could not be saved. Try again after returning those windows to the current desktop.".into()),
  }
}

pub fn stop() -> Result<(), String> {
  // No AppKit access on disable; safe from a Tauri command or the exit event.
  checked(unsafe {
    plvs_macos_dock_reservation_set(
      std::ptr::null_mut(),
      false,
      false,
      56,
      std::ptr::null(),
      false,
    )
  })
}

pub fn configure<R: tauri::Runtime>(
  window: &WebviewWindow<R>,
  enabled: bool,
  edge: DockEdge,
  monitor: Option<&str>,
  height: u32,
  prompt: bool,
) -> Result<bool, String> {
  let app = window.app_handle();
  let lease = app.state::<DockReservationLease>();
  stop()?;
  lease.release();
  if !enabled {
    return Ok(false);
  }
  let root = app
    .state::<crate::persistence::commands::PersistenceRuntime>()
    .identity_root()?;
  let monitor = monitor.unwrap_or("primary");
  let path = crate::dock::reservation_path(&root, monitor, DockEdge::Top).with_extension("json");
  let path = CString::new(path.to_string_lossy().as_bytes()).map_err(|e| e.to_string())?;
  let native = window.ns_window().map_err(|e| e.to_string())?;
  // AX journals cannot safely compose two independent owners restoring the same host frame.
  // macOS therefore has one owner per display, using the canonical Top lease for both edges.
  if !lease.acquire(&root, monitor, DockEdge::Top)? {
    return Ok(false);
  }
  let result = checked(unsafe {
    plvs_macos_dock_reservation_set(
      native,
      true,
      edge == DockEdge::Top,
      height,
      path.as_ptr(),
      prompt,
    )
  });
  if let Err(error) = result {
    lease.release();
    return Err(error);
  }
  Ok(true)
}

/// Recover only journals whose process lease is free. A live workbench's windows are never
/// restored by another instance. Permission checks here never prompt on launch.
pub fn recover<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
  use fs4::FileExt;
  let Ok(root) = app
    .state::<crate::persistence::commands::PersistenceRuntime>()
    .identity_root()
  else {
    return;
  };
  let Ok(files) = std::fs::read_dir(root.join("runtime/dock-reservations")) else {
    return;
  };
  for entry in files.flatten() {
    let path = entry.path();
    if path.extension().and_then(|s| s.to_str()) != Some("json") {
      continue;
    }
    let Ok(file) = std::fs::OpenOptions::new()
      .read(true)
      .write(true)
      .open(path.with_extension("lock"))
    else {
      continue;
    };
    if FileExt::try_lock(&file).is_err() {
      continue;
    }
    if let Ok(path) = CString::new(path.to_string_lossy().as_bytes()) {
      if let Err(error) = checked(unsafe { plvs_macos_dock_reservation_recover(path.as_ptr()) }) {
        log::warn!("Dock recovery deferred: {error}");
      }
    }
    let _ = FileExt::unlock(&file);
  }
}

pub fn watch<R: tauri::Runtime>(app: tauri::AppHandle<R>) {
  std::thread::spawn(move || loop {
    std::thread::sleep(std::time::Duration::from_secs(1));
    let Some(mut state) = crate::dock::read_dock_state(&app) else {
      continue;
    };
    if !state.enabled || !state.reserve_space {
      continue;
    }
    if app
      .get_webview_window("main")
      .is_none_or(|window| !window.is_visible().unwrap_or(false))
    {
      continue;
    }
    if unsafe { plvs_macos_dock_reservation_active() } {
      continue;
    }
    state.reserve_space = false;
    crate::dock::write_dock_state(&app, &state);
    // A revoked permission can leave adjusted windows and an in-memory journal behind.
    // Keep ownership until guarded recovery succeeds (or process exit releases the lock),
    // otherwise the old instance could later restore frames owned by a new instance.
    if stop().is_ok() {
      app.state::<DockReservationLease>().release();
    }
    let _ = app.emit("dock-reservation-lost", ());
  });
}
