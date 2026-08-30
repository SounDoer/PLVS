//! Encoder for the binary frame envelope (`docs/working/perf/protocol.md` §3).
//!
//! One channel message carries the whole frame:
//!
//! ```text
//! [ u32 LE jsonLen ][ JSON envelope, UTF-8 ][ padding ][ section 0 ][ section 1 ] ...
//! ```
//!
//! The envelope is the payload the frontend already consumes, except that each band row has been
//! replaced by a [`BinRef`] naming a section in the tail. That keeps the values off the JSON side,
//! where `serde_json` would spend roughly 18 KiB and the webview roughly 0.03 ms per 958-band row
//! formatting and re-parsing digits the frontend only ever packs into an Int16 slab.
//!
//! Sections carry no offset table: they sit in `$bin` order, each starting at the next offset its
//! element size divides. Every descriptor is written on every frame, deliberately -- frames are
//! dropped when the webview falls behind, so a format announced once would take the session with it.
//!
//! Counterpart: `src/ipc/frameWire.js`. The two are pinned to one another by a golden fixture, in
//! `tests::golden_message_matches_the_bytes_the_frontend_test_decodes` here and by the same bytes
//! in `src/ipc/frameWire.test.js`.

use serde::Serialize;

/// Bumped only if the layout above changes. Present so a mismatch fails loudly, not subtly.
pub const FRAME_WIRE_VERSION: u32 = 1;

/// The section area starts here so every element size below divides its offset.
const SECTION_AREA_ALIGNMENT: usize = 8;

/// Stands in for one band row inside the JSON envelope.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct BinRef {
  #[serde(rename = "$bin")]
  pub bin: u32,
  pub dtype: &'static str,
  pub len: u32,
}

/// One run of numbers moved off the JSON side.
///
/// All three widths are part of the format and are exercised by the tests on both sides, but only
/// `F64` has a caller so far: Spectrum's rows are what step 3 moved. `F32` lands with Stereo Map,
/// `I16` with the centi-dB narrowing.
#[allow(dead_code)]
#[derive(Debug, Clone, Copy)]
pub enum WireSection<'a> {
  F32(&'a [f32]),
  F64(&'a [f64]),
  I16(&'a [i16]),
}

impl WireSection<'_> {
  fn dtype(&self) -> &'static str {
    match self {
      Self::F32(_) => "f32",
      Self::F64(_) => "f64",
      Self::I16(_) => "i16",
    }
  }

  fn bytes_per_element(&self) -> usize {
    match self {
      Self::F32(_) => 4,
      Self::F64(_) => 8,
      Self::I16(_) => 2,
    }
  }

  fn len(&self) -> usize {
    match self {
      Self::F32(values) => values.len(),
      Self::F64(values) => values.len(),
      Self::I16(values) => values.len(),
    }
  }

  fn write_into(&self, out: &mut Vec<u8>) {
    match self {
      Self::F32(values) => values
        .iter()
        .for_each(|v| out.extend_from_slice(&v.to_le_bytes())),
      Self::F64(values) => values
        .iter()
        .for_each(|v| out.extend_from_slice(&v.to_le_bytes())),
      Self::I16(values) => values
        .iter()
        .for_each(|v| out.extend_from_slice(&v.to_le_bytes())),
    }
  }
}

fn align_up(offset: usize, alignment: usize) -> usize {
  let remainder = offset % alignment;
  if remainder == 0 {
    offset
  } else {
    offset + (alignment - remainder)
  }
}

/// Collects the rows a frame moves off the JSON side, handing back the descriptor to embed for each.
#[derive(Debug, Default)]
pub struct FrameWire<'a> {
  sections: Vec<WireSection<'a>>,
}

impl<'a> FrameWire<'a> {
  pub fn new() -> Self {
    Self::default()
  }

  /// Takes one row and returns the descriptor that replaces it in the envelope.
  pub fn push(&mut self, section: WireSection<'a>) -> BinRef {
    let bin = self.sections.len() as u32;
    let reference = BinRef {
      bin,
      dtype: section.dtype(),
      len: section.len() as u32,
    };
    self.sections.push(section);
    reference
  }

  /// Lays the message out around an envelope whose descriptors came from [`Self::push`].
  pub fn encode(&self, envelope_json: &str) -> Vec<u8> {
    let json = envelope_json.as_bytes();
    let mut out = Vec::with_capacity(4 + json.len() + self.projected_section_bytes());
    out.extend_from_slice(&(json.len() as u32).to_le_bytes());
    out.extend_from_slice(json);
    out.resize(align_up(out.len(), SECTION_AREA_ALIGNMENT), 0);

    for section in &self.sections {
      out.resize(align_up(out.len(), section.bytes_per_element()), 0);
      section.write_into(&mut out);
    }
    out
  }

