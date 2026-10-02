use std::sync::atomic::{AtomicBool, Ordering};

/// The shadow normal (non-Dock) windows should use. Tauri does not expose an
/// `is_shadow()` getter, so Dock transitions and rollback paths share this
/// explicit source of truth instead of guessing from decorations.
pub struct NormalWindowShadow(AtomicBool);

impl Default for NormalWindowShadow {
  fn default() -> Self {
    Self(AtomicBool::new(true))
  }
}

impl NormalWindowShadow {
  pub fn load(&self) -> bool {
    self.0.load(Ordering::Relaxed)
  }

  pub fn store(&self, enabled: bool) {
    self.0.store(enabled, Ordering::Relaxed);
  }
}

pub fn normal_window_shadow_for_surface_opacity(surface_opacity: u8) -> bool {
  #[cfg(target_os = "macos")]
  {
    // AppKit derives a transparent window's shadow from its current alpha
    // shape. At zero surface opacity that turns every remaining canvas stroke
    // and glyph into a shadow caster, producing dark outlines around content.
    surface_opacity > 0
  }
  #[cfg(not(target_os = "macos"))]
  {
    let _ = surface_opacity;
    true
  }
}

#[tauri::command]
pub fn sync_surface_opacity_shadow<R: tauri::Runtime>(
  window: tauri::WebviewWindow<R>,
  docked: tauri::State<'_, crate::dock::DockedFlag>,
  normal_shadow: tauri::State<'_, NormalWindowShadow>,
  surface_opacity: u8,
) -> Result<(), String> {
  if surface_opacity > 100 {
    return Err("surface opacity must be between 0 and 100".into());
  }
  let enabled = normal_window_shadow_for_surface_opacity(surface_opacity);
  // Dock owns a shadowless strip. Remember the next normal-window value now,
  // but let exit_dock apply it before restoring normal geometry.
  if !docked.0.load(Ordering::Relaxed) {
    window
      .set_shadow(enabled)
      .map_err(|error| format!("surface opacity shadow: {error}"))?;
  }
  normal_shadow.store(enabled);
  Ok(())
}

/// Match the DWM outline to native chrome without changing shadow or resize geometry.
/// Windows versions before 11 do not support this attribute and retain their default frame.
#[cfg(target_os = "windows")]
pub fn set_native_border<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>, visible: bool) {
  use windows_sys::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_COLOR_DEFAULT, DWMWA_COLOR_NONE,
  };

  let Ok(hwnd) = window.hwnd() else {
    return;
  };
  let color = if visible {
    DWMWA_COLOR_DEFAULT
  } else {
    DWMWA_COLOR_NONE
  };
  // SAFETY: Tauri owns the live HWND, and DWM reads a COLORREF from this valid local value.
  let result = unsafe {
    DwmSetWindowAttribute(
      hwnd.0,
      DWMWA_BORDER_COLOR as u32,
      (&color as *const u32).cast(),
      std::mem::size_of_val(&color) as u32,
    )
  };
  if result < 0 {
    log::debug!("Native border update unavailable: HRESULT {result:#x}");
  } else {
    log::debug!("Native window outline visible: {visible}");
  }
}

#[tauri::command]
pub fn sync_main_window_chrome<R: tauri::Runtime>(
  window: tauri::WebviewWindow<R>,
) -> Result<(), String> {
  #[cfg(target_os = "windows")]
  set_native_border(
    &window,
    window.is_decorated().map_err(|error| error.to_string())?,
  );
  #[cfg(target_os = "macos")]
  {
    let size = window
      .inner_size()
      .map_err(|error| format!("read window inner size: {error}"))?;
    window
      .as_ref()
      .set_size(size)
      .map_err(|error| format!("resize webview: {error}"))?;
  }
  #[cfg(not(target_os = "macos"))]
  {
    let _ = window;
  }
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn surface_opacity_shadow_policy_matches_platform() {
    #[cfg(target_os = "macos")]
    {
      assert!(!normal_window_shadow_for_surface_opacity(0));
      assert!(normal_window_shadow_for_surface_opacity(1));
      assert!(normal_window_shadow_for_surface_opacity(100));
    }
    #[cfg(not(target_os = "macos"))]
    {
      assert!(normal_window_shadow_for_surface_opacity(0));
      assert!(normal_window_shadow_for_surface_opacity(100));
    }
  }
}
