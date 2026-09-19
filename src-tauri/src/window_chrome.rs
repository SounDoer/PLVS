#[tauri::command]
pub fn sync_main_webview_size<R: tauri::Runtime>(
  window: tauri::WebviewWindow<R>,
) -> Result<(), String> {
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
