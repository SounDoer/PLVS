//! EBU `minimum requirements` conformance: every synthesizable case of EBU Tech 3341 (V4, 2023)
//! Table 1 and EBU Tech 3342 (V4, 2023) Table 1, measured through both loudness implementations —
//! the live meter (`LoudnessMeter`) and the file-analysis meter (`SummaryMeter`).
//!
//! The signals are synthesized from the tables' definitions rather than read from the EBU download,
//! so the suite runs everywhere `cargo test` does. The authentic-programme cases (3341 #7, #8;
//! 3342 #5, #6) have no definition to synthesize from and are not covered here.
//!
//! Tolerances are the tables' own. Do not widen one to make a case pass: a failure here means the
//! meter does not meet `EBU Mode` for that measure.

use super::loudness::{LoudnessBlock, LoudnessMeter};
use super::summary_meter::{SummaryMeter, SummaryMetrics};
use std::f64::consts::PI;

const SR: u32 = 48_000;

fn amp(dbfs: f64) -> f64 {
  10_f64.powf(dbfs / 20.0)
}

/// A run of the 1 kHz tone at a per-channel peak level, or silence (`None`).
struct Seg(f64, Option<f64>);

/// "Stereo sine wave, 1000 Hz, signal applied in phase to both channels", one level per segment.
/// The phase runs continuously across segments, as one tone whose level steps.
fn tone_segments(sr: u32, segs: &[Seg]) -> Vec<f32> {
  let mut pcm = Vec::new();
  let mut n = 0_u64;
  for Seg(seconds, level) in segs {
    let frames = (seconds * sr as f64).round() as u64;
    for _ in 0..frames {
      let x = level.map_or(0.0, |db| {
        amp(db) * (2.0 * PI * 1000.0 * n as f64 / sr as f64).sin()
      }) as f32;
      pcm.push(x);
      pcm.push(x);
      n += 1;
    }
  }
  pcm
}

/// Feeds the live meter in 100 ms chunks so every block it closes is observed, and returns each
/// block with the stream time (seconds) at which it closed.
pub(super) fn live_blocks(sr: u32, channels: u16, pcm: &[f32]) -> Vec<(f64, LoudnessBlock)> {
  let mut meter = LoudnessMeter::new(sr as f64);
  let chunk = (sr as usize / 10) * channels as usize;
  let mut blocks = Vec::new();
  for (index, part) in pcm.chunks(chunk).enumerate() {
    if let Some(block) = meter.push_interleaved_multichannel(part, channels) {
      blocks.push(((index + 1) as f64 * 0.1, block));
    }
  }
  blocks
}

pub(super) fn file_metrics(sr: u32, channels: u16, pcm: &[f32]) -> SummaryMetrics {
  let mut meter = SummaryMeter::new(sr, channels);
  meter.push_interleaved(pcm);
  meter.finish()
}

fn check(failures: &mut Vec<String>, label: &str, got: f64, expected: f64, below: f64, above: f64) {
  // Written so that NaN (a meter that produced no reading) fails rather than passes.
  let within = got >= expected - below && got <= expected + above;
  if !within {
    failures.push(format!(
      "{label}: got {got:.3}, expected {expected:.1} (+{above}/-{below})"
    ));
  }
}

fn report(failures: Vec<String>) {
  assert!(
    failures.is_empty(),
    "{} EBU conformance failure(s):\n  {}",
    failures.len(),
    failures.join("\n  ")
  );
}

/// Checks a programme's integrated loudness on both meters (±0.1 LU).
fn check_integrated(failures: &mut Vec<String>, case: &str, channels: u16, pcm: &[f32]) {
  let live = live_blocks(SR, channels, pcm);
  let last = &live.last().expect("at least one block").1;
  check(
    failures,
    &format!("{case} live I"),
    last.integrated,
    -23.0,
    0.1,
    0.1,
  );
  let file = file_metrics(SR, channels, pcm);
  check(
    failures,
    &format!("{case} file I"),
    file.integrated_lufs,
    -23.0,
    0.1,
    0.1,
  );
}

// ---- Tech 3341 cases 1–6: steady and stepped tones ---------------------------------------------

