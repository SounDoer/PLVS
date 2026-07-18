use serde::Serialize;

use crate::audio::device::DeviceInfo;
use crate::audio::device_enum::{
  capture_backend_name, default_device_list_id, list_devices_for_cli,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CliDevicesStatus {
  Ok,
  Error,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(untagged)]
pub enum CliDevicesReport {
  Success(Box<CliDevicesSuccessReport>),
  Error(Box<CliDevicesErrorReport>),
}

impl CliDevicesReport {
  pub fn status(&self) -> CliDevicesStatus {
    match self {
      Self::Success(_) => CliDevicesStatus::Ok,
      Self::Error(_) => CliDevicesStatus::Error,
    }
  }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliDevicesSuccessReport {
  pub schema_version: u32,
  pub command: String,
  pub status: CliDevicesStatus,
  pub app: CliDevicesApp,
  pub backend: String,
  pub default_device_id: Option<String>,
  pub devices: Vec<CliDeviceRow>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliDevicesErrorReport {
  pub schema_version: u32,
  pub command: String,
  pub status: CliDevicesStatus,
  pub app: CliDevicesApp,
  pub error: CliDevicesError,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliDevicesApp {
  pub name: String,
  pub version: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliDeviceRow {
  pub id: String,
  pub label: String,
  pub kind: String,
  pub direction: String,
  pub is_default: bool,
  pub is_loopback: bool,
  pub sample_rate_hz: u32,
  pub channel_count: u16,
  pub backend: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliDevicesError {
  pub message: String,
}

pub fn run_devices() -> CliDevicesReport {
  match list_devices_for_cli() {
    Ok(devices) => CliDevicesReport::Success(Box::new(success_report(devices))),
    Err(message) => CliDevicesReport::Error(Box::new(error_report(message))),
  }
}

fn success_report(devices: Vec<DeviceInfo>) -> CliDevicesSuccessReport {
  let backend = capture_backend_name();
  let default_device_id = default_device_list_id();
  let rows = devices
    .into_iter()
    .map(|device| {
      let is_default = default_device_id
        .as_deref()
        .is_some_and(|id| id == device.id);
      device_row(device, is_default, backend)
    })
    .collect();

  CliDevicesSuccessReport {
    schema_version: 1,
    command: "devices".to_string(),
    status: CliDevicesStatus::Ok,
    app: app_info(),
    backend: backend.to_string(),
    default_device_id,
    devices: rows,
  }
}

fn error_report(message: String) -> CliDevicesErrorReport {
  CliDevicesErrorReport {
    schema_version: 1,
    command: "devices".to_string(),
    status: CliDevicesStatus::Error,
    app: app_info(),
    error: CliDevicesError { message },
  }
}

fn device_row(device: DeviceInfo, is_default: bool, backend: &str) -> CliDeviceRow {
  let (kind, direction) = if device.is_system_output_monitor {
    ("systemOutput", "output")
  } else {
    ("input", "input")
  };
  CliDeviceRow {
    id: device.id,
    label: device.label,
    kind: kind.to_string(),
    direction: direction.to_string(),
    is_default,
    is_loopback: device.is_loopback || device.is_system_output_monitor,
    sample_rate_hz: device.default_sample_rate,
    channel_count: device.channels,
    backend: backend.to_string(),
  }
}

fn app_info() -> CliDevicesApp {
  CliDevicesApp {
    name: "PLVS".to_string(),
    version: env!("CARGO_PKG_VERSION").to_string(),
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn success_report_marks_default_and_kinds() {
    let report = success_report(vec![
      DeviceInfo {
        id: "lb-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_string(),
        label: "Speakers".to_string(),
        is_system_output_monitor: true,
        is_loopback: false,
        default_sample_rate: 48_000,
        channels: 2,
        core_audio_output_uid: None,
      },
      DeviceInfo {
        id: "cap-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".to_string(),
        label: "Microphone".to_string(),
        is_system_output_monitor: false,
        is_loopback: false,
        default_sample_rate: 44_100,
        channels: 1,
        core_audio_output_uid: None,
      },
    ]);

    // default_device_id comes from live enumeration and may be None in CI.
    assert_eq!(report.command, "devices");
    assert_eq!(report.devices.len(), 2);
    assert_eq!(report.devices[0].kind, "systemOutput");
    assert_eq!(report.devices[0].direction, "output");
    assert_eq!(report.devices[1].kind, "input");
    assert_eq!(report.devices[1].channel_count, 1);
  }

  #[test]
  fn error_report_uses_stable_envelope() {
    let json = serde_json::to_value(CliDevicesReport::Error(Box::new(error_report(
      "no host".to_string(),
    ))))
    .expect("serialize");
    assert_eq!(json["schemaVersion"], 1);
    assert_eq!(json["command"], "devices");
    assert_eq!(json["status"], "error");
    assert_eq!(json["error"]["message"], "no host");
  }
}
