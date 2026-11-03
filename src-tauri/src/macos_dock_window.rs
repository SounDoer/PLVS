//! Panel presentation and Space membership. AppKit remains on main; React owns UI dismissal.
use std::sync::{mpsc, OnceLock};

use tauri::{Emitter, Manager, WebviewWindow};

use crate::dock::DockEdge;
use tauri_nspanel::objc2_app_kit::NSWindowStyleMask;
use tauri_nspanel::{ManagerExt, WebviewWindowExt};

tauri_nspanel::tauri_panel!(PlvsDockPanel {
  config: { can_become_key_window: true, can_become_main_window: false }
});

static REPORT: OnceLock<Box<dyn Fn(i32) + Send + Sync>> = OnceLock::new();

unsafe extern "C" {
  fn plvs_macos_window_on_main() -> bool;
  fn plvs_macos_dock_saved_chrome(window: *mut std::ffi::c_void) -> i32;
  fn plvs_macos_dock_boot_chrome(window: *mut std::ffi::c_void, policy: u8);
  fn plvs_macos_dock_remember_chrome(window: *mut std::ffi::c_void);
  fn plvs_macos_dock_restore_chrome(window: *mut std::ffi::c_void);
  fn plvs_macos_after_window_updates(
    callback: extern "C" fn(*mut std::ffi::c_void),
    context: *mut std::ffi::c_void,
  );
  fn plvs_macos_dock_window_configure(
    window: *mut std::ffi::c_void,
    enabled: bool,
    top: bool,
    height: f64,
    above: bool,
    report: extern "C" fn(i32),
  ) -> i32;
  fn plvs_macos_dock_accessory_configure(window: *mut std::ffi::c_void, role: i32) -> i32;
  fn plvs_macos_dock_window_present(window: *mut std::ffi::c_void, visible: bool, focus: bool);
  fn plvs_macos_dock_window_reveal(window: *mut std::ffi::c_void);
  fn plvs_macos_dock_window_normal(window: *mut std::ffi::c_void);
}

extern "C" fn report(kind: i32) {
  if let Some(callback) = REPORT.get() {
    callback(kind);
  }
}

fn on_main<R, T, F>(window: &WebviewWindow<R>, action: F) -> Result<T, String>
where
  R: tauri::Runtime,
  T: Send + 'static,
  F: FnOnce(usize) -> Result<T, String> + Send + 'static,
{
  let raw = window.ns_window().map_err(|error| error.to_string())? as usize;
  if unsafe { plvs_macos_window_on_main() } {
    return action(raw);
  }
  let (send, receive) = mpsc::sync_channel(1);
  window
    .run_on_main_thread(move || {
      let _ = send.send(action(raw));
    })
    .map_err(|error| error.to_string())?;
  receive.recv().map_err(|error| error.to_string())?
}

/// Drain Tao's deferred style updates before swapping classes or restoring content geometry.
/// Boot runs on main with its final decorations already set by the builder; it must never wait.
pub fn settle<R: tauri::Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
  if unsafe { plvs_macos_window_on_main() } {
    return Ok(());
  }
  extern "C" fn complete(context: *mut std::ffi::c_void) {
    let send = unsafe { Box::from_raw(context.cast::<mpsc::SyncSender<()>>()) };
    let _ = send.send(());
  }
  let (send, receive) = mpsc::sync_channel(1);
  window
    .run_on_main_thread(move || unsafe {
      plvs_macos_after_window_updates(complete, Box::into_raw(Box::new(send)).cast());
    })
    .map_err(|e| e.to_string())?;
  receive.recv().map_err(|e| e.to_string())
}

fn panel<R: tauri::Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
  settle(window)?;
  let target = window.clone();
  on_main(window, move |_| {
    if target
      .app_handle()
      .get_webview_panel(target.label())
      .is_err()
    {
      let panel = target
        .to_panel::<PlvsDockPanel<R>>()
        .map_err(|e| e.to_string())?;
      panel.set_hides_on_deactivate(false);
      panel.set_released_when_closed(false);
      // Keep Tao's delegate: replacing it would lose close, move and resize delivery.
      if let Err(error) = panel.add_style_mask(NSWindowStyleMask::NonactivatingPanel) {
        panel.to_window();
        return Err(error.to_string());
      }
    }
    Ok(())
  })
}

