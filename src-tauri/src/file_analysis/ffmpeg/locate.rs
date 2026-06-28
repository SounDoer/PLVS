use std::path::PathBuf;

/// Platform-correct on-disk name for a bundled sidecar (Tauri strips the target triple at bundle
/// time, leaving e.g. `ffmpeg.exe`).
pub fn sidecar_binary_name(stem: &str) -> String {
  #[cfg(windows)]
  {
    format!("{stem}.exe")
  }
  #[cfg(not(windows))]
  {
    stem.to_string()
  }
}

/// Resolve a sidecar binary path. `PLVS_FFMPEG_DIR` (dev/test escape hatch) wins; otherwise the
/// binary is expected next to the running executable, where Tauri places externalBin sidecars.
pub fn locate_sidecar(stem: &str) -> PathBuf {
  let name = sidecar_binary_name(stem);
  if let Ok(dir) = std::env::var("PLVS_FFMPEG_DIR") {
    return PathBuf::from(dir).join(name);
  }
  let base = std::env::current_exe()
    .ok()
    .and_then(|p| p.parent().map(|d| d.to_path_buf()))
    .unwrap_or_else(|| PathBuf::from("."));
  base.join(name)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn binary_name_has_platform_suffix() {
    let name = sidecar_binary_name("ffmpeg");
    #[cfg(windows)]
    assert_eq!(name, "ffmpeg.exe");
    #[cfg(not(windows))]
    assert_eq!(name, "ffmpeg");
  }

  #[test]
  fn env_override_takes_precedence() {
    std::env::set_var("PLVS_FFMPEG_DIR", "/custom/dir");
    let path = locate_sidecar("ffmpeg");
    assert!(path.ends_with(sidecar_binary_name("ffmpeg")));
    assert!(path.to_string_lossy().contains("custom"));
    std::env::remove_var("PLVS_FFMPEG_DIR");
  }
}
