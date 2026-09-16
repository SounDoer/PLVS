//! Stable macOS application identities backed by the current Core Audio process objects.

use std::collections::BTreeMap;
use std::ffi::{c_char, c_int, c_void, CStr};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CaptureApplication {
  pub id: String,
  pub label: String,
  /// Representative PID for the existing cross-platform UI contract.
  pub process_id: u32,
  /// Every current audio process grouped under this application identity.
  pub process_ids: Vec<u32>,
  /// macOS has no permission-free window-title inventory. Use the bundle identifier as detail.
  pub window_title: String,
}

#[derive(Clone, Debug)]
pub struct ResolvedCaptureApplication {
  pub application: CaptureApplication,
  pub audio_process_object_ids: Vec<u32>,
}

#[derive(Debug)]
struct ProcessRow {
  audio_object_id: u32,
  process_id: u32,
  identity: String,
  label: String,
  detail: String,
}

type ProcessCallback = unsafe extern "C" fn(
  context: *mut c_void,
  audio_object_id: u32,
  process_id: i32,
  identity_utf8: *const c_char,
  label_utf8: *const c_char,
  detail_utf8: *const c_char,
);

#[link(name = "tap_bridge", kind = "static")]
unsafe extern "C" {
  fn macos_list_capture_processes(
    context: *mut c_void,
    callback: ProcessCallback,
    err_out: *mut c_char,
    err_cap: usize,
  ) -> c_int;
}

fn copy_c_string(value: *const c_char) -> String {
  if value.is_null() {
    return String::new();
  }
  unsafe { CStr::from_ptr(value) }
    .to_string_lossy()
    .into_owned()
}

unsafe extern "C" fn collect_process(
  context: *mut c_void,
  audio_object_id: u32,
  process_id: i32,
  identity_utf8: *const c_char,
  label_utf8: *const c_char,
  detail_utf8: *const c_char,
) {
  if context.is_null() || process_id <= 0 {
    return;
  }
  let rows = unsafe { &mut *context.cast::<Vec<ProcessRow>>() };
  let identity = copy_c_string(identity_utf8);
  if identity.is_empty() {
    return;
  }
  rows.push(ProcessRow {
    audio_object_id,
    process_id: process_id as u32,
    identity,
    label: copy_c_string(label_utf8),
    detail: copy_c_string(detail_utf8),
  });
}

fn application_id(identity: &str) -> String {
  let normalized = format!("macos:{}", identity.trim().to_lowercase());
  let digest = Sha256::digest(normalized.as_bytes());
  let mut id = String::with_capacity(36);
  id.push_str("app-");
  for byte in &digest[..16] {
    use std::fmt::Write;
    let _ = write!(id, "{byte:02x}");
  }
  id
}

fn collect_rows() -> Result<Vec<ProcessRow>, String> {
  let mut rows = Vec::new();
  let mut error = vec![0u8; 512];
  let status = unsafe {
    macos_list_capture_processes(
      (&mut rows as *mut Vec<ProcessRow>).cast(),
      collect_process,
      error.as_mut_ptr().cast(),
      error.len(),
    )
  };
  if status == 0 {
    return Ok(rows);
  }
  let message = error
    .iter()
    .position(|&byte| byte == 0)
    .map(|length| String::from_utf8_lossy(&error[..length]).into_owned())
    .filter(|message| !message.is_empty())
    .unwrap_or_else(|| "failed to enumerate Core Audio processes".into());
  Err(message)
}

fn grouped_applications() -> Result<Vec<ResolvedCaptureApplication>, String> {
  let mut grouped: BTreeMap<String, Vec<ProcessRow>> = BTreeMap::new();
  for row in collect_rows()? {
    grouped.entry(row.identity.clone()).or_default().push(row);
  }

  let mut applications = Vec::with_capacity(grouped.len());
  for (identity, mut rows) in grouped {
    rows.sort_by_key(|row| (row.process_id, row.audio_object_id));
    rows.dedup_by_key(|row| row.audio_object_id);
    let Some(first) = rows.first() else { continue };
    let label = if first.label.trim().is_empty() {
      "Application".to_string()
    } else {
      first.label.clone()
    };
    let mut process_ids: Vec<_> = rows.iter().map(|row| row.process_id).collect();
    process_ids.dedup();
    let audio_process_object_ids = rows.iter().map(|row| row.audio_object_id).collect();
    applications.push(ResolvedCaptureApplication {
      application: CaptureApplication {
        id: application_id(&identity),
        label,
        process_id: first.process_id,
        process_ids,
        window_title: first.detail.clone(),
      },
      audio_process_object_ids,
    });
  }
  applications.sort_by_cached_key(|application| application.application.label.to_lowercase());
  Ok(applications)
}

pub fn list_capture_applications() -> Result<Vec<CaptureApplication>, String> {
  Ok(
    grouped_applications()?
      .into_iter()
      .map(|resolved| resolved.application)
      .collect(),
  )
}

pub fn resolve_capture_application(
  requested_id: &str,
) -> Result<ResolvedCaptureApplication, String> {
  if !is_application_id(requested_id) {
    return Err("invalid capture application id".into());
  }
  grouped_applications()?
    .into_iter()
    .find(|resolved| resolved.application.id == requested_id)
    .ok_or_else(|| "capture application is not currently available to Core Audio".into())
}

pub fn is_application_id(value: &str) -> bool {
  value.len() == 36
    && value.starts_with("app-")
    && value[4..].bytes().all(|byte| byte.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
  use std::collections::HashSet;

  use super::{application_id, is_application_id, list_capture_applications};

  #[test]
  fn application_identity_is_bundle_stable_and_case_insensitive() {
    let first = application_id("com.apple.Safari");
    let second = application_id(" COM.APPLE.SAFARI ");
    assert_eq!(first, second);
    assert!(is_application_id(&first));
  }

  #[test]
  fn application_id_validation_rejects_pid_shaped_or_malformed_values() {
    assert!(!is_application_id("app-4242"));
    assert!(!is_application_id("app-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"));
  }

  #[test]
  fn live_inventory_obeys_the_public_application_contract() {
    let applications = list_capture_applications().expect("Core Audio process inventory");
    let mut ids = HashSet::new();
    for application in applications {
      assert!(ids.insert(application.id.clone()));
      assert!(is_application_id(&application.id));
      assert!(!application.label.trim().is_empty());
      assert!(!application.process_ids.is_empty());
      assert_eq!(application.process_id, application.process_ids[0]);
      assert!(application
        .process_ids
        .windows(2)
        .all(|pair| pair[0] < pair[1]));
    }
  }
}
