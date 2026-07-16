//! Device enumeration, labelling, and id resolution for cpal/WASAPI.
//! Kept separate from the capture I/O loop in `cpal_backend`.

use std::collections::HashSet;

use crate::audio::device::DeviceInfo;
use crate::audio::device_id;
use cpal::traits::{DeviceTrait, HostTrait};

pub(crate) fn is_name_heuristic_loopback(name: &str) -> bool {
  let n = name.to_lowercase();
  n.contains("loopback")
    || n.contains("stereo mix")
    || n.contains("what u hear")
    || n.contains("立体声混音")
}

/// Check if a device id refers to a loopback capture (system output monitor).
/// Loopback devices need a silence stream on Windows to keep the audio engine active.
#[cfg(target_os = "windows")]
pub(crate) fn is_loopback_capture(device_id: &str) -> bool {
  device_id.is_empty()
    || device_id == "default"
    || device_id::is_stable_loopback_id(device_id)
    || device_id::parse_legacy_output_index(device_id).is_some()
}

/// Short name from cpal / WASAPI (`DeviceDesc` on Windows). Used for **stable device ids**
/// (`lb-*` / `cap-*`) so ids do not change when we only enrich the UI label.
pub(crate) fn device_id_key(device: &cpal::Device) -> Result<String, String> {
  Ok(
    device
      .description()
      .map_err(|e| e.to_string())?
      .name()
      .trim()
      .to_string(),
  )
}

/// User-facing list label: on Windows, cpal often puts the generic endpoint name in `name()` and
/// the hardware / driver product string in `extended()`.
pub(crate) fn device_list_label(device: &cpal::Device) -> Result<String, String> {
  let d = device.description().map_err(|e| e.to_string())?;
  let primary = d.name().trim();
  let parts: Vec<&str> = d
    .extended()
    .map(|s| s.trim())
    .filter(|s| !s.is_empty())
    .collect();
  if parts.is_empty() {
    return Ok(primary.to_string());
  }
  let detail = parts.join(" · ");
  if detail == primary {
    return Ok(primary.to_string());
  }
  Ok(format!("{detail} — {primary}"))
}

pub(crate) fn collect_outputs(
) -> Result<Vec<(usize, cpal::Device, cpal::SupportedStreamConfig)>, String> {
  let host = cpal::default_host();
  let mut rows = Vec::new();
  for (idx, device) in host
    .output_devices()
    .map_err(|e| e.to_string())?
    .enumerate()
  {
    if let Ok(cfg) = device.default_output_config() {
      rows.push((idx, device, cfg));
    }
  }
  rows.sort_by(|a, b| {
    let na = device_list_label(&a.1).unwrap_or_default();
    let nb = device_list_label(&b.1).unwrap_or_default();
    na.to_lowercase().cmp(&nb.to_lowercase())
  });
  Ok(rows)
}

pub(crate) fn collect_inputs(
) -> Result<Vec<(usize, cpal::Device, cpal::SupportedStreamConfig)>, String> {
  let host = cpal::default_host();
  let mut rows = Vec::new();
  for (idx, device) in host.input_devices().map_err(|e| e.to_string())?.enumerate() {
    if let Ok(cfg) = device.default_input_config() {
      rows.push((idx, device, cfg));
    }
  }
  rows.sort_by(|a, b| {
    let na = device_list_label(&a.1).unwrap_or_default();
    let nb = device_list_label(&b.1).unwrap_or_default();
    na.to_lowercase().cmp(&nb.to_lowercase())
  });
  Ok(rows)
}

pub(crate) fn pick_output_by_index(
  target: usize,
) -> Result<(cpal::Device, cpal::SupportedStreamConfig), String> {
  let host = cpal::default_host();
  for (idx, device) in host
    .output_devices()
    .map_err(|e| e.to_string())?
    .enumerate()
  {
    if idx != target {
      continue;
    }
    let cfg = device
      .default_output_config()
      .map_err(|e| format!("{e} (output index {target})"))?;
    return Ok((device, cfg));
  }
  Err(format!("Output device index not found: {target}"))
}

pub(crate) fn pick_input_by_index(
  target: usize,
) -> Result<(cpal::Device, cpal::SupportedStreamConfig), String> {
  let host = cpal::default_host();
  for (idx, device) in host.input_devices().map_err(|e| e.to_string())?.enumerate() {
    if idx != target {
      continue;
    }
    let cfg = device
      .default_input_config()
      .map_err(|e| format!("{e} (input index {target})"))?;
    return Ok((device, cfg));
  }
  Err(format!("Input device index not found: {target}"))
}

