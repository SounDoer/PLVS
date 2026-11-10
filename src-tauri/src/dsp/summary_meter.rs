use crate::dsp::channel_layouts::{layout_id_for_roles, roles_for_layout, weights_for_roles};
use crate::dsp::channel_weights::{standard_layout_name, standard_loudness_weights};
use crate::dsp::filters::{init_true_peak_filters, KWeightMono, KWeightStereo};
use crate::dsp::gating::{lufs_from_mean_squares, IntegratedAccumulator, LraAccumulator};
use crate::dsp::max_locations::{MaximaLocations, MetricLocation, PeakLocationTracker};
use crate::dsp::sliding_window::{SlidingWindowMax, S_BLOCKS};

fn db_from_linear(value: f64) -> f64 {
  if value > 0.0 {
    20.0 * value.log10()
  } else {
    f64::NEG_INFINITY
  }
}

/// Whole-file peaks in decoded order. Indices are zero-based, independent of speaker layout.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelPeakMax {
  pub channel_index: u16,
  pub sample_peak_max_db: Option<f64>,
  pub true_peak_max_dbtp: Option<f64>,
  pub sample_peak_max_location: Option<MetricLocation>,
  pub true_peak_max_location: Option<MetricLocation>,
}

pub(crate) fn channel_peak_maxima(samples: &[f64], peaks: &[f64]) -> Vec<ChannelPeakMax> {
  samples
    .iter()
    .zip(peaks)
    .enumerate()
    .map(|(index, (&sample, &tp))| {
      let sample = db_from_linear(sample);
      let tp = db_from_linear(tp);
      ChannelPeakMax {
        channel_index: index as u16,
        sample_peak_max_db: sample.is_finite().then_some(sample),
        true_peak_max_dbtp: tp.is_finite().then_some(tp),
        sample_peak_max_location: None,
        true_peak_max_location: None,
      }
    })
    .collect()
}

#[derive(Debug, Clone)]
pub struct SummaryMetrics {
  pub integrated_lufs: f64,
  pub lra: f64,
  pub m_max_lufs: f64,
  pub st_max_lufs: f64,
  pub true_peak_max_dbtp: f64,
  pub sample_peak_max_db: f64,
  pub channel_peaks: Vec<ChannelPeakMax>,
  pub maxima_locations: Option<MaximaLocations>,
  pub sample_peak_max_l_db: f64,
  pub sample_peak_max_r_db: f64,
  /// `standard_layout_name` for the channel count, or `"unknown"` (Ch1/Ch2 stereo loudness).
  pub loudness_layout: &'static str,
  pub loudness_layout_known: bool,
}

pub struct SummaryMeter {
  sample_rate: f64,
  channels: u16,
  kf: KWeightStereo,
  kf_mc: Vec<KWeightMono>,
  block_size: usize,
  block_sum: [f64; 2],
  block_frames: usize,
  ring: Vec<f64>,
  ring_head: usize,
  ring_count: usize,
  integrated_accumulator: IntegratedAccumulator,
  lra_accumulator: LraAccumulator,
  /// Sample-accurate M/S maxima; `m_max_lufs`/`st_max_lufs` hold those of completed blocks.
  sliding: SlidingWindowMax,
  m_max_lufs: f64,
  st_max_lufs: f64,
  true_peak_max: f64,
  file_locations: Option<Box<PeakLocationTracker>>,
  sample_peaks: Vec<f64>,
  true_peaks: Vec<f64>,
  sample_peak_max_l: f64,
  sample_peak_max_r: f64,
  tp_t: usize,
  tp_p: usize,
  tp_ph: Vec<Vec<f64>>,
  tp_h: Vec<Vec<f64>>,
  tp_wp: Vec<usize>,
  /// BS.1770-5 weights for a standard layout; Ch1/Ch2 only for an unrecognized count above two;
  /// `None` for mono and stereo, which keep their dedicated paths.
  loudness_weights: Option<Vec<f64>>,
  loudness_layout: &'static str,
  loudness_layout_known: bool,
}

impl SummaryMeter {
  pub fn new(sample_rate: u32, channels: u16) -> Self {
    Self::build(sample_rate, channels, None)
  }

