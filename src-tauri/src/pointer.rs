//! Moves the operating-system pointer for Agent Control's tutorial recording.
//!
//! The pointer only travels: nothing here presses a button, scrolls or types (ADR 0043). The frontend
//! resolves a named PLVS target to a point in CSS pixels inside the main WebView; this module turns
//! that into screen coordinates and moves the pointer there along an eased path.

use std::time::{Duration, Instant};
use tauri::{Manager, Runtime, WebviewWindow};

#[cfg(any(target_os = "windows", target_os = "macos", test))]
const STEP: Duration = Duration::from_millis(8);
#[cfg(any(target_os = "windows", target_os = "macos", test))]
pub const MAX_DURATION_MS: u64 = 3000;

/// Ease-in-out cubic: a person's pointer accelerates out of rest and settles onto the target.
#[cfg(any(target_os = "windows", target_os = "macos", test))]
pub fn ease(progress: f64) -> f64 {
  let t = progress.clamp(0.0, 1.0);
  if t < 0.5 {
    4.0 * t * t * t
  } else {
    1.0 - (-2.0 * t + 2.0).powi(3) / 2.0
  }
}

/// The intermediate points of one move, ending exactly on the target.
#[cfg(any(target_os = "windows", target_os = "macos", test))]
pub fn path(from: (f64, f64), to: (f64, f64), duration_ms: u64) -> Vec<(f64, f64)> {
  let steps = (duration_ms.min(MAX_DURATION_MS) / STEP.as_millis() as u64).max(1);
  (1..=steps)
    .map(|step| {
      let k = ease(step as f64 / steps as f64);
      (from.0 + (to.0 - from.0) * k, from.1 + (to.1 - from.1) * k)
    })
    .collect()
}

/// Windows uses physical pixels, including the WebView's text scaling.
#[cfg(not(target_os = "macos"))]
fn screen_point<R: Runtime>(
  window: &WebviewWindow<R>,
  x: f64,
  y: f64,
  webview_scale: f64,
) -> Result<(f64, f64), String> {
  let inner = window
    .inner_position()
    .map_err(|error| format!("window position: {error}"))?;
  Ok((
    inner.x as f64 + x * webview_scale,
    inner.y as f64 + y * webview_scale,
  ))
}

/// Resolve the real native client origin rather than treating the window's top as the WebView top.
#[cfg(target_os = "macos")]
async fn screen_point<R: Runtime>(
  window: &WebviewWindow<R>,
  x: f64,
  y: f64,
) -> Result<(f64, f64), String> {
  unsafe extern "C" {
    fn plvs_macos_pointer_screen_point(
      webview: *mut std::ffi::c_void,
      x: f64,
      y: f64,
      result: *mut f64,
    ) -> bool;
  }
  let (sender, receiver) = std::sync::mpsc::sync_channel(1);
  window
    .with_webview(move |webview| {
      let mut point = [0.0; 2];
      let valid =
        unsafe { plvs_macos_pointer_screen_point(webview.inner(), x, y, point.as_mut_ptr()) };
      let _ = sender.send(if valid {
        Ok((point[0], point[1]))
      } else {
        Err("pointer WebView geometry unavailable".to_string())
      });
    })
    .map_err(|error| format!("pointer geometry: {error}"))?;
  tauri::async_runtime::spawn_blocking(move || receiver.recv_timeout(Duration::from_secs(2)))
    .await
    .map_err(|error| format!("pointer geometry: {error}"))?
    .map_err(|error| format!("pointer geometry: {error}"))?
}

#[tauri::command]
pub async fn move_pointer<R: Runtime>(
  window: WebviewWindow<R>,
  x: f64,
  y: f64,
  duration_ms: u64,
  webview_scale: Option<f64>,
  window_label: Option<String>,
) -> Result<(), String> {
  if !x.is_finite() || !y.is_finite() {
    return Err("pointer target must be finite".to_string());
  }
  // A Dock toolbar or editor target is measured in that WebView, so its own window places it.
  let label = window_label.unwrap_or_else(|| "main".to_string());
  if ![
    "main",
    crate::dock_accessories::DOCK_HEADER_LABEL,
    crate::dock_accessories::DOCK_EDITOR_LABEL,
    crate::dock_accessories::DOCK_SETTINGS_LABEL,
  ]
  .contains(&label.as_str())
  {
    return Err("pointer window is not a PLVS surface".to_string());
  }
  let window = window
    .app_handle()
    .get_webview_window(&label)
    .ok_or_else(|| format!("{label} window unavailable"))?;
  #[cfg(not(target_os = "macos"))]
  let scale = webview_scale
    .filter(|value| value.is_finite() && *value > 0.0)
    .unwrap_or(1.0);
  #[cfg(target_os = "macos")]
  let target = {
    let _ = webview_scale;
    screen_point(&window, x, y).await?
  };
  #[cfg(not(target_os = "macos"))]
  let target = screen_point(&window, x, y, scale)?;
  tauri::async_runtime::spawn_blocking(move || platform::travel(target, duration_ms))
    .await
    .map_err(|error| format!("pointer move: {error}"))?
}

#[cfg(target_os = "windows")]
mod platform {
  use super::{path, STEP};
  use std::time::Instant;
  use windows_sys::Win32::Foundation::POINT;
  use windows_sys::Win32::UI::WindowsAndMessaging::{GetCursorPos, SetCursorPos};