#[test]
fn tech3341_cases_1_and_2_steady_tone_reads_its_level_on_m_s_and_i() {
  let mut failures = Vec::new();
  for (case, level) in [("3341#1", -23.0), ("3341#2", -33.0)] {
    let pcm = tone_segments(SR, &[Seg(20.0, Some(level))]);
    let live = live_blocks(SR, 2, &pcm);
    let last = &live.last().unwrap().1;
    check(
      &mut failures,
      &format!("{case} live M"),
      last.momentary,
      level,
      0.1,
      0.1,
    );
    check(
      &mut failures,
      &format!("{case} live S"),
      last.short_term,
      level,
      0.1,
      0.1,
    );
    check(
      &mut failures,
      &format!("{case} live I"),
      last.integrated,
      level,
      0.1,
      0.1,
    );
    let file = file_metrics(SR, 2, &pcm);
    check(
      &mut failures,
      &format!("{case} file Max M"),
      file.m_max_lufs,
      level,
      0.1,
      0.1,
    );
    check(
      &mut failures,
      &format!("{case} file Max S"),
      file.st_max_lufs,
      level,
      0.1,
      0.1,
    );
    check(
      &mut failures,
      &format!("{case} file I"),
      file.integrated_lufs,
      level,
      0.1,
      0.1,
    );
  }
  report(failures);
}

#[test]
fn tech3341_cases_3_to_5_gating_keeps_integrated_on_the_programme_tone() {
  let mut failures = Vec::new();
  let case3 = tone_segments(
    SR,
    &[
      Seg(10.0, Some(-36.0)),
      Seg(60.0, Some(-23.0)),
      Seg(10.0, Some(-36.0)),
    ],
  );
  check_integrated(&mut failures, "3341#3", 2, &case3);
  let case4 = tone_segments(
    SR,
    &[
      Seg(10.0, Some(-72.0)),
      Seg(10.0, Some(-36.0)),
      Seg(60.0, Some(-23.0)),
      Seg(10.0, Some(-36.0)),
      Seg(10.0, Some(-72.0)),
    ],
  );
  check_integrated(&mut failures, "3341#4", 2, &case4);
  let case5 = tone_segments(
    SR,
    &[
      Seg(20.0, Some(-26.0)),
      Seg(20.1, Some(-20.0)),
      Seg(20.0, Some(-26.0)),
    ],
  );
  check_integrated(&mut failures, "3341#5", 2, &case5);
  report(failures);
}

#[test]
fn tech3341_case_6_five_channel_tone_uses_surround_weights() {
  // 5.0 in the native WAVE order the meters assume for five channels: L R C Ls Rs.
  let levels = [-28.0, -28.0, -24.0, -30.0, -30.0];
  let frames = 20 * SR as usize;
  let mut pcm = Vec::with_capacity(frames * levels.len());
  for n in 0..frames {
    let s = (2.0 * PI * 1000.0 * n as f64 / SR as f64).sin();
    for level in levels {
      pcm.push((amp(level) * s) as f32);
    }
  }
  let mut failures = Vec::new();
  check_integrated(&mut failures, "3341#6", 5, &pcm);
  report(failures);
}

// ---- Tech 3341 cases 9–14: the M and S windows -------------------------------------------------

/// Case 9: every 3 s window holds exactly 1.34 s at -20 and 1.66 s at -30 dBFS, so S must read
/// -23.0 at every update once the first window has filled.
#[test]
fn tech3341_case_9_short_term_is_constant_after_3_s() {
  let segs: Vec<Seg> = (0..5)
    .flat_map(|_| [Seg(1.34, Some(-20.0)), Seg(1.66, Some(-30.0))])
    .collect();
  let live = live_blocks(SR, 2, &tone_segments(SR, &segs));
  let mut failures = Vec::new();
  for (t, block) in live.iter().filter(|(t, _)| *t >= 3.0 - 1e-9) {
    check(
      &mut failures,
      &format!("3341#9 S at {t:.1} s"),
      block.short_term,
      -23.0,
      0.1,
      0.1,
    );
  }
  report(failures);
}

/// Case 12: every 400 ms window holds 0.18 s at -20 and 0.22 s at -30 dBFS, so M must read -23.0
/// at every update after 1 s.
#[test]
fn tech3341_case_12_momentary_is_constant_after_1_s() {
  let segs: Vec<Seg> = (0..25)
    .flat_map(|_| [Seg(0.18, Some(-20.0)), Seg(0.22, Some(-30.0))])
    .collect();
  let live = live_blocks(SR, 2, &tone_segments(SR, &segs));
  let mut failures = Vec::new();
  for (t, block) in live.iter().filter(|(t, _)| *t >= 1.0 - 1e-9) {
    check(
      &mut failures,
      &format!("3341#12 M at {t:.1} s"),
      block.momentary,
      -23.0,
      0.1,
      0.1,
    );
  }
  report(failures);
}

