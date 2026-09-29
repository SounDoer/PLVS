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
