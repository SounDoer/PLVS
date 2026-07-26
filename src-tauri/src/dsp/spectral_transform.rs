use realfft::RealFftPlanner;
use rustfft::num_complex::Complex32;

pub struct ComplexSpectralFrame<'a> {
  pub fft_size: usize,
  pub sample_clock: u64,
  pub bins: &'a [Complex32],
}

pub struct SpectralTransform {
  fft_size: usize,
  hop: usize,
  r2c: std::sync::Arc<dyn realfft::RealToComplex<f32>>,
  scratch_in: Vec<f32>,
  scratch_spec: Vec<Complex32>,
  fft_scratch: Vec<Complex32>,
  window: Vec<f32>,
  ring: Vec<f32>,
  write: usize,
  filled: usize,
  sample_clock: u64,
  last_frame_sample_clock: Option<u64>,
}

impl SpectralTransform {
  pub fn new(fft_size: usize, overlap: usize, initial_sample_clock: u64) -> Self {
    assert!(fft_size > 0, "fft_size must be positive");
    assert!(
      overlap > 0 && overlap <= fft_size,
      "overlap must produce a non-zero hop"
    );
    let mut planner = RealFftPlanner::<f32>::new();
    let r2c = planner.plan_fft_forward(fft_size);
    let scratch_spec = r2c.make_output_vec();
    let fft_scratch = r2c.make_scratch_vec();
    let mut window = vec![0.0_f32; fft_size];
    for (n, w) in window.iter_mut().enumerate() {
      *w = (0.5
        * (1.0 - (2.0 * std::f64::consts::PI * n as f64 / (fft_size - 1).max(1) as f64).cos()))
        as f32;
    }
    Self {
      fft_size,
      hop: fft_size / overlap,
      r2c,
      scratch_in: vec![0.0; fft_size],
      scratch_spec,
      fft_scratch,
      window,
      ring: vec![0.0; fft_size],
      write: initial_sample_clock as usize % fft_size,
      filled: 0,
      sample_clock: initial_sample_clock,
      last_frame_sample_clock: None,
    }
  }

  #[cfg(test)]
  pub fn hop_size(&self) -> usize {
    self.hop
  }

