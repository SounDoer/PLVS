//! Cross-check against an independent implementation: FFmpeg's `ebur128` filter.
//!
//! The EBU conformance suite (`ebu_conformance`) uses tones. This runs programme-like material —
//! shaped noise with tonal content and level steps, stereo and 5.1, at 44.1 and 48 kHz — through
//! both PLVS meters and through `ebur128`, and requires the readings to agree.
//!
//! The bundled FFmpeg sidecar is built without filters, so this needs a full FFmpeg build:
//! `PLVS_REFERENCE_FFMPEG` names its path, otherwise `ffmpeg` is taken from `PATH`. The test is
//! ignored by default because CI runners do not provide one; run it with
//! `npm run verify:loudness-reference`, which fails rather than skips when no reference exists.

use super::ebu_conformance::{file_metrics, live_blocks};
use std::f64::consts::PI;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Integrated: `ebur128` gates on a 0.1 LU histogram, so its reading can sit up to ~0.05 LU off
/// the exact value. LRA picks two percentiles from that histogram. True peak: both oversample
/// 4x, with different interpolation filters; EBU Tech 3341 allows +0.2/-0.4 dB against the true
/// value, so 0.2 dB between two compliant meters is already generous. Sample peak is exact up to
/// the reference's 3-decimal linear print.
const TOL_INTEGRATED: f64 = 0.1;
const TOL_LRA: f64 = 0.2;
const TOL_TRUE_PEAK: f64 = 0.2;
const TOL_SAMPLE_PEAK: f64 = 0.05;

fn reference_ffmpeg() -> PathBuf {
  let path = std::env::var_os("PLVS_REFERENCE_FFMPEG")
    .map(PathBuf::from)
    .unwrap_or_else(|| PathBuf::from("ffmpeg"));
  let filters = Command::new(&path)
    .args(["-hide_banner", "-filters"])
    .output()
    .unwrap_or_else(|e| {
      panic!(
        "no reference FFmpeg at {}: {e}. Install a full FFmpeg build or set PLVS_REFERENCE_FFMPEG.",
        path.display()
      )
    });
  assert!(
    String::from_utf8_lossy(&filters.stdout).contains("ebur128"),
    "{} has no ebur128 filter (the bundled sidecar never does); point PLVS_REFERENCE_FFMPEG at a \
     full build",
    path.display()
  );
  path
}

/// Deterministic xorshift noise in [-1, 1).
struct Noise(u64);

impl Noise {
  fn next(&mut self) -> f64 {
    self.0 ^= self.0 << 13;
    self.0 ^= self.0 >> 7;
    self.0 ^= self.0 << 17;
    (self.0 >> 11) as f64 / (1_u64 << 52) as f64 - 1.0
  }
}

/// Roughly pink noise (three one-pole low-passes over white noise) with a tone, shared partly
/// across channels so they are correlated but not identical, stepped through levels every 4 s.
/// Channel `lfe` carries only low-passed noise. Peaks stay below full scale.
fn programme(sr: u32, channels: usize, lfe: Option<usize>, seed: u64) -> Vec<f32> {
  const STEPS_DB: [f64; 12] = [
    -30.0, -22.0, -18.0, -26.0, -45.0, -20.0, -24.0, -14.0, -32.0, -19.0, -60.0, -21.0,
  ];
  let frames = sr as usize * 4 * STEPS_DB.len();
  let mut common = Noise(seed);
  let mut own: Vec<Noise> = (0..channels)
    .map(|c| Noise(seed ^ (0x9e37 + c as u64 * 7919)))
    .collect();
  let poles = [0.99, 0.9, 0.5].map(|p: f64| p.powf(48_000.0 / sr as f64));
  let mut state = vec![[0.0_f64; 3]; channels];
  let mut pcm = Vec::with_capacity(frames * channels);
  for n in 0..frames {
    let t = n as f64 / sr as f64;
    // 50 ms ramps between steps keep level changes from producing clicks.
    let step = (t / 4.0) as usize;
    let into_step = t - step as f64 * 4.0;
    let db = if step > 0 && into_step < 0.05 {
      let k = into_step / 0.05;
      STEPS_DB[step - 1] * (1.0 - k) + STEPS_DB[step] * k
    } else {
      STEPS_DB[step]
    };
    let gain = 10_f64.powf(db / 20.0);
    let shared = common.next();
    let tone = (2.0 * PI * 330.0 * t).sin() * 0.3 + (2.0 * PI * 2_750.0 * t).sin() * 0.15;
    for (c, filter) in state.iter_mut().enumerate() {
      let white = 0.6 * shared + 0.4 * own[c].next();
      let mut pink = 0.0;
      for (s, pole) in filter.iter_mut().zip(poles) {
        *s = pole * *s + (1.0 - pole) * white;
        pink += *s;
      }
      let x = if Some(c) == lfe {
        filter[0] * 4.0
      } else {
        pink * 1.5 + tone * if c % 2 == 0 { 1.0 } else { 0.7 }
      };
      pcm.push((gain * x * 2.0).clamp(-0.98, 0.98) as f32);
    }
  }
  pcm
}

