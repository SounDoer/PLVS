use rustfft::num_complex::Complex32;

const MIN_FREQUENCY_HZ: f64 = 20.0;
const MAX_FREQUENCY_HZ: f64 = 20_000.0;
const SILENCE_POWER: f64 = 1.0e-10;

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct SpectralWaveformMetric {
  pub dominant_frequency_hz: f32,
  pub spectral_centroid_hz: f32,
  pub tonality: f32,
}

pub(crate) fn spectral_waveform_metric(
  bins: &[Complex32],
  fft_size: usize,
  sample_rate: f64,
) -> SpectralWaveformMetric {
  if fft_size == 0 || bins.is_empty() || !sample_rate.is_finite() || sample_rate <= 0.0 {
    return SpectralWaveformMetric::default();
  }

  let nyquist_limited_max = MAX_FREQUENCY_HZ.min(sample_rate * 0.5);
  let first_bin = ((MIN_FREQUENCY_HZ * fft_size as f64 / sample_rate).ceil() as usize).max(1);
  let last_bin = ((nyquist_limited_max * fft_size as f64 / sample_rate).floor() as usize)
    .min(bins.len().saturating_sub(1));
  if first_bin > last_bin {
    return SpectralWaveformMetric::default();
  }

  let mut total_power = 0.0;
  let mut weighted_frequency = 0.0;
  let mut squared_power_sum = 0.0;
  let mut peak_power = 0.0;
  let mut peak_bin = first_bin;
  for (bin_index, bin) in bins.iter().enumerate().take(last_bin + 1).skip(first_bin) {
    let power = f64::from(bin.norm_sqr());
    if !power.is_finite() {
      continue;
    }
    let frequency_hz = bin_index as f64 * sample_rate / fft_size as f64;
    total_power += power;
    weighted_frequency += frequency_hz * power;
    squared_power_sum += power * power;
    if power > peak_power {
      peak_power = power;
      peak_bin = bin_index;
    }
  }
  if total_power <= SILENCE_POWER {
    return SpectralWaveformMetric::default();
  }

  let bin_count = (last_bin - first_bin + 1) as f64;
  let concentration = squared_power_sum / (total_power * total_power);
  let normalized_concentration = if bin_count > 1.0 {
    ((bin_count * concentration - 1.0) / (bin_count - 1.0)).clamp(0.0, 1.0)
  } else {
    1.0
  };

  SpectralWaveformMetric {
    dominant_frequency_hz: (peak_bin as f64 * sample_rate / fft_size as f64) as f32,
    spectral_centroid_hz: (weighted_frequency / total_power) as f32,
    tonality: normalized_concentration.sqrt() as f32,
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn identifies_a_tonal_bin_and_reports_high_concentration() {
    let mut bins = vec![Complex32::default(); 2049];
    bins[85] = Complex32::new(1.0, 0.0);
    let metric = spectral_waveform_metric(&bins, 4096, 48_000.0);

    assert!((metric.dominant_frequency_hz - 996.09375).abs() < 0.01);
    assert!((metric.spectral_centroid_hz - 996.09375).abs() < 0.01);
    assert!(metric.tonality > 0.99);
  }

  #[test]
  fn silence_has_no_frequency_or_tonality() {
    let bins = vec![Complex32::default(); 513];
    assert_eq!(
      spectral_waveform_metric(&bins, 1024, 48_000.0),
      SpectralWaveformMetric::default()
    );
  }

  #[test]
  fn broadband_energy_has_lower_concentration_than_a_tone() {
    let broadband = vec![Complex32::new(0.1, 0.0); 2049];
    let metric = spectral_waveform_metric(&broadband, 4096, 48_000.0);
    assert!(metric.tonality < 0.01);
    assert!(metric.spectral_centroid_hz > 9_000.0);
  }
}