/// Restore Tao's original dynamic class before any normal-mode window operations.
pub fn restore_host<R: tauri::Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
  settle(window)?;
  let target = window.clone();
  on_main(window, move |raw| {
    if let Ok(panel) = target.app_handle().get_webview_panel(target.label()) {
      // Also used by enter rollback: stop native timers/Space ownership before restoring Tao.
      unsafe {
        plvs_macos_dock_window_configure(raw as *mut _, false, false, 150.0, true, report);
      }
      panel
        .set_style_mask(panel.as_panel().styleMask() & !NSWindowStyleMask::NonactivatingPanel)
        .map_err(|e| e.to_string())?;
      panel
        .to_window()
        .ok_or("Unable to restore the macOS window host.")?;
    }
    Ok(())
  })
}

/// Boot must restore the normal host's policy, not the newly built strip's defaults.
pub fn remember_boot_chrome<R: tauri::Runtime>(
  window: &WebviewWindow<R>,
  policy: u8,
) -> Result<(), String> {
  on_main(window, move |raw| {
    unsafe { plvs_macos_dock_boot_chrome(raw as *mut _, policy) };
    Ok(())
  })
}

pub fn saved_chrome<R: tauri::Runtime>(window: &WebviewWindow<R>) -> Result<Option<u8>, String> {
  on_main(window, move |raw| {
    let policy = unsafe { plvs_macos_dock_saved_chrome(raw as *mut _) };
    Ok(u8::try_from(policy).ok().filter(|policy| *policy <= 3))
  })
}

/// Capture ordinary content policy before Tao's Dock decoration changes discard it.
pub fn remember_chrome<R: tauri::Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
  settle(window)?;
  on_main(window, move |raw| {
    unsafe { plvs_macos_dock_remember_chrome(raw as *mut _) };
    Ok(())
  })
}

/// Restore the actual pre-Dock content policy after decorations settle, before physical bounds.
pub fn restore_chrome<R: tauri::Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
  settle(window)?;
  on_main(window, move |raw| {
    unsafe { plvs_macos_dock_restore_chrome(raw as *mut _) };
    Ok(())
  })
}

pub fn configure<R: tauri::Runtime>(
  window: &WebviewWindow<R>,
  enabled: bool,
  edge: DockEdge,
  height: u32,
  above: bool,
) -> Result<(), String> {
  if enabled {
    panel(window)?;
  } else {
    let target = window.clone();
    if !on_main(window, move |_| {
      Ok(
        target
          .app_handle()
          .get_webview_panel(target.label())
          .is_ok(),
      )
    })? {
      return Ok(());
    }
  }
  REPORT.get_or_init(|| {
    let app = window.app_handle().clone();
    Box::new(move |kind| {
      let event = if kind == 0 {
        "dock-interaction-elsewhere"
      } else {
        "dock-native-geometry-changed"
      };
      let _ = app.emit(event, ());
    })
  });
  on_main(window, move |raw| {
    let status = unsafe {
      plvs_macos_dock_window_configure(
        raw as *mut _,
        enabled,
        edge == DockEdge::Top,
        f64::from(height),
        above,
        report,
      )
    };
    if status == 0 {
      Ok(())
    } else {
      Err("The macOS Dock requires the PLVS Panel window host.".into())
    }
  })
}

pub fn configure_accessory<R: tauri::Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
  panel(window)?;
  let role = match window.label() {
    "dock-header" => 1,
    "dock-editor" => 2,
    "dock-update" => 3,
    "dock-import" => 4,
    _ => return Err("Unknown macOS Dock accessory.".into()),
  };
  on_main(window, move |raw| {
    if unsafe { plvs_macos_dock_accessory_configure(raw as *mut _, role) } == 0 {
      Ok(())
    } else {
      Err("The macOS accessory requires the PLVS Panel window host.".into())
    }
  })
}

pub fn present<R: tauri::Runtime>(
  window: &WebviewWindow<R>,
  visible: bool,
  focus: bool,
) -> Result<(), String> {
  on_main(window, move |raw| {
    unsafe { plvs_macos_dock_window_present(raw as *mut _, visible, focus) };
    Ok(())
  })
}

pub fn normal<R: tauri::Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
  on_main(window, move |raw| {
    unsafe { plvs_macos_dock_window_normal(raw as *mut _) };
    Ok(())
  })?;
  sync_content(window)
}

/// Tao's content view can be correct while WKWebView retains the previous title-bar inset.
/// Reuse the normal decoration path's WebView synchronization after native bounds have settled.
pub fn sync_content<R: tauri::Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
  settle(window)?;
  crate::window_chrome::sync_main_window_chrome(window.clone())?;
  settle(window)
}

/// Best-effort UI reveal must preserve Space eligibility and the lifecycle owner's suspension.
pub fn reveal<R: tauri::Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
  on_main(window, move |raw| {
    unsafe { plvs_macos_dock_window_reveal(raw as *mut _) };
    Ok(())
  })
}
