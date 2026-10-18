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

#[cfg(target_os = "linux")]
fn linux_sidecar_directory(app_id: &str) -> PathBuf {
  let package = if app_id == "com.soundoer.plvs.preview" {
    "plvs-preview"
  } else {
    "plvs"
  };
  PathBuf::from("/usr/lib").join(package).join("sidecars")
}

fn packaged_sidecar_path(stem: &str, executable: Option<PathBuf>) -> PathBuf {
  let name = sidecar_binary_name(stem);
  #[cfg(target_os = "linux")]
  {
    let _ = executable;
    linux_sidecar_directory(env!("PLVS_APP_ID")).join(name)
  }
  #[cfg(not(target_os = "linux"))]
  {
    executable
      .and_then(|p| p.parent().map(|d| d.to_path_buf()))
      .unwrap_or_else(|| PathBuf::from("."))
      .join(name)
  }
}

/// Resolve a sidecar binary path. `PLVS_FFMPEG_DIR` is an explicit development/test escape hatch.
/// Packaged Linux builds use an identity-private directory instead of distribution-owned
/// `/usr/bin/ffmpeg`; Windows and macOS keep Tauri's adjacent `externalBin` layout.
pub fn locate_sidecar(stem: &str) -> PathBuf {
  let name = sidecar_binary_name(stem);
  if let Ok(dir) = std::env::var("PLVS_FFMPEG_DIR") {
    return PathBuf::from(dir).join(name);
  }
  packaged_sidecar_path(stem, std::env::current_exe().ok())
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

  #[cfg(target_os = "linux")]
  #[test]
  fn linux_packaged_sidecars_do_not_use_usr_bin() {
    let stable = linux_sidecar_directory("com.soundoer.plvs");
    let preview = linux_sidecar_directory("com.soundoer.plvs.preview");
    assert_eq!(stable, PathBuf::from("/usr/lib/plvs/sidecars"));
    assert_eq!(preview, PathBuf::from("/usr/lib/plvs-preview/sidecars"));
    assert_ne!(stable, preview);
    assert_eq!(
      packaged_sidecar_path("ffmpeg", Some(PathBuf::from("/usr/bin/plvs"))),
      stable.join("ffmpeg")
    );
  }
}