  pub fn new_with_layout(sample_rate: u32, channels: u16, layout_id: &str) -> Result<Self, String> {
    let roles =
      roles_for_layout(layout_id).ok_or_else(|| format!("unknown layout: {layout_id}"))?;
    if roles.len() != channels as usize {
      return Err(format!(
        "layout {layout_id} has {} channels, the source has {channels}",
        roles.len()
      ));
    }
    let weights =
      weights_for_roles(roles).ok_or_else(|| format!("layout {layout_id} has an unknown role"))?;
    let layout = layout_id_for_roles(roles).unwrap_or("custom");
    Ok(Self::build(sample_rate, channels, Some((weights, layout))))
  }

  pub fn new_with_roles(sample_rate: u32, channels: u16, roles: &[String]) -> Result<Self, String> {
    if roles.len() != usize::from(channels) {
      return Err("channel roles do not match the capture scope".into());
    }
    let mut weights = weights_for_roles(roles).ok_or("invalid channel role")?;
    let unknown = roles.iter().any(|role| role == "generic");
    let layout = if unknown {
      "unknown"
    } else {
      layout_id_for_roles(roles).unwrap_or("custom")
    };
    if unknown {
      weights.fill(0.0);
      for weight in weights.iter_mut().take(2) {
        *weight = 1.0;
      }
    }
    let mut meter = Self::build(sample_rate, channels, Some((weights, layout)));
    meter.loudness_layout_known = !unknown;
    Ok(meter)
  }

