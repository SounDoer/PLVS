//! Linux desktop sources through PulseAudio (including PipeWire's pulse server).
//! Sink monitors are real input sources; an output device cannot be opened for capture.

use std::collections::HashSet;
use std::ffi::CString;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait};
use futures::executor::block_on;

type DeviceRow = (usize, cpal::Device, cpal::SupportedStreamConfig);
static QUERY_RUNNING: AtomicBool = AtomicBool::new(false);

/// Bound discovery waits and prevent repeated timeouts from spawning unbounded workers.
/// All server queries and allocation run outside the realtime capture callback.
fn query<T: Send + 'static>(
  operation: impl FnOnce(pulseaudio::Client) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
  let waiting = Instant::now();
  while QUERY_RUNNING
    .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
    .is_err()
  {
    if waiting.elapsed() >= Duration::from_secs(5) {
      return Err("Linux audio discovery is still busy; try again shortly.".into());
    }
    std::thread::sleep(Duration::from_millis(5));
  }
  let (tx, rx) = std::sync::mpsc::channel();
  let worker = std::thread::Builder::new()
    .name("plvs-pulse-discovery".into())
    .spawn(move || {
      struct QueryGuard;
      impl Drop for QueryGuard {
        fn drop(&mut self) {
          QUERY_RUNNING.store(false, Ordering::Release);
        }
      }
      let guard = QueryGuard;
      let name = CString::new("PLVS Source Discovery").expect("literal has no NUL");
      let result = pulseaudio::Client::from_env(&name)
        .map_err(|e| format!("Cannot connect to PulseAudio or pipewire-pulse: {e}"))
        .and_then(operation);
      drop(guard);
      let _ = tx.send(result);
    });
  if let Err(error) = worker {
    QUERY_RUNNING.store(false, Ordering::Release);
    return Err(format!("Cannot start Linux audio discovery: {error}"));
  }
  rx.recv_timeout(Duration::from_secs(5))
    .map_err(|e| format!("Linux audio discovery did not complete: {e}"))?
}

fn pulse_host() -> Result<cpal::Host, String> {
  cpal::host_from_id(cpal::HostId::PulseAudio)
    .map_err(|e| format!("Cannot connect to PulseAudio or pipewire-pulse: {e}"))
}

/// Request float PCM from the server while preserving its native rate and channel count.
/// This also supports devices whose native integer format the shared callback does not handle.
fn capture_config(device: &cpal::Device) -> Result<cpal::SupportedStreamConfig, String> {
  let native = device.default_input_config().map_err(|e| e.to_string())?;
  Ok(cpal::SupportedStreamConfig::new(
    native.channels(),
    native.sample_rate(),
    *native.buffer_size(),
    cpal::SampleFormat::F32,
  ))
}

fn collect(monitors: bool) -> Result<Vec<DeviceRow>, String> {
  query(move |client| {
    let sources = block_on(client.list_sources()).map_err(|e| e.to_string())?;
    let names = select_source_names(
      sources.into_iter().map(|source| {
        (
          source.name.to_string_lossy().into_owned(),
          source.monitor_of_sink_index,
        )
      }),
      monitors,
    );
    let host = pulse_host()?;
    let mut rows = Vec::new();
    for (index, device) in host.input_devices().map_err(|e| e.to_string())?.enumerate() {
      let id = device.id().map_err(|e| e.to_string())?;
      if names.contains(id.id()) {
        let config = capture_config(&device)?;
        rows.push((index, device, config));
      }
    }
    rows
      .sort_by_key(|(_, device, _)| super::device_enum::device_id_key(device).unwrap_or_default());
    Ok(rows)
  })
}

fn select_source_names(
  sources: impl IntoIterator<Item = (String, Option<u32>)>,
  monitors: bool,
) -> HashSet<String> {
  sources
    .into_iter()
    .filter(|(_, monitor_sink)| monitor_sink.is_some() == monitors)
    .map(|(name, _)| name)
    .collect()
}

pub(crate) fn collect_outputs() -> Result<Vec<DeviceRow>, String> {
  collect(true)
}

pub(crate) fn collect_inputs() -> Result<Vec<DeviceRow>, String> {
  collect(false)
}

pub(crate) fn resolve_default_output() -> Result<(cpal::Device, cpal::SupportedStreamConfig), String>
{
  query(|client| {
    let sink = block_on(client.sink_info_by_name(pulseaudio::protocol::DEFAULT_SINK.to_owned()))
      .map_err(|e| format!("Cannot resolve the default output: {e}"))?;
    let monitor_name = sink
      .monitor_source_name
      .map(|name| name.to_string_lossy().into_owned())
      .ok_or_else(|| "The default output has no monitor source.".to_string())?;
    let host = pulse_host()?;
    for device in host.input_devices().map_err(|e| e.to_string())? {
      if device.id().map_err(|e| e.to_string())?.id() == monitor_name {
        let config = capture_config(&device)?;
        return Ok((device, config));
      }
    }
    // Automatic must never silently become microphone capture.
    Err("The default output's monitor source is no longer available.".into())
  })
}

pub(crate) fn pick_output_by_index(
  target: usize,
) -> Result<(cpal::Device, cpal::SupportedStreamConfig), String> {
  pick_by_index(collect_outputs()?, target)
}

pub(crate) fn pick_input_by_index(
  target: usize,
) -> Result<(cpal::Device, cpal::SupportedStreamConfig), String> {
  pick_by_index(collect_inputs()?, target)
}

fn pick_by_index(
  rows: Vec<DeviceRow>,
  target: usize,
) -> Result<(cpal::Device, cpal::SupportedStreamConfig), String> {
  rows
    .into_iter()
    .find(|(index, _, _)| *index == target)
    .map(|(_, device, config)| (device, config))
    .ok_or_else(|| format!("Capture source index not found: {target}"))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn source_roles_come_from_server_metadata_not_names() {
    let sources = vec![
      ("microphone.monitor".to_string(), None),
      ("custom-output-tap".to_string(), Some(0)),
      ("second-output".to_string(), Some(42)),
    ];
    assert_eq!(
      select_source_names(sources.clone(), true),
      HashSet::from(["custom-output-tap".into(), "second-output".into()])
    );
    assert_eq!(
      select_source_names(sources, false),
      HashSet::from(["microphone.monitor".into()])
    );
  }
}