  fn projected_section_bytes(&self) -> usize {
    self
      .sections
      .iter()
      .map(|section| section.len() * section.bytes_per_element() + section.bytes_per_element())
      .sum()
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;

  fn envelope_with(references: &[BinRef]) -> String {
    serde_json::to_string(&json!({
      "wireVersion": FRAME_WIRE_VERSION,
      "rows": references,
    }))
    .unwrap()
  }

  #[test]
  fn descriptors_number_sections_in_push_order() {
    let smooth = [1.0f32, 2.0];
    let peak = [3.0f32];
    let mut wire = FrameWire::new();

    assert_eq!(
      wire.push(WireSection::F32(&smooth)),
      BinRef {
        bin: 0,
        dtype: "f32",
        len: 2
      }
    );
    assert_eq!(
      wire.push(WireSection::F32(&peak)),
      BinRef {
        bin: 1,
        dtype: "f32",
        len: 1
      }
    );
  }

  #[test]
  fn envelope_is_prefixed_by_its_own_length() {
    let row = [0.5f32];
    let mut wire = FrameWire::new();
    let reference = wire.push(WireSection::F32(&row));
    let envelope = envelope_with(&[reference]);

    let message = wire.encode(&envelope);
    let json_len = u32::from_le_bytes(message[0..4].try_into().unwrap()) as usize;

    assert_eq!(json_len, envelope.len());
    assert_eq!(&message[4..4 + json_len], envelope.as_bytes());
  }

  #[test]
  fn every_section_starts_where_its_element_size_divides() {
    // An odd-length i16 row leaves the cursor two-byte aligned; the f64 row after it must still
    // land on an eight-byte boundary or the frontend cannot take a view over it.
    let odd = [1i16, 2, 3];
    let wide = [1.5f64, 2.5];
    let mut wire = FrameWire::new();
    wire.push(WireSection::I16(&odd));
    wire.push(WireSection::F64(&wide));

    let message = wire.encode(&envelope_with(&[]));
    let mut offset = align_up(4 + envelope_with(&[]).len(), SECTION_AREA_ALIGNMENT);
    assert_eq!(offset % 2, 0);
    offset += odd.len() * 2;
    let wide_offset = align_up(offset, 8);

    assert_eq!(wide_offset % 8, 0);
    assert_eq!(message.len(), wide_offset + wide.len() * 8);
  }

  #[test]
  fn values_survive_the_layout_unchanged() {
    // Powers of two only: a fixture written with round decimals would be asserting float
    // representation rather than layout.
    let row = [0.25f32, -0.5, 0.875];
    let mut wire = FrameWire::new();
    wire.push(WireSection::F32(&row));

    let message = wire.encode(&envelope_with(&[]));
    let start = align_up(4 + envelope_with(&[]).len(), SECTION_AREA_ALIGNMENT);
    let tail = &message[start..];
    let mut decoded = Vec::new();
    let mut offset = 0;
    while offset + 4 <= tail.len() {
      decoded.push(f32::from_le_bytes(
        tail[offset..offset + 4].try_into().unwrap(),
      ));
      offset += 4;
    }

    assert_eq!(decoded, row);
  }

  #[test]
  fn an_empty_wire_still_produces_a_readable_envelope() {
    let wire = FrameWire::new();
    let envelope = envelope_with(&[]);
    let message = wire.encode(&envelope);

    assert_eq!(
      u32::from_le_bytes(message[0..4].try_into().unwrap()) as usize,
      envelope.len()
    );
  }

  /// Pins the exact bytes `src/ipc/frameWire.test.js` decodes. The two sides share no code, so this
  /// fixture is the only thing keeping them from drifting apart; change it in both places or not at
  /// all.
  #[test]
  fn golden_message_matches_the_bytes_the_frontend_test_decodes() {
    let smooth = [0.25f32, -0.5, 0.875];
    let peak = [-1i16, 2];
    let mut wire = FrameWire::new();
    let smooth_ref = wire.push(WireSection::F32(&smooth));
    let peak_ref = wire.push(WireSection::I16(&peak));

    let envelope = serde_json::to_string(&json!({
      "wireVersion": FRAME_WIRE_VERSION,
      "seq": 7,
      "spectrumResultsByKey": { "k": { "smoothDb": smooth_ref, "peakDb": peak_ref } },
    }))
    .unwrap();

    let message = wire.encode(&envelope);
    let expected: Vec<u8> = vec![
      142, 0, 0, 0, 123, 34, 115, 101, 113, 34, 58, 55, 44, 34, 115, 112, 101, 99, 116, 114, 117,
      109, 82, 101, 115, 117, 108, 116, 115, 66, 121, 75, 101, 121, 34, 58, 123, 34, 107, 34, 58,
      123, 34, 112, 101, 97, 107, 68, 98, 34, 58, 123, 34, 36, 98, 105, 110, 34, 58, 49, 44, 34,
      100, 116, 121, 112, 101, 34, 58, 34, 105, 49, 54, 34, 44, 34, 108, 101, 110, 34, 58, 50, 125,
      44, 34, 115, 109, 111, 111, 116, 104, 68, 98, 34, 58, 123, 34, 36, 98, 105, 110, 34, 58, 48,
      44, 34, 100, 116, 121, 112, 101, 34, 58, 34, 102, 51, 50, 34, 44, 34, 108, 101, 110, 34, 58,
      51, 125, 125, 125, 44, 34, 119, 105, 114, 101, 86, 101, 114, 115, 105, 111, 110, 34, 58, 49,
      125, 0, 0, 0, 0, 0, 0, 0, 0, 128, 62, 0, 0, 0, 191, 0, 0, 96, 63, 255, 255, 2, 0,
    ];

    assert_eq!(message, expected);
  }
}