  fn build(sample_rate: u32, channels: u16, selection: Option<(Vec<f64>, &'static str)>) -> Self {
    let sample_rate = sample_rate as f64;
    let (tp_t, tp_p, tp_ph) = init_true_peak_filters();
    let standard_layout = standard_layout_name(channels.max(1));
    let (loudness_weights, loudness_layout, loudness_layout_known) = match selection {
      Some((weights, layout)) => (Some(weights), layout, true),
      None => {
        let weights = match standard_loudness_weights(channels.max(1)) {
          Some(weights) => Some(weights.to_vec()),
          None if channels > 2 => {
            let mut ch1_ch2 = vec![0.0; channels as usize];
            ch1_ch2[0] = 1.0;
            ch1_ch2[1] = 1.0;
            Some(ch1_ch2)
          }
          None => None,
        };
        (
          weights,
          standard_layout.unwrap_or("unknown"),
          standard_layout.is_some(),
        )
      }
    };
    let block_size = (sample_rate * 0.1).round().max(1.0) as usize;
    Self {
      sample_rate,
      channels,
      kf: KWeightStereo::new(sample_rate),
      kf_mc: Vec::new(),
      block_size,
      block_sum: [0.0, 0.0],
      block_frames: 0,
      ring: vec![0.0_f64; 60 * 2],
      ring_head: 0,
      ring_count: 0,
      integrated_accumulator: IntegratedAccumulator::new(),
      lra_accumulator: LraAccumulator::new(),
      sliding: SlidingWindowMax::new(block_size),
      m_max_lufs: f64::NEG_INFINITY,
      st_max_lufs: f64::NEG_INFINITY,
      true_peak_max: 0.0,
      file_locations: None,
      sample_peaks: vec![0.0; channels.max(1) as usize],
      true_peaks: vec![0.0; channels.max(1) as usize],
      sample_peak_max_l: 0.0,
      sample_peak_max_r: 0.0,
      tp_t,
      tp_p,
      tp_ph,
      tp_h: vec![vec![0.0_f64; tp_t]; channels.max(1) as usize],
      tp_wp: vec![0; channels.max(1) as usize],
      loudness_weights,
      loudness_layout,
      loudness_layout_known,
    }
  }

  /// File-only opt-in, called before the first sample; Live constructors leave it disabled.
  pub(crate) fn enable_file_locations(&mut self) {
    self.file_locations = Some(Box::new(PeakLocationTracker::new(self.channels)));
    self.sliding.enable_locations();
  }

  pub fn push_interleaved(&mut self, interleaved: &[f32]) {
    if self.file_locations.is_some() {
      self.push_interleaved_mode::<true>(interleaved);
    } else {
      self.push_interleaved_mode::<false>(interleaved);
    }
  }

  fn push_interleaved_mode<const TRACK: bool>(&mut self, interleaved: &[f32]) {
    let channels = self.channels.max(1) as usize;
    let frames = interleaved.len() / channels;
    // Taken out and put back so the loop can borrow the filters mutably.
    let weights = self.loudness_weights.take();
    self.ensure_multichannel_filters(weights.as_ref().map_or(0, |weights| weights.len()));
    for frame in 0..frames {
      let base = frame * channels;
      let sum_ms = if let Some(weights) = weights.as_deref() {
        let mut sum_ms = 0.0_f64;
        for (index, weight) in weights.iter().copied().enumerate() {
          if weight == 0.0 {
            continue;
          }
          let sample = interleaved[base + index] as f64;
          let weighted = self.kf_mc[index].tick(sample);
          sum_ms += weight * weighted * weighted;
        }
        sum_ms
      } else if channels == 1 {
        let sample = interleaved[base] as f64;
        let (kw_l, kw_r) = self.kf.tick_lr(sample, sample);
        kw_l * kw_l + kw_r * kw_r
      } else {
        let left = interleaved[base] as f64;
        let right = interleaved[base + 1] as f64;
        let (kw_l, kw_r) = self.kf.tick_lr(left, right);
        kw_l * kw_l + kw_r * kw_r
      };

      self.block_sum[0] += sum_ms;
      self.sliding.push_mode::<TRACK>(sum_ms);
      self.update_peaks::<TRACK>(&interleaved[base..base + channels]);
      self.block_frames += 1;
      if self.block_frames >= self.block_size {
        self.close_block();
      }
    }
    self.loudness_weights = weights;
  }

  #[cfg(feature = "capture-harness")]
  pub(crate) fn evidence_true_peak_max(&self) -> f64 {
    db_from_linear(self.true_peak_max)
  }

  pub fn finish(&self) -> SummaryMetrics {
    // Windows ending in the last, partial block are complete windows too.
    let (tail_m, tail_s) = self.sliding.peek_block_max();
    let mut channel_peaks = channel_peak_maxima(&self.sample_peaks, &self.true_peaks);
    if let Some(locations) = self.file_locations.as_ref() {
      locations.annotate(&mut channel_peaks, self.sample_rate);
    }
    SummaryMetrics {
      integrated_lufs: self.integrated_accumulator.value(),
      lra: self.lra_accumulator.value(),
      m_max_lufs: self.m_max_lufs.max(tail_m),
      st_max_lufs: self.st_max_lufs.max(tail_s),
      true_peak_max_dbtp: db_from_linear(self.true_peak_max),
      sample_peak_max_db: db_from_linear(self.sample_peaks.iter().copied().fold(0.0, f64::max)),
      channel_peaks,
      maxima_locations: self
        .file_locations
        .as_ref()
        .map(|locations| locations.maxima(self.sample_rate, self.sliding.maximum_locations())),
      sample_peak_max_l_db: db_from_linear(self.sample_peak_max_l),
      sample_peak_max_r_db: db_from_linear(self.sample_peak_max_r),
      loudness_layout: self.loudness_layout,
      loudness_layout_known: self.loudness_layout_known,
    }
  }

  fn ensure_multichannel_filters(&mut self, len: usize) {
    if len > 0 && self.kf_mc.len() != len {
      self.kf_mc = (0..len)
        .map(|_| KWeightMono::new(self.sample_rate))
        .collect();
    }
  }

  /// Compatibility L/R fields stay Ch1/Ch2 (mono duplicates Ch1).
  fn update_peaks<const TRACK: bool>(&mut self, frame: &[f32]) {
    let left = frame[0] as f64;
    let right = if frame.len() > 1 {
      frame[1] as f64
    } else {
      left
    };
    self.sample_peak_max_l = self.sample_peak_max_l.max(left.abs());
    self.sample_peak_max_r = self.sample_peak_max_r.max(right.abs());
    for (channel, sample) in frame.iter().enumerate() {
      let tp = self.tp_sample::<TRACK>(*sample as f64, channel);
      self.true_peak_max = self.true_peak_max.max(tp);
      self.sample_peaks[channel] = self.sample_peaks[channel].max((*sample as f64).abs());
      self.true_peaks[channel] = self.true_peaks[channel].max(tp);
    }
    if TRACK {
      if let Some(locations) = self.file_locations.as_mut() {
        locations.end_frame();
      }
    }
  }

  fn tp_sample<const TRACK: bool>(&mut self, sample: f64, channel: usize) -> f64 {
    let write_pos = self.tp_wp[channel];
    self.tp_h[channel][write_pos] = sample;
    self.tp_wp[channel] = if write_pos + 1 == self.tp_t {
      0
    } else {
      write_pos + 1
    };
    if TRACK {
      if let Some(locations) = self.file_locations.as_mut() {
        locations.sample(channel, sample);
      }
    }
    let mut max = sample.abs();
    for phase in 1..self.tp_p {
      let mut y = 0.0;
      for (tap, coeff) in self.tp_ph[phase].iter().enumerate().take(self.tp_t) {
        // A branch, not `%`: the runtime-divisor modulo dominated this loop at 8–16 channels.
        let index = if tap <= write_pos {
          write_pos - tap
        } else {
          write_pos + self.tp_t - tap
        };
        y += coeff * self.tp_h[channel][index];
      }
      max = max.max(y.abs());
      if TRACK {
        if let Some(locations) = self.file_locations.as_mut() {
          locations.interpolated(channel, y, phase, self.tp_t, self.tp_p);
        }
      }
    }
    max
  }

  fn close_block(&mut self) {
    let mean = [
      self.block_sum[0] / self.block_frames as f64,
      self.block_sum[1] / self.block_frames as f64,
    ];
    let ring_index = self.ring_head * 2;
    self.ring[ring_index] = mean[0];
    self.ring[ring_index + 1] = mean[1];
    self.ring_head = (self.ring_head + 1) % 60;
    self.ring_count = (self.ring_count + 1).min(60);
    self.integrated_accumulator.push(mean);

    let (momentary_max, short_term_max) = self.sliding.take_block_max();
    self.m_max_lufs = self.m_max_lufs.max(momentary_max);
    self.st_max_lufs = self.st_max_lufs.max(short_term_max);
    // LRA takes S at the 10 Hz block rate, as EBU Tech 3342 specifies, and only complete 3 s
    // windows; the silence-padded readings before that would widen it.
    let short_term = self.window_lufs(S_BLOCKS);
    if self.ring_count >= S_BLOCKS && short_term.is_finite() {
      self.lra_accumulator.push(short_term);
    }

    self.block_sum = [0.0, 0.0];
    self.block_frames = 0;
  }

  /// Loudness of the last `blocks` blocks, counting the time before the meter started as silence.
  fn window_lufs(&self, blocks: usize) -> f64 {
    let mut sum = [0.0_f64, 0.0_f64];
    for offset in 0..blocks.min(self.ring_count) {
      let index = ((self.ring_head + 60 - 1 - offset) % 60) * 2;
      sum[0] += self.ring[index];
      sum[1] += self.ring[index + 1];
    }
    lufs_from_mean_squares(sum[0] / blocks as f64, sum[1] / blocks as f64)
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn run(channels: u16, pcm: &[f32]) -> SummaryMetrics {
    let mut meter = SummaryMeter::new(48_000, channels);
    meter.push_interleaved(pcm);
    meter.finish()
  }

  #[test]
  fn true_peak_max_covers_every_channel() {
    let channels = 8_usize;
    let mut pcm = Vec::with_capacity(48_000 * channels);
    for n in 0..48_000 {
      let x = (std::f64::consts::PI * n as f64 / 2.0 + std::f64::consts::FRAC_PI_4).sin();
      for ch in 0..channels {
        pcm.push(if ch == 7 { x as f32 } else { 0.0 });
      }
    }
    let metrics = run(channels as u16, &pcm);
    assert!(
      metrics.true_peak_max_dbtp.abs() < 0.25,
      "channel 8 peak should reach 0 dBTP, got {}",
      metrics.true_peak_max_dbtp
    );
    assert!(!metrics.sample_peak_max_l_db.is_finite());
  }

  #[test]
  fn empty_input_preserves_channel_identity_with_null_peaks() {
    let metrics = run(10, &[]);
    assert_eq!(metrics.channel_peaks.len(), 10);
    assert_eq!(metrics.sample_peak_max_db, f64::NEG_INFINITY);
    for (index, peak) in metrics.channel_peaks.iter().enumerate() {
      assert_eq!(usize::from(peak.channel_index), index);
      assert_eq!(peak.sample_peak_max_db, None);
      assert_eq!(peak.true_peak_max_dbtp, None);
    }
  }

  #[test]
  fn layout_is_reported_from_channel_count() {
    let eight = run(8, &vec![0.0; 4_800 * 8]);
    assert_eq!(
      (eight.loudness_layout, eight.loudness_layout_known),
      ("7.1", true)
    );
    let ten = run(10, &vec![0.0; 4_800 * 10]);
    assert_eq!(
      (ten.loudness_layout, ten.loudness_layout_known),
      ("unknown", false)
    );
  }

  #[test]
  fn back_surrounds_weigh_one_point_five_lu_below_side_surrounds() {
    let tone = |active: [usize; 2]| -> Vec<f32> {
      let mut pcm = vec![0.0_f32; 48_000 * 4 * 8];
      for n in 0..48_000 * 4 {
        let s = (2.0 * std::f64::consts::PI * 1000.0 * n as f64 / 48_000.0).sin() as f32 * 0.1;
        for ch in active {
          pcm[n * 8 + ch] = s;
        }
      }
      pcm
    };
    let back = run(8, &tone([4, 5]));
    let side = run(8, &tone([6, 7]));
    assert!(
      (side.integrated_lufs - back.integrated_lufs - 1.5).abs() < 0.01,
      "side {} vs back {}",
      side.integrated_lufs,
      back.integrated_lufs
    );
  }
}

#[cfg(test)]
mod location_tests {
  use super::*;

  #[test]
  fn file_opt_in_leaves_live_summary_values_bit_identical() {
    for channels in [1_u16, 2, 8, 10] {
      let mut live = SummaryMeter::new(48_000, channels);
      let mut file = SummaryMeter::new(48_000, channels);
      file.enable_file_locations();
      let pcm: Vec<f32> = (0..50_403)
        .flat_map(|frame| {
          (0..channels).map(move |ch| {
            ((frame as f64 * 0.13 + f64::from(ch)).sin()
              * if frame < 48_000 { 0.125 } else { 0.75 }) as f32
          })
        })
        .collect();
      for chunk in pcm.chunks(997 * usize::from(channels)) {
        live.push_interleaved(chunk);
        file.push_interleaved(chunk);
      }
      let a = live.finish();
      let b = file.finish();
      assert!(a.maxima_locations.is_none());
      assert!(live.file_locations.is_none());
      for (a, b) in [
        (a.integrated_lufs, b.integrated_lufs),
        (a.lra, b.lra),
        (a.m_max_lufs, b.m_max_lufs),
        (a.st_max_lufs, b.st_max_lufs),
        (a.true_peak_max_dbtp, b.true_peak_max_dbtp),
        (a.sample_peak_max_db, b.sample_peak_max_db),
        (a.sample_peak_max_l_db, b.sample_peak_max_l_db),
        (a.sample_peak_max_r_db, b.sample_peak_max_r_db),
      ] {
        assert_eq!(a.to_bits(), b.to_bits());
      }
      for (a, b) in a.channel_peaks.iter().zip(&b.channel_peaks) {
        assert_eq!(a.sample_peak_max_db, b.sample_peak_max_db);
        assert_eq!(a.true_peak_max_dbtp, b.true_peak_max_dbtp);
        assert_eq!(a.sample_peak_max_location, None);
        assert_eq!(a.true_peak_max_location, None);
      }
    }
  }

  /// Brute-force convolution in source coordinates, independent of the circular FIR intake.
  #[test]
  fn true_peak_locations_match_offline_convolution_including_start_and_tail() {
    let (_, phases, coefficients) = crate::dsp::filters::init_true_peak_filters();
    for pcm in [
      vec![1.0_f32, -1.0, 1.0, -1.0, 0.0, 0.0],
      (0..129)
        .map(|n| (0.75 * (n as f64 * 0.7 + 0.2).sin()) as f32)
        .collect(),
      vec![0.0, 0.0, 0.0, 0.75],
    ] {
      let mut meter = SummaryMeter::new(48_000, 1);
      meter.enable_file_locations();
      meter.push_interleaved(&pcm);
      let mut candidates = Vec::new();
      for (n, &sample) in pcm.iter().enumerate() {
        candidates.push((f64::from(sample).abs(), n as f64));
        for (phase, taps) in coefficients.iter().enumerate().skip(1) {
          let value: f64 = taps
            .iter()
            .enumerate()
            .map(|(k, c)| {
              if k <= n {
                c * f64::from(pcm[n - k])
              } else {
                0.0
              }
            })
            .sum();
          candidates.push((
            value.abs(),
            n as f64 + phase as f64 / phases as f64 - 15.875,
          ));
        }
      }
      candidates.sort_by(|a, b| b.0.total_cmp(&a.0).then_with(|| a.1.total_cmp(&b.1)));
      let result = meter.finish();
      assert_eq!(
        result.channel_peaks[0]
          .true_peak_max_location
          .as_ref()
          .unwrap()
          .frame_position,
        candidates[0].1
      );
      assert_eq!(
        result.true_peak_max_dbtp.to_bits(),
        (20.0 * candidates[0].0.log10()).to_bits()
      );
    }
  }
}
