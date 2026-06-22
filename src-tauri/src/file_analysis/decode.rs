pub fn interleave_planar_f32(channels: &[Vec<f32>]) -> Result<Vec<f32>, String> {
  if channels.is_empty() {
    return Err("decoded audio buffer has no channels".to_string());
  }
  let frames = channels[0].len();
  if channels.iter().any(|channel| channel.len() != frames) {
    return Err("decoded audio channels have inconsistent lengths".to_string());
  }
  let mut out = Vec::with_capacity(frames * channels.len());
  for frame in 0..frames {
    for channel in channels {
      out.push(channel[frame]);
    }
  }
  Ok(out)
}

use symphonia::core::audio::{AudioBufferRef, Signal};
use symphonia::core::conv::IntoSample;

pub fn audio_buffer_ref_to_interleaved_f32(buffer: AudioBufferRef<'_>) -> Result<Vec<f32>, String> {
  match buffer {
    AudioBufferRef::F32(buf) => {
      let channels: Vec<Vec<f32>> = (0..buf.spec().channels.count())
        .map(|ch| buf.chan(ch).to_vec())
        .collect();
      interleave_planar_f32(&channels)
    }
    AudioBufferRef::U8(buf) => {
      let channels: Vec<Vec<f32>> = (0..buf.spec().channels.count())
        .map(|ch| buf.chan(ch).iter().map(|sample| (*sample).into_sample()).collect())
        .collect();
      interleave_planar_f32(&channels)
    }
    AudioBufferRef::U16(buf) => {
      let channels: Vec<Vec<f32>> = (0..buf.spec().channels.count())
        .map(|ch| buf.chan(ch).iter().map(|sample| (*sample).into_sample()).collect())
        .collect();
      interleave_planar_f32(&channels)
    }
    AudioBufferRef::U24(buf) => {
      let channels: Vec<Vec<f32>> = (0..buf.spec().channels.count())
        .map(|ch| buf.chan(ch).iter().map(|sample| (*sample).into_sample()).collect())
        .collect();
      interleave_planar_f32(&channels)
    }
    AudioBufferRef::U32(buf) => {
      let channels: Vec<Vec<f32>> = (0..buf.spec().channels.count())
        .map(|ch| buf.chan(ch).iter().map(|sample| (*sample).into_sample()).collect())
        .collect();
      interleave_planar_f32(&channels)
    }
    AudioBufferRef::S8(buf) => {
      let channels: Vec<Vec<f32>> = (0..buf.spec().channels.count())
        .map(|ch| buf.chan(ch).iter().map(|sample| (*sample).into_sample()).collect())
        .collect();
      interleave_planar_f32(&channels)
    }
    AudioBufferRef::S16(buf) => {
      let channels: Vec<Vec<f32>> = (0..buf.spec().channels.count())
        .map(|ch| buf.chan(ch).iter().map(|sample| (*sample).into_sample()).collect())
        .collect();
      interleave_planar_f32(&channels)
    }
    AudioBufferRef::S24(buf) => {
      let channels: Vec<Vec<f32>> = (0..buf.spec().channels.count())
        .map(|ch| buf.chan(ch).iter().map(|sample| (*sample).into_sample()).collect())
        .collect();
      interleave_planar_f32(&channels)
    }
    AudioBufferRef::S32(buf) => {
      let channels: Vec<Vec<f32>> = (0..buf.spec().channels.count())
        .map(|ch| buf.chan(ch).iter().map(|sample| (*sample).into_sample()).collect())
        .collect();
      interleave_planar_f32(&channels)
    }
    AudioBufferRef::F64(buf) => {
      let channels: Vec<Vec<f32>> = (0..buf.spec().channels.count())
        .map(|ch| buf.chan(ch).iter().map(|sample| (*sample).into_sample()).collect())
        .collect();
      interleave_planar_f32(&channels)
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn interleaves_planar_f32_channels() {
    let left = vec![0.1, 0.2, 0.3];
    let right = vec![1.1, 1.2, 1.3];

    let interleaved = interleave_planar_f32(&[left, right]).expect("pcm");

    assert_eq!(interleaved, vec![0.1, 1.1, 0.2, 1.2, 0.3, 1.3]);
  }

  #[test]
  fn rejects_empty_channel_set() {
    let err = interleave_planar_f32(&[]).expect_err("error");
    assert_eq!(err, "decoded audio buffer has no channels");
  }

  #[test]
  fn rejects_inconsistent_channel_lengths() {
    let err = interleave_planar_f32(&[vec![0.0, 0.1], vec![1.0]]).expect_err("error");
    assert_eq!(err, "decoded audio channels have inconsistent lengths");
  }
}