/// Cases 10 and 13 (file-based meters): 20 separate files, each a tone of the window's length
/// after `i` steps of leading silence. Max S (case 10) or Max M (case 13) must find the full tone
/// whatever its offset from the start of the file.
fn check_file_max_of_offset_tones(
  failures: &mut Vec<String>,
  case: &str,
  window: f64,
  step: f64,
  measure: fn(&SummaryMetrics) -> f64,
) {
  for i in 0..20 {
    let pcm = tone_segments(
      SR,
      &[
        Seg(i as f64 * step, None),
        Seg(window, Some(-23.0)),
        Seg(1.0, None),
      ],
    );
    let got = measure(&file_metrics(SR, 2, &pcm));
    check(
      failures,
      &format!("{case} segment {i} max"),
      got,
      -23.0,
      0.1,
      0.1,
    );
  }
}

/// Cases 11 and 14 (live meters): one stream of 20 segments, each a window-length tone at
/// `-38 + i` dBFS after `i` steps of silence. The largest reading within each segment must reach
/// that segment's level.
fn check_live_max_of_offset_tones(
  failures: &mut Vec<String>,
  case: &str,
  window: f64,
  step: f64,
  measure: fn(&LoudnessBlock) -> f64,
) {
  let segs: Vec<Seg> = (0..20)
    .flat_map(|i| {
      let lead = i as f64 * step;
      [
        Seg(lead, None),
        Seg(window, Some(-38.0 + i as f64)),
        Seg(window - lead, None),
      ]
    })
    .collect();
  let live = live_blocks(SR, 2, &tone_segments(SR, &segs));
  let segment_seconds = 2.0 * window;
  for i in 0..20 {
    let start = i as f64 * segment_seconds;
    let max = live
      .iter()
      .filter(|(t, _)| *t > start + 1e-9 && *t <= start + segment_seconds + 1e-9)
      .map(|(_, b)| measure(b))
      .fold(f64::NEG_INFINITY, f64::max);
    check(
      failures,
      &format!("{case} segment {i} max"),
      max,
      -38.0 + i as f64,
      0.1,
      0.1,
    );
  }
}

#[test]
fn tech3341_cases_10_and_11_max_s_finds_a_tone_off_the_update_grid() {
  let mut failures = Vec::new();
  check_file_max_of_offset_tones(&mut failures, "3341#10 file", 3.0, 0.15, |m| m.st_max_lufs);
  check_live_max_of_offset_tones(&mut failures, "3341#11 live", 3.0, 0.15, |b| {
    b.short_term_max
  });
  report(failures);
}

/// A 400 ms tone 20–380 ms off the 100 ms reading grid never fills a window that ends on a reading,
/// so a maximum taken from the readings alone reads up to 0.45 dB low (as FFmpeg's `ebur128` does).
/// The meters track the maximum over every window position instead.
#[test]
fn tech3341_cases_13_and_14_max_m_finds_a_tone_off_the_update_grid() {
  let mut failures = Vec::new();
  check_file_max_of_offset_tones(&mut failures, "3341#13 file", 0.4, 0.02, |m| m.m_max_lufs);
  check_live_max_of_offset_tones(&mut failures, "3341#14 live", 0.4, 0.02, |b| {
    b.momentary_max
  });
  report(failures);
}

// ---- Tech 3341 cases 15–23: true peak ----------------------------------------------------------

/// Stereo sine at `fs / divisor`, tapered with 10 ms raised-cosine fades.
fn true_peak_sine(sr: u32, divisor: f64, amplitude: f64, phase_deg: f64) -> Vec<f32> {
  let frames = sr as usize;
  let fade = (sr as f64 * 0.01) as usize;
  let mut pcm = Vec::with_capacity(frames * 2);
  for n in 0..frames {
    let edge = n.min(frames - 1 - n);
    let gain = if edge < fade {
      0.5 - 0.5 * (PI * edge as f64 / fade as f64).cos()
    } else {
      1.0
    };
    let x = gain * amplitude * (2.0 * PI * n as f64 / divisor + phase_deg.to_radians()).sin();
    pcm.push(x as f32);
    pcm.push(x as f32);
  }
  pcm
}

