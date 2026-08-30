//! Turns an [`AudioFramePayload`] into one binary message (`docs/working/perf/protocol.md` §7 step 3).
//!
//! Spectrum's and Stereo Map's band rows leave the JSON side here. Everything else -- the scalars,
//! Vectorscope, the band grid -- still serializes exactly as before, because the envelope carries
//! JSON and binary side by side and there is no reason to move them all in one commit.
//!
//! Both panels' rows travel at the width the DSP already produces -- `f64` for Spectrum, `f32` for
//! Stereo Map's energies -- so this changes no value the frontend reads. Narrowing Spectrum to
//! `f32` halves its bytes again and is worth doing, but it is a precision decision and belongs in
//! its own commit with its own measurement.
//!
//! The mirror below has to name every field [`AudioFramePayload`] serializes. A field added there
//! and forgotten here would silently stop reaching the UI, so
//! `tests::the_envelope_names_every_field_the_payload_serializes` compares the two key sets.

use std::collections::{BTreeMap, HashMap};

use serde::Serialize;

use super::types::{
  AudioFramePayload, MeterHistoryEntry, VectorscopeFrameResult, VectorscopeVisualEntry,
  VisualHistEntry,
};
use super::wire::{BinRef, FrameWire, WireSection, FRAME_WIRE_VERSION};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WireSpectrumFrameResult {
  smooth_db: BinRef,
  peak_db: BinRef,
  smooth_db_b: BinRef,
  peak_db_b: BinRef,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WireSpectrumVisualEntry {
  smooth_db: BinRef,
  smooth_db_b: BinRef,
}

/// Stereo Map's three primitive rows. They are already `f32` in the pipeline, so unlike Spectrum
/// there is no width question here at all.
#[derive(Serialize)]
struct WireStereoMapRows {
  pl: BinRef,
  pr: BinRef,
  c: BinRef,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WireVisualHistEntry<'a> {
  timestamp_ms: u64,
  waveform_min: &'a [f32],
  waveform_max: &'a [f32],
  dominant_frequency_hz: &'a [f32],
  spectral_centroid_hz: &'a [f32],
  tonality: &'a [f32],
  correlation: f64,
  side_to_mid_db: f64,
  spectrum_by_key: BTreeMap<&'a str, WireSpectrumVisualEntry>,
  vectorscope_by_key: &'a HashMap<String, VectorscopeVisualEntry>,
  stereo_map_by_key: BTreeMap<&'a str, WireStereoMapRows>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WireFrame<'a> {
  /// Checked by `src/ipc/frameWire.js` before it reads a single section.
  wire_version: u32,
  peak_db: &'a [f64],
  rms_db: &'a [f64],
  true_peak_max_dbtp: f64,
  lufs_momentary: f64,
  lufs_short_term: f64,
  lufs_m_max: f64,
  lufs_st_max: f64,
  integrated: f64,
  lra: f64,
  true_peak_l: f64,
  true_peak_r: f64,
  sample_l_db: f64,
  sample_r_db: f64,
  correlation: f64,
  side_to_mid_db: f64,
  vectorscope_pair_x: u16,
  vectorscope_pair_y: u16,
  spectrum_results_by_key: BTreeMap<&'a str, WireSpectrumFrameResult>,
  vectorscope_results_by_key: &'a HashMap<String, VectorscopeFrameResult>,
  stereo_map_results_by_key: BTreeMap<&'a str, WireStereoMapRows>,
  loudness_layout: &'a str,
  loudness_layout_known: bool,
  timestamp_ms: u64,
  band_grid_id: u64,
  #[serde(skip_serializing_if = "<[f64]>::is_empty")]
  band_grid_centers_hz: &'a [f64],
  seq: u64,
  #[serde(skip_serializing_if = "Option::is_none")]
  loudness_hist_tick: &'a Option<MeterHistoryEntry>,
  #[serde(skip_serializing_if = "Option::is_none")]
  visual_hist_tick: Option<WireVisualHistEntry<'a>>,
  dialogue_integrated: f64,
  dialogue_percent: f64,
  dialogue_lra: f64,
  dialogue_active_now: bool,
  #[serde(skip_serializing_if = "<[MeterHistoryEntry]>::is_empty")]
  loudness_hist_batch: &'a [MeterHistoryEntry],
  #[serde(skip_serializing_if = "Vec::is_empty")]
  visual_hist_batch: Vec<WireVisualHistEntry<'a>>,
}

fn wire_visual_entry<'a>(
  entry: &'a VisualHistEntry,
  wire: &mut FrameWire<'a>,
) -> WireVisualHistEntry<'a> {
  let mut spectrum_by_key = BTreeMap::new();
  for (key, sample) in &entry.spectrum_by_key {
    spectrum_by_key.insert(
      key.as_str(),
      WireSpectrumVisualEntry {
        smooth_db: wire.push(WireSection::F64(&sample.smooth_db)),
        smooth_db_b: wire.push(WireSection::F64(&sample.smooth_db_b)),
      },
    );
  }
  let mut stereo_map_by_key = BTreeMap::new();
  for (key, sample) in &entry.stereo_map_by_key {
    stereo_map_by_key.insert(
      key.as_str(),
      WireStereoMapRows {
        pl: wire.push(WireSection::F32(&sample.pl)),
        pr: wire.push(WireSection::F32(&sample.pr)),
        c: wire.push(WireSection::F32(&sample.c)),
      },
    );
  }
  WireVisualHistEntry {
    timestamp_ms: entry.timestamp_ms,
    waveform_min: &entry.waveform_min,
    waveform_max: &entry.waveform_max,
    dominant_frequency_hz: &entry.dominant_frequency_hz,
    spectral_centroid_hz: &entry.spectral_centroid_hz,
    tonality: &entry.tonality,
    correlation: entry.correlation,
    side_to_mid_db: entry.side_to_mid_db,
    spectrum_by_key,
    vectorscope_by_key: &entry.vectorscope_by_key,
    stereo_map_by_key,
  }
}

