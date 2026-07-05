#[cfg(target_os = "macos")]
use window_vibrancy::{
  apply_vibrancy, clear_vibrancy, NSVisualEffectMaterial, NSVisualEffectState,
};

#[cfg(target_os = "macos")]
fn clear_all_vibrancy<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) -> Result<(), String> {
  while clear_vibrancy(window).map_err(|e| format!("clear_vibrancy: {e}"))? {}
  Ok(())
}

/// Applies (or clears) an OS-level frosted-glass effect on the transparent area created by
/// `panelOpacity`. macOS-only: `NSVisualEffectView` vibrancy composes cleanly with this app's
/// per-pixel-transparent window. Windows has no equivalent that does — the legacy Acrylic API
/// forces a visible tint floor regardless of alpha, and Mica (Windows 11's own backdrop
/// material) doesn't render at all behind a layered/transparent window like this one — so the
/// command is a no-op on Windows and the frontend hides the toggle there entirely.
#[tauri::command]
pub fn set_glass_effect<R: tauri::Runtime>(
  window: tauri::WebviewWindow<R>,
  enabled: bool,
  dark: bool,
) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  {
    if enabled {
      clear_all_vibrancy(&window)?;
      let material = if dark {
        NSVisualEffectMaterial::HudWindow
      } else {
        NSVisualEffectMaterial::Sidebar
      };
      apply_vibrancy(&window, material, Some(NSVisualEffectState::Active), None)
        .map_err(|e| format!("apply_vibrancy: {e}"))?;
    } else {
      clear_all_vibrancy(&window)?;
    }
  }
  #[cfg(not(target_os = "macos"))]
  {
    let _ = (window, enabled, dark);
  }
  Ok(())
}