/// Cases 20–23: a fs/6 sine at 0.5 FFS carrying one period of a fs/4 sine at 1.0 FFS, phase
/// continuous on both sides, synthesized at 4·fs, low-pass filtered, and decimated with `offset`.
fn true_peak_burst(sr: u32, offset: usize) -> Vec<f32> {
  let up = 4_usize;
  let frames_hi = sr as usize * up / 2; // 0.5 s at 4·fs
                                        // At 4·fs the fs/6 tone has a 24-sample period and the fs/4 tone a 16-sample period. The burst
                                        // starts on a zero crossing of the carrier so both sides join in phase.
  let burst_start = (frames_hi / 2) / 24 * 24;
  let burst_end = burst_start + 16;
  let mut hi = vec![0.0_f64; frames_hi];
  for (n, x) in hi.iter_mut().enumerate() {
    *x = if (burst_start..burst_end).contains(&n) {
      (2.0 * PI * (n - burst_start) as f64 / 16.0).sin()
    } else {
      // The carrier skips the burst's duration, resuming at the phase it left.
      let carrier_n = if n >= burst_end { n - 16 } else { n };
      0.5 * (2.0 * PI * carrier_n as f64 / 24.0).sin()
    };
  }
  // Anti-aliasing low-pass at 4·fs: Blackman-windowed sinc, cutoff just under fs/2.
  let taps = 511_usize;
  let cutoff = 0.45 / up as f64; // of the 4·fs rate
  let centre = (taps - 1) as f64 / 2.0;
  let mut h: Vec<f64> = (0..taps)
    .map(|i| {
      let m = i as f64 - centre;
      let sinc = if m == 0.0 {
        2.0 * cutoff
      } else {
        (2.0 * PI * cutoff * m).sin() / (PI * m)
      };
      let w = 0.42 - 0.5 * (2.0 * PI * i as f64 / (taps - 1) as f64).cos()
        + 0.08 * (4.0 * PI * i as f64 / (taps - 1) as f64).cos();
      sinc * w
    })
    .collect();
  let gain: f64 = h.iter().sum();
  h.iter_mut().for_each(|c| *c /= gain);
  let half = taps / 2;
  let filtered_at = |n: usize| -> f64 {
    (0..taps)
      .filter_map(|k| {
        (n + k)
          .checked_sub(half)
          .and_then(|j| hi.get(j))
          .map(|x| x * h[k])
      })
      .sum()
  };
  let frames = (frames_hi - offset) / up;
  let fade = (sr as f64 * 0.01) as usize;
  let mut pcm = Vec::with_capacity(frames * 2);
  for m in 0..frames {
    let edge = m.min(frames - 1 - m);
    let taper = if edge < fade {
      0.5 - 0.5 * (PI * edge as f64 / fade as f64).cos()
    } else {
      1.0
    };
    let x = (taper * filtered_at(m * up + offset)) as f32;
    pcm.push(x);
    pcm.push(x);
  }
  pcm
}

fn check_true_peak(failures: &mut Vec<String>, case: &str, sr: u32, pcm: &[f32], expected: f64) {
  let live = live_blocks(sr, 2, pcm)
    .iter()
    .map(|(_, b)| b.true_peak)
    .fold(f64::NEG_INFINITY, f64::max);
  check(
    failures,
    &format!("{case} @ {sr} Hz live TP"),
    live,
    expected,
    0.4,
    0.2,
  );
  let file = file_metrics(sr, 2, pcm).true_peak_max_dbtp;
  check(
    failures,
    &format!("{case} @ {sr} Hz file TP"),
    file,
    expected,
    0.4,
    0.2,
  );
}

/// The tables define these cases relative to fs, so beyond the 48 kHz of the EBU files they run at
/// the other common capture rates too.
#[test]
fn tech3341_cases_15_to_19_true_peak_of_sines_between_samples() {
  let mut failures = Vec::new();
  for sr in [44_100, 48_000, 96_000] {
    for (case, divisor, amplitude, phase, expected) in [
      ("3341#15", 4.0, 0.5, 0.0, -6.0),
      ("3341#16", 4.0, 0.5, 45.0, -6.0),
      ("3341#17", 6.0, 0.5, 60.0, -6.0),
      ("3341#18", 8.0, 0.5, 67.5, -6.0),
      ("3341#19", 4.0, 1.41, 45.0, 3.0),
    ] {
      let pcm = true_peak_sine(sr, divisor, amplitude, phase);
      check_true_peak(&mut failures, case, sr, &pcm, expected);
    }
  }
  report(failures);
}