/// Encodes one frame. Fails only if the envelope itself cannot be serialized, which would mean a
/// non-finite value reached a field `serde_json` refuses -- not something a caller can recover from.
pub fn encode_audio_frame(frame: &AudioFramePayload) -> Result<Vec<u8>, serde_json::Error> {
  let mut wire = FrameWire::new();

  let mut spectrum_results_by_key = BTreeMap::new();
  for (key, result) in &frame.spectrum_results_by_key {
    spectrum_results_by_key.insert(
      key.as_str(),
      WireSpectrumFrameResult {
        smooth_db: wire.push(WireSection::F64(&result.smooth_db)),
        peak_db: wire.push(WireSection::F64(&result.peak_db)),
        smooth_db_b: wire.push(WireSection::F64(&result.smooth_db_b)),
        peak_db_b: wire.push(WireSection::F64(&result.peak_db_b)),
      },
    );
  }

  let mut stereo_map_results_by_key = BTreeMap::new();
  for (key, result) in &frame.stereo_map_results_by_key {
    stereo_map_results_by_key.insert(
      key.as_str(),
      WireStereoMapRows {
        pl: wire.push(WireSection::F32(&result.pl)),
        pr: wire.push(WireSection::F32(&result.pr)),
        c: wire.push(WireSection::F32(&result.c)),
      },
    );
  }

  let visual_hist_tick = frame
    .visual_hist_tick
    .as_ref()
    .map(|entry| wire_visual_entry(entry, &mut wire));
  let visual_hist_batch = frame
    .visual_hist_batch
    .iter()
    .map(|entry| wire_visual_entry(entry, &mut wire))
    .collect();

  let envelope = WireFrame {
    wire_version: FRAME_WIRE_VERSION,
    peak_db: &frame.peak_db,
    rms_db: &frame.rms_db,
    true_peak_max_dbtp: frame.true_peak_max_dbtp,
    lufs_momentary: frame.lufs_momentary,
    lufs_short_term: frame.lufs_short_term,
    lufs_m_max: frame.lufs_m_max,
    lufs_st_max: frame.lufs_st_max,
    integrated: frame.integrated,
    lra: frame.lra,
    true_peak_l: frame.true_peak_l,
    true_peak_r: frame.true_peak_r,
    sample_l_db: frame.sample_l_db,
    sample_r_db: frame.sample_r_db,
    correlation: frame.correlation,
    side_to_mid_db: frame.side_to_mid_db,
    vectorscope_pair_x: frame.vectorscope_pair_x,
    vectorscope_pair_y: frame.vectorscope_pair_y,
    spectrum_results_by_key,
    vectorscope_results_by_key: &frame.vectorscope_results_by_key,
    stereo_map_results_by_key,
    loudness_layout: &frame.loudness_layout,
    loudness_layout_known: frame.loudness_layout_known,
    timestamp_ms: frame.timestamp_ms,
    band_grid_id: frame.band_grid_id,
    band_grid_centers_hz: &frame.band_grid_centers_hz,
    seq: frame.seq,
    loudness_hist_tick: &frame.loudness_hist_tick,
    visual_hist_tick,
    dialogue_integrated: frame.dialogue_integrated,
    dialogue_percent: frame.dialogue_percent,
    dialogue_lra: frame.dialogue_lra,
    dialogue_active_now: frame.dialogue_active_now,
    loudness_hist_batch: &frame.loudness_hist_batch,
    visual_hist_batch,
  };

  Ok(wire.encode(&serde_json::to_string(&envelope)?))
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::ipc::types::{
    SpectrumFrameResult, SpectrumVisualEntry, StereoMapFrameResult, StereoMapVisualEntry,
  };
  use serde_json::Value;

  fn frame_with_spectrum() -> AudioFramePayload {
    let mut frame = AudioFramePayload {
      peak_db: vec![-6.0, -6.5],
      rms_db: vec![-18.0, -18.5],
      true_peak_max_dbtp: -5.5,
      lufs_momentary: -22.0,
      lufs_short_term: -22.5,
      lufs_m_max: -19.5,
      lufs_st_max: -20.0,
      integrated: -23.0,
      lra: 7.5,
      true_peak_l: -6.0,
      true_peak_r: -6.25,
      sample_l_db: -6.5,
      sample_r_db: -6.75,
      correlation: 0.5,
      side_to_mid_db: -11.0,
      vectorscope_pair_x: 0,
      vectorscope_pair_y: 1,
      spectrum_results_by_key: HashMap::new(),
      vectorscope_results_by_key: HashMap::new(),
      stereo_map_results_by_key: HashMap::new(),
      loudness_layout: "stereo".to_string(),
      loudness_layout_known: true,
      timestamp_ms: 1_000,
      band_grid_id: 3,
      band_grid_centers_hz: vec![20.0, 40.0],
      seq: 9,
      loudness_hist_tick: None,
      visual_hist_tick: None,
      dialogue_integrated: -24.0,
      dialogue_percent: 40.0,
      dialogue_lra: 5.0,
      dialogue_active_now: true,
      loudness_hist_batch: Vec::new(),
      visual_hist_batch: Vec::new(),
    };
    // Powers of two only: a fixture of round decimals would assert float representation instead of
    // the layout under test.
    frame.spectrum_results_by_key.insert(
      "spectrum:a".to_string(),
      SpectrumFrameResult {
        smooth_db: vec![-0.25, -0.5],
        peak_db: vec![-0.125],
        smooth_db_b: Vec::new(),
        peak_db_b: Vec::new(),
      },
    );
    frame
  }

  fn envelope_of(message: &[u8]) -> Value {
    let json_len = u32::from_le_bytes(message[0..4].try_into().unwrap()) as usize;
    serde_json::from_slice(&message[4..4 + json_len]).unwrap()
  }

  #[test]
  fn spectrum_rows_leave_the_envelope_as_descriptors() {
    let frame = frame_with_spectrum();
    let message = encode_audio_frame(&frame).unwrap();
    let envelope = envelope_of(&message);
    let result = &envelope["spectrumResultsByKey"]["spectrum:a"];

    assert_eq!(result["smoothDb"]["dtype"], "f64");
    assert_eq!(result["smoothDb"]["len"], 2);
    assert_eq!(result["peakDb"]["len"], 1);
    // An absent secondary row is a zero-length section, not a missing field: the frontend reads
    // `.length` either way, and a uniform shape keeps the decoder from special-casing views.
    assert_eq!(result["peakDbB"]["len"], 0);
  }

  #[test]
  fn every_row_gets_its_own_section_index() {
    let frame = frame_with_spectrum();
    let envelope = envelope_of(&encode_audio_frame(&frame).unwrap());
    let result = &envelope["spectrumResultsByKey"]["spectrum:a"];

    let mut bins = vec![
      result["smoothDb"]["$bin"].as_u64().unwrap(),
      result["peakDb"]["$bin"].as_u64().unwrap(),
      result["smoothDbB"]["$bin"].as_u64().unwrap(),
      result["peakDbB"]["$bin"].as_u64().unwrap(),
    ];
    bins.sort_unstable();

    assert_eq!(bins, vec![0, 1, 2, 3]);
  }

  #[test]
  fn row_values_reach_the_tail_unchanged() {
    let frame = frame_with_spectrum();
    let message = encode_audio_frame(&frame).unwrap();
    let envelope = envelope_of(&message);
    let smooth = &envelope["spectrumResultsByKey"]["spectrum:a"]["smoothDb"];

    // Section 0 starts at the first eight-byte boundary after the envelope, and this fixture puts
    // `smoothDb` there.
    assert_eq!(smooth["$bin"], 0);
    let json_len = u32::from_le_bytes(message[0..4].try_into().unwrap()) as usize;
    let start = (4 + json_len).div_ceil(8) * 8;
    let first = f64::from_le_bytes(message[start..start + 8].try_into().unwrap());
    let second = f64::from_le_bytes(message[start + 8..start + 16].try_into().unwrap());

    assert_eq!(first, -0.25);
    assert_eq!(second, -0.5);
  }

  #[test]
  fn visual_ticks_and_batches_both_move_their_rows_off_the_json_side() {
    let mut frame = frame_with_spectrum();
    let mut entry = VisualHistEntry {
      timestamp_ms: 40,
      waveform_min: vec![-0.5],
      waveform_max: vec![0.5],
      dominant_frequency_hz: vec![440.0],
      spectral_centroid_hz: vec![1000.0],
      tonality: vec![0.5],
      correlation: 0.25,
      side_to_mid_db: -12.0,
      spectrum_by_key: HashMap::new(),
      vectorscope_by_key: HashMap::new(),
      stereo_map_by_key: HashMap::new(),
    };
    entry.spectrum_by_key.insert(
      "spectrum:a".to_string(),
      SpectrumVisualEntry {
        smooth_db: vec![-0.75, -0.875],
        smooth_db_b: Vec::new(),
      },
    );
    frame.visual_hist_tick = Some(entry.clone());
    frame.visual_hist_batch = vec![entry];

    let envelope = envelope_of(&encode_audio_frame(&frame).unwrap());

    assert_eq!(
      envelope["visualHistTick"]["spectrumByKey"]["spectrum:a"]["smoothDb"]["len"],
      2
    );
    assert_eq!(
      envelope["visualHistBatch"][0]["spectrumByKey"]["spectrum:a"]["smoothDb"]["len"],
      2
    );
    // The tick and the batch entry carry the same values but must not share a section.
    assert_ne!(
      envelope["visualHistTick"]["spectrumByKey"]["spectrum:a"]["smoothDb"]["$bin"],
      envelope["visualHistBatch"][0]["spectrumByKey"]["spectrum:a"]["smoothDb"]["$bin"]
    );
  }

  #[test]
  fn stereo_map_rows_leave_the_envelope_as_f32_descriptors() {
    let mut frame = frame_with_spectrum();
    frame.stereo_map_results_by_key.insert(
      "stereoMap:a".to_string(),
      StereoMapFrameResult {
        pl: vec![0.25, 0.5],
        pr: vec![0.125],
        c: Vec::new(),
      },
    );

    let envelope = envelope_of(&encode_audio_frame(&frame).unwrap());
    let rows = &envelope["stereoMapResultsByKey"]["stereoMap:a"];

    // Stereo Map's primitives are already f32 in the pipeline, so unlike Spectrum they cross at
    // their native width with no precision question attached.
    assert_eq!(rows["pl"]["dtype"], "f32");
    assert_eq!(rows["pl"]["len"], 2);
    assert_eq!(rows["pr"]["len"], 1);
    assert_eq!(rows["c"]["len"], 0);
  }

  #[test]
  fn spectrum_and_stereo_map_rows_never_share_a_section() {
    let mut frame = frame_with_spectrum();
    frame.stereo_map_results_by_key.insert(
      "stereoMap:a".to_string(),
      StereoMapFrameResult {
        pl: vec![0.25],
        pr: vec![0.5],
        c: vec![0.75],
      },
    );

    let envelope = envelope_of(&encode_audio_frame(&frame).unwrap());
    let spectrum = &envelope["spectrumResultsByKey"]["spectrum:a"];
    let stereo = &envelope["stereoMapResultsByKey"]["stereoMap:a"];

    let mut bins: Vec<u64> = ["smoothDb", "peakDb", "smoothDbB", "peakDbB"]
      .iter()
      .map(|field| spectrum[field]["$bin"].as_u64().unwrap())
      .chain(
        ["pl", "pr", "c"]
          .iter()
          .map(|field| stereo[field]["$bin"].as_u64().unwrap()),
      )
      .collect();
    bins.sort_unstable();
    bins.dedup();

    assert_eq!(bins, (0..7).collect::<Vec<u64>>());
  }

  #[test]
  fn stereo_map_visual_rows_move_too() {
    let mut frame = frame_with_spectrum();
    let mut entry = VisualHistEntry {
      timestamp_ms: 40,
      waveform_min: vec![-0.5],
      waveform_max: vec![0.5],
      dominant_frequency_hz: vec![440.0],
      spectral_centroid_hz: vec![1000.0],
      tonality: vec![0.5],
      correlation: 0.25,
      side_to_mid_db: -12.0,
      spectrum_by_key: HashMap::new(),
      vectorscope_by_key: HashMap::new(),
      stereo_map_by_key: HashMap::new(),
    };
    entry.stereo_map_by_key.insert(
      "stereoMap:a".to_string(),
      StereoMapVisualEntry {
        pl: vec![0.25, 0.5],
        pr: vec![0.125, 0.25],
        c: vec![0.0625, 0.125],
      },
    );
    frame.visual_hist_tick = Some(entry);

    let envelope = envelope_of(&encode_audio_frame(&frame).unwrap());
    let rows = &envelope["visualHistTick"]["stereoMapByKey"]["stereoMap:a"];

    assert_eq!(rows["pl"]["dtype"], "f32");
    assert_eq!(rows["pl"]["len"], 2);
    assert_eq!(rows["c"]["len"], 2);
  }

  #[test]
  fn the_scalar_half_is_untouched() {
    let frame = frame_with_spectrum();
    let envelope = envelope_of(&encode_audio_frame(&frame).unwrap());

    assert_eq!(envelope["seq"], 9);
    assert_eq!(envelope["lufsMomentary"], -22.0);
    assert_eq!(envelope["loudnessLayout"], "stereo");
    assert_eq!(
      envelope["bandGridCentersHz"],
      serde_json::json!([20.0, 40.0])
    );
    assert_eq!(envelope["wireVersion"], FRAME_WIRE_VERSION);
  }

  /// Production-width frame: 958 bands, one Spectrum key in combined view (two live rows plus one
  /// visual row) and one Stereo Map key (three live rows plus three visual rows).
  fn production_width_frame() -> AudioFramePayload {
    let bands = 958;
    let db_row: Vec<f64> = (0..bands)
      .map(|i| -78.0 + (i as f64 * 0.037).sin() * 31.0 + (i as f64 * 0.31).sin() * 6.0)
      .collect();
    let energy_row: Vec<f32> = (0..bands)
      .map(|i| {
        let decades = -9.0 + (i as f64 / bands as f64) * 8.0 + (i as f64 * 0.037).sin() * 1.5;
        (10_f64.powf(decades) * (1.0 + (i as f64 * 0.31).sin() * 0.4)) as f32
      })
      .collect();

    let mut frame = frame_with_spectrum();
    frame.band_grid_centers_hz = Vec::new();
    frame.spectrum_results_by_key.clear();
    frame.spectrum_results_by_key.insert(
      "spectrum:sm0:sp2:v0".to_string(),
      SpectrumFrameResult {
        smooth_db: db_row.clone(),
        peak_db: db_row.clone(),
        smooth_db_b: Vec::new(),
        peak_db_b: Vec::new(),
      },
    );
    frame.stereo_map_results_by_key.insert(
      "stereoMap:pair:0:1:sp2:sm0".to_string(),
      StereoMapFrameResult {
        pl: energy_row.clone(),
        pr: energy_row.clone(),
        c: energy_row.clone(),
      },
    );

    let mut entry = VisualHistEntry {
      timestamp_ms: 40,
      waveform_min: vec![-0.5, -0.5],
      waveform_max: vec![0.5, 0.5],
      dominant_frequency_hz: vec![440.0, 440.0],
      spectral_centroid_hz: vec![1000.0, 1000.0],
      tonality: vec![0.5, 0.5],
      correlation: 0.25,
      side_to_mid_db: -12.0,
      spectrum_by_key: HashMap::new(),
      vectorscope_by_key: HashMap::new(),
      stereo_map_by_key: HashMap::new(),
    };
    entry.spectrum_by_key.insert(
      "spectrum:sm0:sp2:v0".to_string(),
      SpectrumVisualEntry {
        smooth_db: db_row,
        smooth_db_b: Vec::new(),
      },
    );
    entry.stereo_map_by_key.insert(
      "stereoMap:pair:0:1:sp2:sm0".to_string(),
      StereoMapVisualEntry {
        pl: energy_row.clone(),
        pr: energy_row.clone(),
        c: energy_row,
      },
    );
    frame.visual_hist_tick = Some(entry);
    frame
  }

  /// What the round is for. The old wire is `serde_json` over the whole payload; the new one is the
  /// envelope plus sections. Printed with `cargo test -- --nocapture` so the numbers can be read
  /// off rather than re-derived, and asserted loosely so it fails only on a real regression.
  #[test]
  fn a_production_width_frame_is_far_smaller_than_its_json() {
    let frame = production_width_frame();
    let json_bytes = serde_json::to_vec(&frame).unwrap().len();
    let message = encode_audio_frame(&frame).unwrap();
    let envelope_bytes = u32::from_le_bytes(message[0..4].try_into().unwrap()) as usize;

    // Per-row sizes settle P-6 in the design doc: `stereo-map.md` implied ~18.8 KiB for an f32 row,
    // which is f64's width. `serde_json` writes an f32 through ryu's f32 form, which is shorter.
    let spectrum_row_bytes = serde_json::to_vec(
      &frame
        .spectrum_results_by_key
        .values()
        .next()
        .unwrap()
        .smooth_db,
    )
    .unwrap()
    .len();
    let stereo_row_bytes =
      serde_json::to_vec(&frame.stereo_map_results_by_key.values().next().unwrap().pl)
        .unwrap()
        .len();

    println!(
      "production frame: json {json_bytes} B -> message {} B (envelope {envelope_bytes} B,        sections {} B), {:.1}% of the original; one JSON row: spectrum f64 {spectrum_row_bytes} B,        stereo map f32 {stereo_row_bytes} B",
      message.len(),
      message.len() - envelope_bytes - 4,
      100.0 * message.len() as f64 / json_bytes as f64
    );

    assert!(
      message.len() * 2 < json_bytes,
      "the binary frame should be less than half the JSON one: {} vs {json_bytes}",
      message.len()
    );
  }

  /// A field added to `AudioFramePayload` and forgotten in `WireFrame` would simply stop reaching
  /// the UI, with nothing failing. Comparing the two key sets is what makes that loud.
  #[test]
  fn the_envelope_names_every_field_the_payload_serializes() {
    let frame = frame_with_spectrum();
    let json_side = serde_json::to_value(&frame).unwrap();
    let envelope = envelope_of(&encode_audio_frame(&frame).unwrap());

    let mut expected: Vec<&String> = json_side.as_object().unwrap().keys().collect();
    let wire_version = "wireVersion".to_string();
    expected.push(&wire_version);
    expected.sort();

    let mut actual: Vec<&String> = envelope.as_object().unwrap().keys().collect();
    actual.sort();

    assert_eq!(actual, expected);
  }

  /// Same drift risk one level down.
  #[test]
  fn the_visual_entry_names_every_field_its_payload_serializes() {
    let mut frame = frame_with_spectrum();
    frame.visual_hist_tick = Some(VisualHistEntry {
      timestamp_ms: 40,
      waveform_min: vec![-0.5],
      waveform_max: vec![0.5],
      dominant_frequency_hz: vec![440.0],
      spectral_centroid_hz: vec![1000.0],
      tonality: vec![0.5],
      correlation: 0.25,
      side_to_mid_db: -12.0,
      spectrum_by_key: HashMap::new(),
      vectorscope_by_key: HashMap::new(),
      stereo_map_by_key: HashMap::new(),
    });

    let json_side = serde_json::to_value(frame.visual_hist_tick.as_ref().unwrap()).unwrap();
    let envelope = envelope_of(&encode_audio_frame(&frame).unwrap());

    let mut expected: Vec<&String> = json_side.as_object().unwrap().keys().collect();
    expected.sort();
    let mut actual: Vec<&String> = envelope["visualHistTick"]
      .as_object()
      .unwrap()
      .keys()
      .collect();
    actual.sort();

    assert_eq!(actual, expected);
  }
}
