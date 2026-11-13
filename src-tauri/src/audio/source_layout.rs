//! Native speaker metadata, kept separate from user selections and physical channel counts.
//! Queries and channel projection run on ordinary workers, never on an audio callback.

#[derive(Debug)]
pub(crate) enum CaptureWorkerError {
  SystemSpeakerLayout(String),
  Other(String),
}

impl From<String> for CaptureWorkerError {
  fn from(message: String) -> Self {
    Self::Other(message)
  }
}

impl CaptureWorkerError {
  pub(crate) fn message(&self) -> &str {
    match self {
      Self::SystemSpeakerLayout(message) | Self::Other(message) => message,
    }
  }

  pub(crate) fn reason(&self) -> Option<&'static str> {
    match self {
      Self::SystemSpeakerLayout(_) => Some("systemSpeakerLayout"),
      Self::Other(_) => None,
    }
  }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct NativeLayout {
  pub roles: Vec<String>,
  /// Physical stream indices assigned to system speakers. None means no reliable speaker scope.
  pub speakers: Option<Vec<usize>>,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct MonitoringPlan {
  input_channels: u16,
  pub indices: Vec<usize>,
  pub roles: Option<Vec<String>>,
}

impl MonitoringPlan {
  pub fn new(channels: u16, layout: Option<NativeLayout>) -> Self {
    let count = usize::from(channels);
    let mut plan = Self {
      input_channels: channels,
      indices: (0..count).collect(),
      roles: None,
    };
    let Some(layout) = layout.filter(|layout| layout.roles.len() == count) else {
      return plan;
    };
    plan.roles = Some(layout.roles.clone());
    if let Some(indices) = layout.speakers.filter(|indices| {
      !indices.is_empty()
        && indices.iter().all(|i| *i < count)
        && indices
          .iter()
          .enumerate()
          .all(|(n, i)| !indices[..n].contains(i))
    }) {
      plan.indices = indices;
      // Use the product's standard speaker order; routing may put L/R on any device tracks.
      let selected: Vec<_> = plan
        .indices
        .iter()
        .map(|i| layout.roles[*i].clone())
        .collect();
      if let Some(standard) = crate::dsp::channel_layouts::layouts()
        .iter()
        .find(|standard| {
          standard.roles.len() == selected.len()
            && standard
              .roles
              .iter()
              .all(|role| selected.iter().filter(|r| *r == role).count() == 1)
        })
      {
        plan.indices = standard
          .roles
          .iter()
          .map(|role| {
            plan
              .indices
              .iter()
              .copied()
              .find(|i| layout.roles[*i] == *role)
              .expect("matched role")
          })
          .collect();
      }
      plan.roles = Some(
        plan
          .indices
          .iter()
          .map(|i| layout.roles[*i].clone())
          .collect(),
      );
    }
    plan
  }

  pub fn require_system_scope(channels: u16, layout: Option<NativeLayout>) -> Result<Self, String> {
    let layout = layout.ok_or("System speaker configuration is unavailable. Configure speakers for this output or select an input source.")?;
    let indices = layout.speakers.as_ref().ok_or("System speaker configuration is incomplete. Configure speakers for this output or select an input source.")?;
    if layout.roles.len() != usize::from(channels)
      || indices.is_empty()
      || indices.iter().any(|i| *i >= usize::from(channels))
      || indices
        .iter()
        .enumerate()
        .any(|(n, i)| indices[..n].contains(i))
    {
      return Err("System speaker mapping does not match the captured stream.".into());
    }
    Ok(Self::new(channels, Some(layout)))
  }

  pub fn channels(&self) -> u16 {
    self.indices.len() as u16
  }

  pub fn signature(&self) -> String {
    format!("{:?}:{:?}", self.indices, self.roles)
  }

  pub fn pcm<'a>(&self, samples: &'a [f32], scratch: &'a mut Vec<f32>) -> &'a [f32] {
    if self.indices.len() == usize::from(self.input_channels)
      && self
        .indices
        .iter()
        .enumerate()
        .all(|(i, index)| i == *index)
    {
      return samples;
    }
    scratch.clear();
    for frame in samples.chunks_exact(usize::from(self.input_channels)) {
      scratch.extend(self.indices.iter().map(|index| frame[*index]));
    }
    scratch
  }
}

/// Resolve once per capture session. Device inventory includes the plan signature so a system
/// mapping change restarts capture through the existing frontend session boundary.
pub(crate) fn device_layout(
  device: &cpal::Device,
  channels: u16,
  output: bool,
) -> Option<NativeLayout> {
  #[cfg(target_os = "macos")]
  {
    super::macos::device_layout(device, channels, output)
  }
  #[cfg(target_os = "windows")]
  {
    super::windows_layout::read_device(device, channels, output)
  }
  #[cfg(target_os = "linux")]
  {
    super::linux_layout::device_layout(device, channels, output)
  }
}

pub(crate) fn device_plan(device: &cpal::Device, channels: u16, output: bool) -> MonitoringPlan {
  let layout = device_layout(device, channels, output).or_else(|| {
    output.then(|| NativeLayout {
      roles: vec!["generic".into(); usize::from(channels)],
      speakers: None,
    })
  });
  MonitoringPlan::new(channels, layout)
}

/// Capture-only diagnostics avoid logging every device inventory poll.
pub(crate) fn capture_device_layout(
  device: &cpal::Device,
  channels: u16,
  output: bool,
) -> Option<NativeLayout> {
  #[cfg(target_os = "windows")]
  {
    super::windows_layout::read_capture_device(device, channels, output)
  }
  #[cfg(not(target_os = "windows"))]
  {
    device_layout(device, channels, output)
  }
}

#[cfg(any(target_os = "macos", test))]
pub(crate) fn apple_layout(labels: &[u32], explicit_layout: bool) -> NativeLayout {
  let roles = apple_roles(labels);
  let indices: Vec<_> = labels
    .iter()
    .enumerate()
    .filter(|(_, label)| !matches!(**label, 0 | u32::MAX))
    .map(|(i, _)| i)
    .collect();
  NativeLayout {
    roles,
    speakers: ((!indices.is_empty())
      && (explicit_layout || (labels.len() == 2 && indices.len() == 2)))
      .then_some(indices),
  }
}

#[cfg(any(target_os = "macos", test))]
pub(crate) fn apple_roles(labels: &[u32]) -> Vec<String> {
  labels
    .iter()
    .map(|label| {
      match label {
        1 => "L",
        2 => "R",
        3 => "C",
        4 | 37 | 62 => "LFE",
        5 | 10 | 55 => "Ls",
        6 | 11 | 56 => "Rs",
        9 | 44 => "Cs",
        33 | 63 => "Lb",
        34 | 64 => "Rb",
        35 => "Lw",
        36 => "Rw",
        13 => "Ltf",
        15 => "Rtf",
        49 => "Ltm",
        51 => "Rtm",
        16 | 52 => "Ltr",
        18 | 54 => "Rtr",
        42 => "M",
        _ => "generic",
      }
      .to_string()
    })
    .collect()
}

#[cfg(any(target_os = "windows", test))]
pub(crate) fn wave_roles(mask: u32, channels: u16) -> Option<Vec<String>> {
  if mask == 0 || mask.count_ones() > u32::from(channels) {
    return None;
  }
  let side_surrounds = mask & 0x600 != 0;
  let mut roles: Vec<String> = (0..32)
    .filter(|bit| mask & (1 << bit) != 0)
    .map(|bit| {
      match bit {
        0 => "L",
        1 => "R",
        2 if channels == 1 => "M",
        2 => "C",
        3 => "LFE",
        4 if side_surrounds => "Lb",
        5 if side_surrounds => "Rb",
        4 | 9 => "Ls",
        5 | 10 => "Rs",
        8 => "Cs",
        12 => "Ltf",
        14 => "Rtf",
        15 => "Ltr",
        17 => "Rtr",
        _ => "generic",
      }
      .to_string()
    })
    .collect();
  roles.resize(usize::from(channels), "generic".to_string());
  Some(roles)
}

/// Map the configured device speakers to positions in the actual mix stream. Windows' legacy
/// 5.1 back mask denotes the side pair by convention, including when the mix stream is 7.1.
#[cfg(any(target_os = "windows", test))]
pub(crate) fn wave_layout(
  stream_mask: u32,
  channels: u16,
  configured_mask: Option<u32>,
  output: bool,
) -> Option<NativeLayout> {
  let mut roles = if stream_mask == 0 {
    vec!["generic".into(); usize::from(channels)]
  } else {
    wave_roles(stream_mask, channels)?
  };
  if !output {
    return Some(NativeLayout {
      roles,
      speakers: None,
    });
  }
  let stream_positions = |mask: u32| -> Vec<u32> {
    (0..32)
      .filter(|bit| mask & (1 << bit) != 0)
      .map(|bit| {
        if mask == 0x3f && bit >= 4 {
          bit + 5
        } else {
          bit
        }
      })
      .collect()
  };
  let speakers = match configured_mask.filter(|mask| *mask != 0) {
    // A complete stereo engine mix has no spare hardware tracks to accidentally include.
    // Spatial rendering can expose this mix while the endpoint retains a surround setting.
    // Never apply this exception to the first pair of a wider or unlabelled stream.
    Some(configured) if channels == 2 && stream_mask == 3 && configured & 3 == 3 => {
      Some(vec![0, 1])
    }
    Some(configured) if stream_mask == 0 && configured.count_ones() == u32::from(channels) => {
      roles = wave_roles(configured, channels)?;
      Some((0..usize::from(channels)).collect())
    }
    Some(configured) => {
      let positions = stream_positions(stream_mask);
      stream_positions(configured)
        .iter()
        .map(|position| positions.iter().position(|p| p == position))
        .collect::<Option<Vec<_>>>()
    }
    None => Some(
      (0..if stream_mask == 0 {
        usize::from(channels)
      } else {
        stream_mask.count_ones() as usize
      })
        .collect(),
    ),
  };
  Some(NativeLayout { roles, speakers })
}

#[cfg(any(target_os = "linux", test))]
pub(crate) fn pulse_roles(positions: &[u32]) -> Vec<String> {
  let has_sides = positions.iter().any(|p| matches!(p, 10 | 11));
  positions
    .iter()
    .map(|p| {
      match p {
        0 => "M",
        1 => "L",
        2 => "R",
        3 => "C",
        4 => "Cs",
        7 => "LFE",
        5 if has_sides => "Lb",
        6 if has_sides => "Rb",
        5 | 10 => "Ls",
        6 | 11 => "Rs",
        45 => "Ltf",
        46 => "Rtf",
        48 => "Ltr",
        49 => "Rtr",
        _ => "generic",
      }
      .to_string()
    })
    .collect()
}

#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn stereo_scope_extracts_the_configured_pair_and_excludes_other_audio_from_all_consumers() {
    let labels = [u32::MAX, 2, u32::MAX, 1];
    let plan = MonitoringPlan::require_system_scope(4, Some(apple_layout(&labels, true))).unwrap();
    assert_eq!(plan.indices, [3, 1]);
    assert_eq!(plan.roles.as_ref().unwrap(), &["L", "R"]);
    let mut raw = Vec::new();
    for _ in 0..4_800 {
      raw.extend_from_slice(&[0.99, -0.25, 0.75, 0.125]);
    }
    let mut scratch = Vec::new();
    let pcm = plan.pcm(&raw, &mut scratch);
    assert_eq!(&pcm[..4], &[0.125, -0.25, 0.125, -0.25]);
    let measured = super::super::capture::MeasuredPcmSubscriptions::default();
    let receiver = measured.subscribe(2).unwrap();
    measured.publish(pcm, 48_000, plan.channels());
    let recorded = receiver.try_recv().unwrap();
    assert_eq!(recorded.channels, 2);
    assert_eq!(recorded.samples, pcm);
    let mut meter = crate::dsp::summary_meter::SummaryMeter::new_with_roles(
      48_000,
      plan.channels(),
      plan.roles.as_ref().unwrap(),
    )
    .unwrap();
    meter.push_interleaved(pcm);
    assert!(
      meter.finish().true_peak_max_dbtp < -9.0,
      "unselected 0.99 track must not enter True Peak"
    );
  }

  #[test]
  fn configured_surround_is_reordered_without_downmixing_and_inputs_keep_all_tracks() {
    let layout = apple_layout(&[3, 1, 2, 5, 6, 4], true);
    let plan = MonitoringPlan::require_system_scope(6, Some(layout)).unwrap();
    assert_eq!(plan.indices, [1, 2, 0, 5, 3, 4]);
    let mut scratch = Vec::new();
    assert_eq!(
      plan.pcm(&[3.0, 1.0, 2.0, 5.0, 6.0, 4.0], &mut scratch),
      &[1.0, 2.0, 3.0, 4.0, 5.0, 6.0]
    );
    let input = MonitoringPlan::new(16, None);
    assert_eq!(input.channels(), 16);
    assert!(input.roles.is_none());
    assert_eq!(
      pulse_roles(&[2, 1, 7, 5, 6, 10, 11]),
      ["R", "L", "LFE", "Lb", "Rb", "Ls", "Rs"]
    );
  }

  #[test]
  fn ambiguous_or_invalid_system_maps_are_refused_instead_of_truncated() {
    assert!(MonitoringPlan::require_system_scope(16, None).is_err());
    assert!(
      MonitoringPlan::require_system_scope(16, Some(apple_layout(&[u32::MAX; 16], true))).is_err()
    );
    let mut layout = apple_layout(&[1, 2], true);
    layout.speakers = Some(vec![0, 0]);
    assert!(MonitoringPlan::require_system_scope(2, Some(layout)).is_err());
    let fallback = apple_layout(&[1, 2, u32::MAX, u32::MAX], false);
    assert!(MonitoringPlan::require_system_scope(4, Some(fallback)).is_err());
    assert!(MonitoringPlan::require_system_scope(2, Some(apple_layout(&[1, 2], false))).is_ok());
    let left = MonitoringPlan::new(4, Some(apple_layout(&[1, 2, u32::MAX, u32::MAX], true)));
    let right = MonitoringPlan::new(4, Some(apple_layout(&[u32::MAX, u32::MAX, 1, 2], true)));
    assert_ne!(left.signature(), right.signature());
    assert_eq!(left.channels(), right.channels());
  }

  #[test]
  fn windows_speaker_configuration_is_independent_of_mix_stream_width() {
    let stereo =
      MonitoringPlan::require_system_scope(8, wave_layout(0x63f, 8, Some(3), true)).unwrap();
    assert_eq!(stereo.indices, [0, 1]);
    assert_eq!(stereo.roles.unwrap(), ["L", "R"]);
    let surround =
      MonitoringPlan::require_system_scope(8, wave_layout(0x63f, 8, Some(0x3f), true)).unwrap();
    assert_eq!(surround.indices, [0, 1, 2, 3, 6, 7]);
    assert_eq!(surround.roles.unwrap(), ["L", "R", "C", "LFE", "Ls", "Rs"]);
    assert!(
      MonitoringPlan::require_system_scope(6, wave_layout(0x3f, 6, Some(0x63f), true)).is_err()
    );
    assert_eq!(
      MonitoringPlan::new(8, wave_layout(0x63f, 8, Some(3), false)).channels(),
      8
    );
  }

  #[test]
  fn windows_complete_stereo_mix_survives_a_retained_surround_configuration() {
    for configured in [0x3f, 0x60f, 0x63f] {
      let plan =
        MonitoringPlan::require_system_scope(2, wave_layout(3, 2, Some(configured), true)).unwrap();
      assert_eq!(plan.indices, [0, 1]);
      assert_eq!(plan.roles.as_ref().unwrap(), &["L", "R"]);
      assert_eq!(
        plan.pcm(&[0.25, -0.5, 0.5, -0.25], &mut Vec::new()),
        [0.25, -0.5, 0.5, -0.25]
      );
    }
  }

  #[test]
  fn windows_stereo_exception_does_not_admit_spare_or_unmapped_tracks() {
    for (mask, channels, configured) in [
      (3, 4, 0x63f),    // Stereo labels on a wider hardware stream are insufficient.
      (0, 2, 0x63f),    // Channel count alone does not establish L/R.
      (0xc, 2, 0x63f),  // Two channels can represent C/LFE instead of L/R.
      (3, 2, 0xc),      // The configured scope does not include L/R.
      (0x3f, 6, 0x63f), // Other incompatible layouts still refuse capture.
    ] {
      assert!(MonitoringPlan::require_system_scope(
        channels,
        wave_layout(mask, channels, Some(configured), true)
      )
      .is_err());
    }
    let plan =
      MonitoringPlan::require_system_scope(8, wave_layout(0x63f, 8, Some(3), true)).unwrap();
    assert_eq!(plan.indices, [0, 1]);
    let mut scratch = Vec::new();
    assert_eq!(
      plan.pcm(&[0.25, -0.5, 1., 1., 1., 1., 1., 1.], &mut scratch),
      [0.25, -0.5]
    );
  }

  #[test]
  fn native_roles_preserve_order_and_unknown_channels() {
    assert_eq!(
      apple_roles(&[2, 1, u32::MAX, 0, 100]),
      ["R", "L", "generic", "generic", "generic"]
    );
    assert_eq!(
      wave_roles(0x3, 4).unwrap(),
      ["L", "R", "generic", "generic"]
    );
    assert_eq!(
      wave_roles(0x3f, 6).unwrap(),
      ["L", "R", "C", "LFE", "Ls", "Rs"]
    );
    assert_eq!(
      wave_roles(0x63f, 8).unwrap(),
      ["L", "R", "C", "LFE", "Lb", "Rb", "Ls", "Rs"]
    );
    assert!(wave_roles(0, 2).is_none());
    assert!(wave_roles(0x3f, 2).is_none());
  }
}