/// 32-bit float WAV, so the reference decodes exactly the samples PLVS measured.
fn write_f32_wav(path: &Path, sr: u32, channels: u16, pcm: &[f32]) {
  let data_len = (pcm.len() * 4) as u32;
  let mut bytes = Vec::with_capacity(44 + data_len as usize);
  bytes.extend_from_slice(b"RIFF");
  bytes.extend_from_slice(&(36 + data_len).to_le_bytes());
  bytes.extend_from_slice(b"WAVEfmt ");
  bytes.extend_from_slice(&16_u32.to_le_bytes());
  bytes.extend_from_slice(&3_u16.to_le_bytes()); // WAVE_FORMAT_IEEE_FLOAT
  bytes.extend_from_slice(&channels.to_le_bytes());
  bytes.extend_from_slice(&sr.to_le_bytes());
  bytes.extend_from_slice(&(sr * channels as u32 * 4).to_le_bytes());
  bytes.extend_from_slice(&(channels * 4).to_le_bytes());
  bytes.extend_from_slice(&32_u16.to_le_bytes());
  bytes.extend_from_slice(b"data");
  bytes.extend_from_slice(&data_len.to_le_bytes());
  for sample in pcm {
    bytes.extend_from_slice(&sample.to_le_bytes());
  }
  std::fs::write(path, bytes).expect("write reference WAV");
}

struct Reference {
  integrated: f64,
  lra: f64,
  true_peak_db: f64,
  sample_peak_db: f64,
}

/// Runs `ebur128` and reads the final frame's full-precision metadata (the printed summary rounds
/// to 0.1).
fn measure_with_ffmpeg(ffmpeg: &Path, wav: &Path) -> Reference {
  let out = Command::new(ffmpeg)
    .args(["-hide_banner", "-nostats", "-i"])
    .arg(wav)
    .args([
      "-af",
      "ebur128=metadata=1:peak=true+sample,ametadata=mode=print",
      "-f",
      "null",
      "-",
    ])
    .output()
    .expect("run reference FFmpeg");
  let log = String::from_utf8_lossy(&out.stderr);
  assert!(out.status.success(), "reference FFmpeg failed:\n{log}");
  let last = |key: &str| -> f64 {
    let needle = format!("lavfi.r128.{key}=");
    log
      .lines()
      .filter_map(|line| line.split_once(&needle).map(|(_, v)| v.trim()))
      .next_back()
      .unwrap_or_else(|| panic!("no {key} in reference output"))
      .parse()
      .unwrap_or_else(|e| panic!("unparsable {key}: {e}"))
  };
  Reference {
    integrated: last("I"),
    lra: last("LRA"),
    true_peak_db: 20.0 * last("true_peak").log10(),
    sample_peak_db: 20.0 * last("sample_peak").log10(),
  }
}

#[test]
#[ignore = "needs a full FFmpeg with ebur128; run `npm run verify:loudness-reference`"]
fn plvs_meters_agree_with_ffmpeg_ebur128() {
  let ffmpeg = reference_ffmpeg();
  let mut failures = Vec::new();
  // 6 channels decode as FFmpeg's guessed 5.1 (FL FR FC LFE BL BR) — the same order and the same
  // 1.41 surround / 0 LFE weights PLVS infers for six channels.
  for (name, sr, channels, lfe) in [
    ("stereo", 48_000, 2_u16, None),
    ("stereo", 44_100, 2, None),
    ("5.1", 48_000, 6, Some(3)),
  ] {
    let pcm = programme(
      sr,
      channels as usize,
      lfe,
      0x5eed_0000 + sr as u64 + channels as u64,
    );
    let wav = std::env::temp_dir().join(format!(
      "plvs_ebur128_ref_{}_{name}_{sr}.wav",
      std::process::id()
    ));
    write_f32_wav(&wav, sr, channels, &pcm);
    let reference = measure_with_ffmpeg(&ffmpeg, &wav);
    let _ = std::fs::remove_file(&wav);

    let file = file_metrics(sr, channels, &pcm);
    let live = live_blocks(sr, channels, &pcm);
    let live_last = &live.last().expect("at least one block").1;
    let live_tp = live
      .iter()
      .map(|(_, b)| b.true_peak)
      .fold(f64::NEG_INFINITY, f64::max);
    // PLVS reports sample peak for Ch1/Ch2; `ebur128` over every channel. The programme's
    // loudest sample sits in the front pair, so both read the same maximum.
    let file_sample_peak = file.sample_peak_max_l_db.max(file.sample_peak_max_r_db);

    let label = format!("{name} @ {sr} Hz");
    println!(
      "{label}: ffmpeg I {:.3} LRA {:.3} TP {:.3} SP {:.3} | file I {:.3} LRA {:.3} TP {:.3} SP {:.3} | live I {:.3} LRA {:.3} TP {:.3}",
      reference.integrated, reference.lra, reference.true_peak_db, reference.sample_peak_db,
      file.integrated_lufs, file.lra, file.true_peak_max_dbtp, file_sample_peak,
      live_last.integrated, live_last.lra, live_tp,
    );
    for (what, got, expected, tolerance) in [
      (
        "file I",
        file.integrated_lufs,
        reference.integrated,
        TOL_INTEGRATED,
      ),
      (
        "live I",
        live_last.integrated,
        reference.integrated,
        TOL_INTEGRATED,
      ),
      ("file LRA", file.lra, reference.lra, TOL_LRA),
      ("live LRA", live_last.lra, reference.lra, TOL_LRA),
      (
        "file TP",
        file.true_peak_max_dbtp,
        reference.true_peak_db,
        TOL_TRUE_PEAK,
      ),
      ("live TP", live_tp, reference.true_peak_db, TOL_TRUE_PEAK),
      (
        "file sample peak",
        file_sample_peak,
        reference.sample_peak_db,
        TOL_SAMPLE_PEAK,
      ),
    ] {
      let within = (got - expected).abs() <= tolerance; // NaN fails.
      if !within {
        failures.push(format!(
          "{label} {what}: PLVS {got:.3}, ebur128 {expected:.3} (±{tolerance})"
        ));
      }
    }
  }
  assert!(
    failures.is_empty(),
    "PLVS disagrees with ffmpeg ebur128:\n  {}",
    failures.join("\n  ")
  );
}
