//! Stable application identities for Windows process-loopback selection.

use std::collections::BTreeMap;
use std::path::Path;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use windows_sys::core::BOOL;
use windows_sys::Win32::Foundation::{CloseHandle, HWND, LPARAM};
use windows_sys::Win32::System::Threading::{
  OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
  EnumWindows, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible,
};
use winreg::enums::HKEY_LOCAL_MACHINE;
use winreg::RegKey;

const MAX_PROCESS_PATH_UTF16: usize = 32_768;
const MIN_PROCESS_LOOPBACK_BUILD: u32 = 20_348;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CaptureApplication {
  /// Stable across restarts as long as the executable path stays the same.
  pub id: String,
  pub label: String,
  /// Current root/window process. This is diagnostic inventory data, not persisted identity.
  pub process_id: u32,
  pub window_title: String,
}

#[derive(Debug)]
struct WindowCandidate {
  process_id: u32,
  window_title: String,
}

fn application_id(executable_path: &str) -> String {
  let normalized = executable_path.replace('/', "\\").to_lowercase();
  let digest = Sha256::digest(normalized.as_bytes());
  let mut id = String::with_capacity(36);
  id.push_str("app-");
  for byte in &digest[..16] {
    use std::fmt::Write;
    let _ = write!(id, "{byte:02x}");
  }
  id
}

fn process_image_path(process_id: u32) -> Option<String> {
  let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id) };
  if process.is_null() {
    return None;
  }
  let mut buffer = vec![0u16; MAX_PROCESS_PATH_UTF16];
  let mut length = buffer.len() as u32;
  let ok = unsafe { QueryFullProcessImageNameW(process, 0, buffer.as_mut_ptr(), &mut length) };
  unsafe {
    let _ = CloseHandle(process);
  }
  if ok == 0 || length == 0 {
    return None;
  }
  Some(String::from_utf16_lossy(&buffer[..length as usize]))
}

fn application_label(path: &str) -> String {
  Path::new(path)
    .file_stem()
    .and_then(|stem| stem.to_str())
    .filter(|stem| !stem.is_empty())
    .unwrap_or("Application")
    .to_string()
}

unsafe extern "system" fn collect_visible_window(hwnd: HWND, lparam: LPARAM) -> BOOL {
  if unsafe { IsWindowVisible(hwnd) } == 0 {
    return 1;
  }
  let title_length = unsafe { GetWindowTextLengthW(hwnd) };
  if title_length <= 0 {
    return 1;
  }
  let mut process_id = 0u32;
  unsafe { GetWindowThreadProcessId(hwnd, &mut process_id) };
  if process_id == 0 || process_id == std::process::id() {
    return 1;
  }
  let mut title = vec![0u16; title_length as usize + 1];
  let copied = unsafe { GetWindowTextW(hwnd, title.as_mut_ptr(), title.len() as i32) };
  if copied <= 0 {
    return 1;
  }
  let candidates = unsafe { &mut *(lparam as *mut Vec<WindowCandidate>) };
  candidates.push(WindowCandidate {
    process_id,
    window_title: String::from_utf16_lossy(&title[..copied as usize]),
  });
  1
}

pub fn list_capture_applications() -> Result<Vec<CaptureApplication>, String> {
  if !process_loopback_supported() {
    return Ok(Vec::new());
  }
  let mut candidates: Vec<WindowCandidate> = Vec::new();
  let ok = unsafe {
    EnumWindows(
      Some(collect_visible_window),
      (&mut candidates as *mut Vec<WindowCandidate>) as LPARAM,
    )
  };
  if ok == 0 {
    return Err("EnumWindows failed while listing capture applications".to_string());
  }

  let mut by_id = BTreeMap::new();
  for candidate in candidates {
    let Some(path) = process_image_path(candidate.process_id) else {
      continue;
    };
    let id = application_id(&path);
    by_id
      .entry(id.clone())
      .or_insert_with(|| CaptureApplication {
        id,
        label: application_label(&path),
        process_id: candidate.process_id,
        window_title: candidate.window_title,
      });
  }
  let mut applications: Vec<_> = by_id.into_values().collect();
  applications.sort_by_cached_key(|application| application.label.to_lowercase());
  Ok(applications)
}

fn process_loopback_supported() -> bool {
  let current_version =
    RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion");
  let Ok(current_version) = current_version else {
    return false;
  };
  let build: Result<String, _> = current_version.get_value("CurrentBuildNumber");
  build
    .ok()
    .and_then(|value| value.parse::<u32>().ok())
    .is_some_and(|value| value >= MIN_PROCESS_LOOPBACK_BUILD)
}

pub fn resolve_capture_application(application_id: &str) -> Result<CaptureApplication, String> {
  if !is_application_id(application_id) {
    return Err("invalid capture application id".to_string());
  }
  list_capture_applications()?
    .into_iter()
    .find(|application| application.id == application_id)
    .ok_or_else(|| "capture application is not currently running".to_string())
}

pub fn is_application_id(value: &str) -> bool {
  value.len() == 36
    && value.starts_with("app-")
    && value[4..].bytes().all(|byte| byte.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
  use super::{application_id, application_label, is_application_id};

  #[test]
  fn application_identity_is_path_stable_and_case_insensitive() {
    let first = application_id(r"C:\Program Files\VideoLAN\VLC\vlc.exe");
    let second = application_id("c:/program files/videolan/vlc/VLC.EXE");
    assert_eq!(first, second);
    assert!(is_application_id(&first));
  }

  #[test]
  fn executable_stem_is_the_bounded_inventory_label_source() {
    assert_eq!(application_label(r"C:\Audio\My DAW.exe"), "My DAW");
  }

  #[test]
  fn application_id_validation_rejects_pid_shaped_or_malformed_values() {
    assert!(!is_application_id("app-4242"));
    assert!(!is_application_id("process:4242"));
    assert!(!is_application_id("app-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"));
  }
}