/// Selectable sources: system **outputs** (loopback) first, then **inputs**.
pub(crate) fn build_device_list() -> Result<Vec<DeviceInfo>, String> {
  let mut out = Vec::new();
  let mut used_lb = HashSet::new();

  for (_idx, device, cfg) in collect_outputs()? {
    let key = device_id_key(&device)?;
    let label = device_list_label(&device)?;
    let id = device_id::alloc_loopback_id(&key, &mut used_lb);
    out.push(DeviceInfo {
      id,
      label,
      is_system_output_monitor: true,
      is_loopback: true,
      default_sample_rate: cfg.sample_rate(),
      channels: cfg.channels(),
      core_audio_output_uid: None,
    });
  }

  append_input_devices(&mut out)?;
  Ok(out)
}

/// Append microphone / line-in / virtual input rows using `cap-*` ids.
pub(crate) fn append_input_devices(out: &mut Vec<DeviceInfo>) -> Result<(), String> {
  let mut used_cap = HashSet::new();
  for (_idx, device, cfg) in collect_inputs()? {
    let key = device_id_key(&device)?;
    let label = device_list_label(&device)?;
    let is_loopback = is_name_heuristic_loopback(&key) || is_name_heuristic_loopback(&label);
    let id = device_id::alloc_capture_id(&key, &mut used_cap);
    out.push(DeviceInfo {
      id,
      label,
      is_system_output_monitor: false,
      is_loopback,
      default_sample_rate: cfg.sample_rate(),
      channels: cfg.channels(),
      core_audio_output_uid: None,
    });
  }
  Ok(())
}

pub(crate) fn resolve_default_output() -> Result<(cpal::Device, cpal::SupportedStreamConfig), String>
{
  let host = cpal::default_host();
  if let Some(def) = host.default_output_device() {
    let def_name = device_id_key(&def)?;
    for device in host.output_devices().map_err(|e| e.to_string())? {
      let Ok(name) = device_id_key(&device) else {
        continue;
      };
      if name == def_name {
        let cfg = device
          .default_output_config()
          .map_err(|e| format!("default output format: {e}"))?;
        return Ok((device, cfg));
      }
    }
  }
  let host = cpal::default_host();
  for device in host.output_devices().map_err(|e| e.to_string())? {
    if let Ok(cfg) = device.default_output_config() {
      return Ok((device, cfg));
    }
  }
  pick_input_by_index(0)
}

fn resolve_stable_loopback(
  target: &str,
) -> Result<(cpal::Device, cpal::SupportedStreamConfig), String> {
  let mut used_lb = HashSet::new();
  for (_, device, cfg) in collect_outputs()? {
    let key = device_id_key(&device)?;
    let id = device_id::alloc_loopback_id(&key, &mut used_lb);
    if id == target {
      return Ok((device, cfg));
    }
  }
  let mut used_legacy = HashSet::new();
  for (_, device, cfg) in collect_outputs()? {
    let name = device_id_key(&device)?;
    let id = device_id::legacy_alloc_loopback_id(
      &name,
      cfg.channels(),
      cfg.sample_rate(),
      &mut used_legacy,
    );
    if id == target {
      return Ok((device, cfg));
    }
  }
  Err(format!("Unknown loopback device id: {target}"))
}

fn resolve_stable_capture(
  target: &str,
) -> Result<(cpal::Device, cpal::SupportedStreamConfig), String> {
  let mut used_cap = HashSet::new();
  for (_, device, cfg) in collect_inputs()? {
    let key = device_id_key(&device)?;
    let id = device_id::alloc_capture_id(&key, &mut used_cap);
    if id == target {
      return Ok((device, cfg));
    }
  }
  let mut used_legacy = HashSet::new();
  for (_, device, cfg) in collect_inputs()? {
    let name = device_id_key(&device)?;
    let id = device_id::legacy_alloc_capture_id(
      &name,
      cfg.channels(),
      cfg.sample_rate(),
      &mut used_legacy,
    );
    if id == target {
      return Ok((device, cfg));
    }
  }
  Err(format!("Unknown capture device id: {target}"))
}

/// v2 list id for a loopback row matching the given **id key** and current default format.
pub fn loopback_list_id_for_row(
  name: &str,
  channels: u16,
  sample_rate: u32,
) -> Result<Option<String>, String> {
  let mut used_lb = HashSet::new();
  for (_, device, cfg) in collect_outputs()? {
    let row_key = device_id_key(&device)?;
    let id = device_id::alloc_loopback_id(&row_key, &mut used_lb);
    if row_key == name && cfg.channels() == channels && cfg.sample_rate() == sample_rate {
      return Ok(Some(id));
    }
  }
  Ok(None)
}

/// v2 list id for a capture row matching the given **id key** and current default format.
pub fn capture_list_id_for_row(
  name: &str,
  channels: u16,
  sample_rate: u32,
) -> Result<Option<String>, String> {
  let mut used_cap = HashSet::new();
  for (_, device, cfg) in collect_inputs()? {
    let row_key = device_id_key(&device)?;
    let id = device_id::alloc_capture_id(&row_key, &mut used_cap);
    if row_key == name && cfg.channels() == channels && cfg.sample_rate() == sample_rate {
      return Ok(Some(id));
    }
  }
  Ok(None)
}

