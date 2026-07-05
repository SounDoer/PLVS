#[cfg(target_os = "windows")]
use window_vibrancy::{apply_acrylic, clear_acrylic};
#[cfg(target_os = "macos")]
use window_vibrancy::{
  apply_vibrancy, clear_vibrancy, NSVisualEffectMaterial, NSVisualEffectState,
};

/// Applies (or clears) an OS-level frosted-glass effect on the transparent area created by
/// `panelOpacity`. `dark` selects a tint/material matching the app's currently resolved theme.
/// Failures (unsupported OS version) are returned as an error string; callers are expected to
/// swallow them silently, same as other best-effort window-chrome calls (decorations, autostart).
#[tauri::command]
pub fn set_glass_effect<R: tauri::Runtime>(
  window: tauri::WebviewWindow<R>,
  enabled: bool,
  dark: bool,
) -> Result<(), String> {
  #[cfg(target_os = "windows")]
  {
    if enabled {
      let tint = if dark {
        (18, 18, 18, 125)
      } else {
        (240, 240, 240, 125)
      };
      apply_acrylic(&window, Some(tint)).map_err(|e| format!("apply_acrylic: {e}"))?;
    } else {
      clear_acrylic(&window).map_err(|e| format!("clear_acrylic: {e}"))?;
    }
  }
  #[cfg(target_os = "macos")]
  {
    if enabled {
      let material = if dark {
        NSVisualEffectMaterial::HudWindow
      } else {
        NSVisualEffectMaterial::Sidebar
      };
      apply_vibrancy(&window, material, Some(NSVisualEffectState::Active), None)
        .map_err(|e| format!("apply_vibrancy: {e}"))?;
    } else {
      clear_vibrancy(&window).map_err(|e| format!("clear_vibrancy: {e}"))?;
    }
  }
  #[cfg(not(any(target_os = "windows", target_os = "macos")))]
  {
    let _ = (window, enabled, dark);
  }
  Ok(())
}
