//! Device enumeration metadata shared with the frontend.

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
  /// Stable `lb-*` / `cap-*` id (v2: short endpoint name hash; unaffected by speaker layout changes). Legacy `out:N` / `in:N`
  /// and v1 ids still accepted by the backend.
  pub id: String,
  /// UI label (may include extra detail from cpal `DeviceDescription`, e.g. Windows hardware name + endpoint).
  pub label: String,
  /// WASAPI loopback on a **render** endpoint (`out:*`). True when this row is real system-playback monitoring.
  pub is_system_output_monitor: bool,
  /// Legacy: name-based heuristic (Stereo Mix, “loopback” in name, etc.) on **capture** endpoints.
  pub is_loopback: bool,
  pub default_sample_rate: u32,
  pub channels: u16,
  /// macOS 14.2+ Core Audio output device UID (loopback rows only). Omitted on other platforms.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub core_audio_output_uid: Option<String>,
}
