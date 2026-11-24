//! Stable capture device ids (`lb-*` / `cap-*`): v2 uses **device name only** (plus collision nonce) so
//! Windows speaker layout / default format changes do **not** rotate the id. Legacy v1 ids that
//! hashed name + channels + sample_rate are still resolved for existing saved preferences.

use sha2::{Digest, Sha256};
use std::collections::HashSet;

const LB_SALT_V2: &[u8] = b"AudioMeter/v2/lb\0";
const CAP_SALT_V2: &[u8] = b"AudioMeter/v2/cap\0";
const LB_SALT_V1: &[u8] = b"AudioMeter/v1/lb\0";
const CAP_SALT_V1: &[u8] = b"AudioMeter/v1/cap\0";

fn digest_v2_row(salt: &[u8], name: &str, nonce: u32) -> String {
  let mut h = Sha256::new();
  h.update(salt);
  h.update(name.as_bytes());
  h.update([0]);
  h.update(nonce.to_le_bytes());
  let full = h.finalize();
  let mut s = String::with_capacity(32);
  for b in full.iter().take(16) {
    s.push_str(&format!("{b:02x}"));
  }
  s
}

/// Legacy v1 digest: name + channels + sample_rate + nonce (used only to resolve old saved ids).
pub(crate) fn digest_legacy_v1(
  salt: &[u8],
  name: &str,
  channels: u16,
  sample_rate: u32,
  nonce: u32,
) -> String {
  let mut h = Sha256::new();
  h.update(salt);
  h.update(name.as_bytes());
  h.update([0]);
  h.update(channels.to_le_bytes());
  h.update(sample_rate.to_le_bytes());
  h.update(nonce.to_le_bytes());
  let full = h.finalize();
  let mut s = String::with_capacity(32);
  for b in full.iter().take(16) {
    s.push_str(&format!("{b:02x}"));
  }
  s
}

/// `lb-{32 hex}`; disambiguates rare hash collisions with `nonce` baked into the digest.
pub fn alloc_loopback_id(name: &str, used: &mut HashSet<String>) -> String {
  let mut nonce = 0u32;
  loop {
    let body = digest_v2_row(LB_SALT_V2, name, nonce);
    let id = format!("lb-{body}");
    if used.insert(id.clone()) {
      return id;
    }
    nonce = nonce.saturating_add(1);
    if nonce > 4096 {
      return format!("lb-fallback-{nonce}");
    }
  }
}

/// v1 loopback id allocation (for matching legacy persisted ids only).
pub(crate) fn legacy_alloc_loopback_id(
  name: &str,
  channels: u16,
  sample_rate: u32,
  used: &mut HashSet<String>,
) -> String {
  let mut nonce = 0u32;
  loop {
    let body = digest_legacy_v1(LB_SALT_V1, name, channels, sample_rate, nonce);
    let id = format!("lb-{body}");
    if used.insert(id.clone()) {
      return id;
    }
    nonce = nonce.saturating_add(1);
    if nonce > 4096 {
      return format!("lb-fallback-{nonce}");
    }
  }
}

/// `cap-{32 hex}` for microphones / line-in / virtual cables.
pub fn alloc_capture_id(name: &str, used: &mut HashSet<String>) -> String {
  let mut nonce = 0u32;
  loop {
    let body = digest_v2_row(CAP_SALT_V2, name, nonce);
    let id = format!("cap-{body}");
    if used.insert(id.clone()) {
      return id;
    }
    nonce = nonce.saturating_add(1);
    if nonce > 4096 {
      return format!("cap-fallback-{nonce}");
    }
  }
}

pub(crate) fn legacy_alloc_capture_id(
  name: &str,
  channels: u16,
  sample_rate: u32,
  used: &mut HashSet<String>,
) -> String {
  let mut nonce = 0u32;
  loop {
    let body = digest_legacy_v1(CAP_SALT_V1, name, channels, sample_rate, nonce);
    let id = format!("cap-{body}");
    if used.insert(id.clone()) {
      return id;
    }
    nonce = nonce.saturating_add(1);
    if nonce > 4096 {
      return format!("cap-fallback-{nonce}");
    }
  }
}

pub fn is_stable_loopback_id(id: &str) -> bool {
  id.starts_with("lb-") && id.len() == 35 && id[3..].chars().all(|c| c.is_ascii_hexdigit())
}

pub fn is_stable_capture_id(id: &str) -> bool {
  id.starts_with("cap-") && id.len() == 36 && id[4..].chars().all(|c| c.is_ascii_hexdigit())
}

/// Legacy `out:123` — decimal index in cpal `output_devices()` enumeration order (unsorted).
pub fn parse_legacy_output_index(id: &str) -> Option<usize> {
  let rest = id.strip_prefix("out:")?;
  if rest.is_empty() || !rest.chars().all(|c| c.is_ascii_digit()) {
    return None;
  }
  rest.parse().ok()
}

/// Legacy `in:123` — decimal index in cpal `input_devices()` enumeration order (unsorted).
pub fn parse_legacy_input_index(id: &str) -> Option<usize> {
  let rest = id.strip_prefix("in:")?;
  if rest.is_empty() || !rest.chars().all(|c| c.is_ascii_digit()) {
    return None;
  }
  rest.parse().ok()
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn v2_loopback_id_stable_when_format_changes() {
    let mut used_a = HashSet::new();
    let mut used_b = HashSet::new();
    let a = alloc_loopback_id("Speakers", &mut used_a);
    let b = alloc_loopback_id("Speakers", &mut used_b);
    assert_eq!(a, b);
    assert!(is_stable_loopback_id(&a));
  }

  #[test]
  fn v2_loopback_differs_per_label() {
    let mut u1 = HashSet::new();
    let mut u2 = HashSet::new();
    assert_ne!(
      alloc_loopback_id("A", &mut u1),
      alloc_loopback_id("B", &mut u2)
    );
  }

  #[test]
  fn v1_legacy_loopback_id_depends_on_channels() {
    let mut u2 = HashSet::new();
    let mut u6 = HashSet::new();
    let stereo = legacy_alloc_loopback_id("Speakers", 2, 48_000, &mut u2);
    let surround = legacy_alloc_loopback_id("Speakers", 6, 48_000, &mut u6);
    assert_ne!(stereo, surround);
  }
}