  #[allow(dead_code)]
  pub fn last_frame(&self) -> Option<ComplexSpectralFrame<'_>> {
    self
      .last_frame_sample_clock
      .map(|sample_clock| ComplexSpectralFrame {
        fft_size: self.fft_size,
        sample_clock,
        bins: &self.scratch_spec,
      })
  }

  pub fn push_sample(&mut self, sample: f32) -> Option<ComplexSpectralFrame<'_>> {
    self.ring[self.write] = sample;
    self.write = (self.write + 1) % self.fft_size;
    self.filled = (self.filled + 1).min(self.fft_size);
    self.sample_clock = self.sample_clock.wrapping_add(1);
    if self.filled < self.fft_size || !self.sample_clock.is_multiple_of(self.hop as u64) {
      return None;
    }

    for (i, slot) in self.scratch_in.iter_mut().enumerate() {
      let idx = (self.write + i) % self.fft_size;
      *slot = self.ring[idx] * self.window[i];
    }
    self
      .r2c
      .process_with_scratch(
        &mut self.scratch_in,
        &mut self.scratch_spec,
        &mut self.fft_scratch,
      )
      .expect("fft");

    let bin_count = self.scratch_spec.len();
    let n = self.fft_size as f32;
    for (k, bin) in self.scratch_spec.iter_mut().enumerate() {
      let scale = if k == 0 || (self.fft_size.is_multiple_of(2) && k + 1 == bin_count) {
        1.0 / n
      } else {
        2.0 / n
      };
      *bin *= scale;
    }

    self.last_frame_sample_clock = Some(self.sample_clock);
    Some(ComplexSpectralFrame {
      fft_size: self.fft_size,
      sample_clock: self.sample_clock,
      bins: &self.scratch_spec,
    })
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn collect_frames(
    transform: &mut SpectralTransform,
    chunks: &[&[f32]],
  ) -> Vec<(u64, Vec<Complex32>)> {
    let mut frames = Vec::new();
    for chunk in chunks {
      for &sample in *chunk {
        if let Some(frame) = transform.push_sample(sample) {
          frames.push((frame.sample_clock, frame.bins.to_vec()));
        }
      }
    }
    frames
  }

  #[test]
  fn emits_nothing_before_a_full_window() {
    let mut transform = SpectralTransform::new(8, 2, 0);
    for _ in 0..7 {
      assert!(transform.push_sample(0.0).is_none());
    }
  }

  #[test]
  fn emits_only_on_the_global_hop_phase() {
    let mut transform = SpectralTransform::new(8, 4, 1);
    let mut emitted_at = Vec::new();
    for _ in 0..13 {
      if let Some(frame) = transform.push_sample(0.0) {
        emitted_at.push(frame.sample_clock);
      }
    }
    assert_eq!(emitted_at, vec![10, 12, 14]);
  }

  #[test]
  fn produces_finite_normalized_bins_for_silence_and_aligned_sine() {
    const FFT_SIZE: usize = 16;
    let silence = vec![0.0; FFT_SIZE];
    let mut silence_transform = SpectralTransform::new(FFT_SIZE, 2, 0);
    let silence_frames = collect_frames(&mut silence_transform, &[&silence]);
    let silence_bins = &silence_frames[0].1;
    assert!(silence_bins
      .iter()
      .all(|bin| bin.re.is_finite() && bin.im.is_finite()));
    assert!(silence_bins.iter().all(|bin| bin.norm() == 0.0));

    let aligned_sine: Vec<f32> = (0..FFT_SIZE)
      .map(|i| (2.0 * std::f32::consts::PI * 2.0 * i as f32 / FFT_SIZE as f32).sin())
      .collect();
    let mut sine_transform = SpectralTransform::new(FFT_SIZE, 2, 0);
    let sine_frames = collect_frames(&mut sine_transform, &[&aligned_sine]);
    let sine_bins = &sine_frames[0].1;
    assert!(sine_bins
      .iter()
      .all(|bin| bin.re.is_finite() && bin.im.is_finite()));
    assert!(
      (0.4..0.55).contains(&sine_bins[2].norm()),
      "aligned full-scale sine bin should be one-sided normalized, got {}",
      sine_bins[2].norm()
    );
  }

  #[test]
  fn odd_fft_normalizes_the_last_bin_as_a_non_nyquist_bin() {
    const FFT_SIZE: usize = 9;
    const BIN: usize = FFT_SIZE / 2;
    let samples: Vec<f32> = (0..FFT_SIZE)
      .map(|i| (2.0 * std::f32::consts::PI * BIN as f32 * i as f32 / FFT_SIZE as f32).sin())
      .collect();
    let expected = samples
      .iter()
      .enumerate()
      .map(|(i, &sample)| {
        let window =
          0.5 * (1.0 - (2.0 * std::f32::consts::PI * i as f32 / (FFT_SIZE - 1) as f32).cos());
        let phase = -2.0 * std::f32::consts::PI * BIN as f32 * i as f32 / FFT_SIZE as f32;
        Complex32::from_polar(sample * window, phase)
      })
      .sum::<Complex32>()
      * (2.0 / FFT_SIZE as f32);

    let mut transform = SpectralTransform::new(FFT_SIZE, 1, 0);
    let frames = collect_frames(&mut transform, &[&samples]);
    let actual = frames[0].1[BIN];

    assert!(
      (actual - expected).norm() < 1e-5,
      "odd-size last bin must use 2/N normalization: actual={actual:?}, expected={expected:?}"
    );
  }

  #[test]
  fn late_transform_uses_the_supplied_clock_for_ring_and_hop_position() {
    let samples: Vec<f32> = (1..=20).map(|clock| (clock as f32 * 0.37).sin()).collect();

    let mut reference = SpectralTransform::new(8, 2, 0);
    let reference_frames = collect_frames(&mut reference, &[&samples]);
    let reference_at_20 = reference_frames
      .iter()
      .find(|(clock, _)| *clock == 20)
      .expect("reference frame at clock 20");

    let mut late = SpectralTransform::new(8, 2, 11);
    let late_frames = collect_frames(&mut late, &[&samples[11..]]);

    assert_eq!(late_frames.len(), 1);
    assert_eq!(late_frames[0].0, 20);
    assert_eq!(late_frames[0].1, reference_at_20.1);
  }

  #[test]
  fn output_is_identical_across_pcm_chunk_boundaries() {
    let samples: Vec<f32> = (0..37).map(|i| (i as f32 * 0.21).cos()).collect();
    let mut contiguous = SpectralTransform::new(8, 2, 0);
    let contiguous_frames = collect_frames(&mut contiguous, &[&samples]);

    let mut chunked = SpectralTransform::new(8, 2, 0);
    let chunked_frames = collect_frames(
      &mut chunked,
      &[
        &samples[..3],
        &samples[3..12],
        &samples[12..13],
        &samples[13..],
      ],
    );

    assert_eq!(chunked_frames, contiguous_frames);
  }
}
