//! PulseAudio/PipeWire speaker scope and the exact record-stream channel map.
use super::source_layout::{pulse_roles, NativeLayout};
use cpal::traits::DeviceTrait;
use futures::executor::block_on;

pub(crate) fn device_layout(
  device: &cpal::Device,
  channels: u16,
  output: bool,
) -> Option<NativeLayout> {
  if !output {
    return None;
  }
  let name = device.id().ok()?.id().to_string();
  super::linux_devices::query(move |client| {
    let source = block_on(client.list_sources())
      .map_err(|e| e.to_string())?
      .into_iter()
      .find(|source| source.name.to_string_lossy() == name)
      .ok_or("capture source disappeared")?;
    let positions: Vec<u32> = (&source.channel_map)
      .into_iter()
      .map(|p| p as u32)
      .collect();
    if positions.len() != usize::from(channels) {
      return Err("channel map changed".into());
    }
    let sink_index = source.monitor_of_sink_index.ok_or("not a sink monitor")?;
    let sink = block_on(client.list_sinks())
      .map_err(|e| e.to_string())?
      .into_iter()
      .find(|sink| sink.index == sink_index)
      .ok_or("output sink disappeared")?;
    let speakers = (&sink.channel_map)
      .into_iter()
      .map(|position| positions.iter().position(|p| *p == position as u32))
      .collect::<Option<Vec<_>>>();
    Ok(NativeLayout {
      roles: pulse_roles(&positions),
      speakers,
    })
  })
  .ok()
}