#[test]
fn tech3341_cases_20_to_23_true_peak_of_a_single_period_burst() {
  let mut failures = Vec::new();
  for sr in [44_100, 48_000, 96_000] {
    for offset in 0..4 {
      let pcm = true_peak_burst(sr, offset);
      check_true_peak(
        &mut failures,
        &format!("3341#{}", 20 + offset),
        sr,
        &pcm,
        0.0,
      );
    }
  }
  report(failures);
}

// ---- Tech 3342 cases 1–4: loudness range -------------------------------------------------------

#[test]
fn tech3342_cases_1_to_4_loudness_range_of_stepped_tones() {
  let mut failures = Vec::new();
  // "The expected response is unchanged if the test signal is repeated": case 1 is also measured
  // twice over. One repeated case is enough, as every repeat adds 40–200 s of audio to the run.
  for (case, levels, expected, repeat_counts) in [
    ("3342#1", &[-20.0, -30.0][..], 10.0, &[1, 2][..]),
    ("3342#2", &[-20.0, -15.0][..], 5.0, &[1][..]),
    ("3342#3", &[-40.0, -20.0][..], 20.0, &[1][..]),
    (
      "3342#4",
      &[-50.0, -35.0, -20.0, -35.0, -50.0][..],
      15.0,
      &[1][..],
    ),
  ] {
    for &repeats in repeat_counts {
      let segs: Vec<Seg> = (0..repeats)
        .flat_map(|_| levels.iter().map(|&db| Seg(20.0, Some(db))))
        .collect();
      let pcm = tone_segments(SR, &segs);
      let live = live_blocks(SR, 2, &pcm);
      let label = format!("{case} x{repeats}");
      check(
        &mut failures,
        &format!("{label} live LRA"),
        live.last().unwrap().1.lra,
        expected,
        1.0,
        1.0,
      );
      check(
        &mut failures,
        &format!("{label} file LRA"),
        file_metrics(SR, 2, &pcm).lra,
        expected,
        1.0,
        1.0,
      );
    }
  }
  report(failures);
}

// ---- Beyond the tables: input shorter than a window --------------------------------------------

/// The tables say nothing about the first 0.4 s or 3 s, so PLVS keeps every window its full length
/// and counts the time before the meter started as silence (libebur128 behaves the same way). A
/// 1 s tone then has a 3 s loudness 10·log10(1/3) dB below its level, rather than no value or the
/// tone's own level.
#[test]
fn input_shorter_than_a_window_reads_against_silence_before_the_start() {
  let pcm = tone_segments(SR, &[Seg(1.0, Some(-23.0))]);
  let one_in_three = -23.0 + 10.0 * (1.0_f64 / 3.0).log10();
  let mut failures = Vec::new();

  let live = live_blocks(SR, 2, &pcm);
  let (_, last) = live.last().unwrap();
  check(
    &mut failures,
    "live S at 1 s",
    last.short_term,
    one_in_three,
    0.02,
    0.02,
  );
  let live_m_max = live
    .iter()
    .map(|(_, b)| b.momentary_max)
    .fold(f64::NEG_INFINITY, f64::max);
  let live_s_max = live
    .iter()
    .map(|(_, b)| b.short_term_max)
    .fold(f64::NEG_INFINITY, f64::max);
  check(&mut failures, "live Max M", live_m_max, -23.0, 0.02, 0.02);
  check(
    &mut failures,
    "live Max S",
    live_s_max,
    one_in_three,
    0.02,
    0.02,
  );

  let file = file_metrics(SR, 2, &pcm);
  check(
    &mut failures,
    "file Max M",
    file.m_max_lufs,
    -23.0,
    0.02,
    0.02,
  );
  check(
    &mut failures,
    "file Max S",
    file.st_max_lufs,
    one_in_three,
    0.02,
    0.02,
  );
  report(failures);
}

/// The silence-padded S readings of the first 3 s are not LRA input: LRA is a distribution of 3 s
/// loudness, and those readings would add a ramp the programme does not have.
#[test]
fn loudness_range_ignores_short_term_readings_before_the_first_complete_window() {
  let pcm = tone_segments(SR, &[Seg(10.0, Some(-23.0))]);
  let mut failures = Vec::new();
  let live = live_blocks(SR, 2, &pcm);
  check(
    &mut failures,
    "live LRA",
    live.last().unwrap().1.lra,
    0.0,
    0.05,
    0.05,
  );
  check(
    &mut failures,
    "file LRA",
    file_metrics(SR, 2, &pcm).lra,
    0.0,
    0.05,
    0.05,
  );
  report(failures);
}