  pub fn travel(to: (f64, f64), duration_ms: u64) -> Result<(), String> {
    let mut start = POINT { x: 0, y: 0 };
    // SAFETY: GetCursorPos writes one POINT into memory owned by this frame.
    if unsafe { GetCursorPos(&mut start) } == 0 {
      return Err("pointer position unavailable".to_string());
    }
    let begun = Instant::now();
    for (index, point) in path((start.x as f64, start.y as f64), to, duration_ms)
      .into_iter()
      .enumerate()
    {
      // SAFETY: SetCursorPos takes plain integers; the system follows it with mouse-move messages.
      if unsafe { SetCursorPos(point.0.round() as i32, point.1.round() as i32) } == 0 {
        return Err("pointer move refused by the system".to_string());
      }
      super::pace(begun, index as u32 + 1, STEP);
    }
    Ok(())
  }
}

#[cfg(target_os = "macos")]
mod platform {
  use super::{path, STEP};
  use std::ffi::c_void;
  use std::time::Instant;

  #[repr(C)]
  #[derive(Clone, Copy)]
  struct CGPoint {
    x: f64,
    y: f64,
  }

  const MOUSE_MOVED: u32 = 5;
  const LEFT_BUTTON: u32 = 0;
  const HID_EVENT_TAP: u32 = 0;

  unsafe extern "C" {
    fn CGEventCreate(source: *const c_void) -> *mut c_void;
    fn CGEventGetLocation(event: *mut c_void) -> CGPoint;
    fn CGEventCreateMouseEvent(
      source: *const c_void,
      kind: u32,
      location: CGPoint,
      button: u32,
    ) -> *mut c_void;
    fn CGEventPost(tap: u32, event: *mut c_void);
    fn CGWarpMouseCursorPosition(point: CGPoint) -> i32;
    fn CFRelease(object: *const c_void);
  }

  fn current() -> CGPoint {
    // SAFETY: a null source creates a standalone event whose location is the pointer; released below.
    unsafe {
      let event = CGEventCreate(std::ptr::null());
      if event.is_null() {
        return CGPoint { x: 0.0, y: 0.0 };
      }
      let location = CGEventGetLocation(event);
      CFRelease(event);
      location
    }
  }

  fn place(point: CGPoint) -> Result<(), String> {
    // SAFETY: the warp moves the pointer without an event; the posted mouse-moved event is what the
    // WebView reads for hover. Posting needs Accessibility trust and is silently dropped without it.
    unsafe {
      if CGWarpMouseCursorPosition(point) != 0 {
        return Err("pointer move refused by the system".to_string());
      }
      let event = CGEventCreateMouseEvent(std::ptr::null(), MOUSE_MOVED, point, LEFT_BUTTON);
      if !event.is_null() {
        CGEventPost(HID_EVENT_TAP, event);
        CFRelease(event);
      }
    }
    Ok(())
  }

  pub fn travel(to: (f64, f64), duration_ms: u64) -> Result<(), String> {
    let start = current();
    let begun = Instant::now();
    for (index, point) in path((start.x, start.y), to, duration_ms)
      .into_iter()
      .enumerate()
    {
      place(CGPoint {
        x: point.0,
        y: point.1,
      })?;
      super::pace(begun, index as u32 + 1, STEP);
    }
    Ok(())
  }
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
mod platform {
  pub fn travel(_to: (f64, f64), _duration_ms: u64) -> Result<(), String> {
    Err("pointerUnavailable".to_string())
  }
}

/// Sleeps until step `index` is due, so a slow step does not stretch the whole move.
#[allow(dead_code)]
fn pace(begun: Instant, index: u32, step: Duration) {
  let due = step * index;
  let elapsed = begun.elapsed();
  if due > elapsed {
    std::thread::sleep(due - elapsed);
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn eases_from_rest_to_rest() {
    assert_eq!(ease(0.0), 0.0);
    assert_eq!(ease(1.0), 1.0);
    assert!((ease(0.5) - 0.5).abs() < 1e-12);
    assert!(ease(0.1) < 0.1 && ease(0.9) > 0.9);
  }

  #[test]
  fn ends_exactly_on_the_target_and_bounds_its_length() {
    let points = path((0.0, 0.0), (100.0, 50.0), 600);
    assert_eq!(points.len(), 75);
    assert_eq!(*points.last().unwrap(), (100.0, 50.0));
    assert_eq!(path((5.0, 5.0), (9.0, 9.0), 0), vec![(9.0, 9.0)]);
    assert_eq!(path((0.0, 0.0), (1.0, 1.0), 60_000).len(), 375);
  }
}

#[cfg(all(test, target_os = "macos"))]
mod macos_geometry_tests {
  unsafe extern "C" {
    fn plvs_macos_pointer_point_from_client(
      client: *const f64,
      x: f64,
      y: f64,
      primary_top: f64,
      result: *mut f64,
    );
  }

  #[test]
  fn framed_window_targets_start_below_the_native_title_bar() {
    // Outer frame top is 664; the visible WebView starts 28 points below it at 636.
    let mut result = [0.0; 2];
    unsafe {
      plvs_macos_pointer_point_from_client(
        [139.0, 38.0, 1001.0, 598.0].as_ptr(),
        943.0,
        22.0,
        720.0,
        result.as_mut_ptr(),
      );
    }
    assert_eq!(result, [1082.0, 106.0]);
  }

  #[test]
  fn frameless_dock_targets_keep_their_own_secondary_display_origin() {
    let mut result = [0.0; 2];
    unsafe {
      plvs_macos_pointer_point_from_client(
        [-1920.0, 200.0, 1920.0, 36.0].as_ptr(),
        1800.0,
        18.0,
        1080.0,
        result.as_mut_ptr(),
      );
    }
    assert_eq!(result, [-120.0, 862.0]);
  }
}