/// Resolve any supported device id (stable `lb-*`/`cap-*`, legacy index, or `"default"`) to a
/// cpal device + stream config.
pub(crate) fn resolve_device(
  device_id: &str,
) -> Result<(cpal::Device, cpal::SupportedStreamConfig), String> {
  if device_id.is_empty() || device_id == "default" {
    return resolve_default_output();
  }
  if let Some(n) = device_id::parse_legacy_output_index(device_id) {
    return pick_output_by_index(n);
  }
  if let Some(n) = device_id::parse_legacy_input_index(device_id) {
    return pick_input_by_index(n);
  }
  if device_id::is_stable_loopback_id(device_id) {
    return resolve_stable_loopback(device_id);
  }
  if device_id::is_stable_capture_id(device_id) {
    return resolve_stable_capture(device_id);
  }
  Err(format!("Unknown device id: {device_id}"))
}

/// Default `(sample_rate_hz, channels)` for a device id (UI hints).
pub fn device_default_format(device_id: &str) -> Result<(u32, u16), String> {
  let (_, supported) = resolve_device(device_id)?;
  Ok((supported.sample_rate(), supported.channels()))
}

/// Human-readable label, stable id key, and format for a capture target.
pub fn preview_device(device_id: &str) -> Result<(String, String, u32, u16), String> {
  let (device, supported) = resolve_device(device_id)?;
  let label = device_list_label(&device)?;
  let key = device_id_key(&device)?;
  Ok((label, key, supported.sample_rate(), supported.channels()))
}

fn format_device_lines(devices: &[DeviceInfo]) -> String {
  devices
    .iter()
    .map(|d| format!("  - {}", d.label))
    .collect::<Vec<_>>()
    .join("\n")
}

/// Resolve a case-insensitive label substring to exactly one device id.
/// Ambiguity is an error on purpose: VB-Cable installs as two rows ("CABLE
/// Input" and "CABLE Output"), so silently picking one would capture the wrong
/// end of the loop.
pub fn match_device_substring(devices: &[DeviceInfo], needle: &str) -> Result<String, String> {
  let needle_lower = needle.to_lowercase();
  let matches: Vec<&DeviceInfo> = devices
    .iter()
    .filter(|d| d.label.to_lowercase().contains(&needle_lower))
    .collect();

  match matches.len() {
    1 => Ok(matches[0].id.clone()),
    0 => Err(format!(
      "No capture device matches \"{needle}\". Available:\n{}",
      format_device_lines(devices)
    )),
    n => {
      let owned: Vec<DeviceInfo> = matches.into_iter().cloned().collect();
      Err(format!(
        "\"{needle}\" matches {n} devices. Be more specific:\n{}",
        format_device_lines(&owned)
      ))
    }
  }
}

/// Live wrapper: enumerate real devices, then resolve `needle` against them.
pub fn resolve_device_id_by_substring(needle: &str) -> Result<String, String> {
  let devices = build_device_list()?;
  match_device_substring(&devices, needle)
}

#[cfg(test)]
mod substring_tests {
  use super::match_device_substring;
  use crate::audio::device::DeviceInfo;

  fn device(id: &str, label: &str) -> DeviceInfo {
    DeviceInfo {
      id: id.to_string(),
      label: label.to_string(),
      is_system_output_monitor: false,
      is_loopback: false,
      default_sample_rate: 48000,
      channels: 2,
      core_audio_output_uid: None,
    }
  }

  fn fixture() -> Vec<DeviceInfo> {
    vec![
      device("lb-1", "CABLE Input (VB-Audio Virtual Cable)"),
      device("cap-1", "Microphone (Realtek High Definition Audio)"),
      device("cap-2", "CABLE Output (VB-Audio Virtual Cable)"),
    ]
  }

  #[test]
  fn matches_one_device_case_insensitively() {
    assert_eq!(
      match_device_substring(&fixture(), "cable output"),
      Ok("cap-2".to_string())
    );
  }

  #[test]
  fn rejects_ambiguous_substring_and_lists_the_candidates() {
    // VB-Cable installs as both an output (loopback) and an input row, so a bare
    // "CABLE" is genuinely ambiguous and must never silently pick one.
    let err = match_device_substring(&fixture(), "CABLE").unwrap_err();
    assert!(err.contains("matches 2 devices"), "unexpected: {err}");
    assert!(
      err.contains("CABLE Input (VB-Audio Virtual Cable)"),
      "unexpected: {err}"
    );
    assert!(
      err.contains("CABLE Output (VB-Audio Virtual Cable)"),
      "unexpected: {err}"
    );
  }

  #[test]
  fn reports_available_devices_when_nothing_matches() {
    let err = match_device_substring(&fixture(), "vb-cable").unwrap_err();
    assert!(
      err.contains("No capture device matches \"vb-cable\""),
      "unexpected: {err}"
    );
    assert!(
      err.contains("Microphone (Realtek High Definition Audio)"),
      "unexpected: {err}"
    );
  }
}
