use symphonia::core::audio::{AudioBufferRef, Signal};
use symphonia::core::conv::IntoSample;

/// Write a symphonia planar audio buffer directly into an interleaved `f32` vector, avoiding the
/// intermediate per-channel `Vec` allocations. Every supported sample format converts through
/// `IntoSample`, so the only per-arm difference is the concrete type.
macro_rules! interleave_buf_f32 {
  ($buf:expr) => {{
    let buf = $buf;
    let channel_count = buf.spec().channels.count();
    if channel_count == 0 {
      return Err("decoded audio buffer has no channels".to_string());
    }
    let frames = buf.frames();
    let mut out = vec![0.0_f32; frames * channel_count];
    for ch in 0..channel_count {
      for (frame, sample) in buf.chan(ch).iter().enumerate() {
        out[frame * channel_count + ch] = (*sample).into_sample();
      }
    }
    out
  }};
}

pub fn audio_buffer_ref_to_interleaved_f32(buffer: AudioBufferRef<'_>) -> Result<Vec<f32>, String> {
  let interleaved = match buffer {
    AudioBufferRef::U8(buf) => interleave_buf_f32!(buf),
    AudioBufferRef::U16(buf) => interleave_buf_f32!(buf),
    AudioBufferRef::U24(buf) => interleave_buf_f32!(buf),
    AudioBufferRef::U32(buf) => interleave_buf_f32!(buf),
    AudioBufferRef::S8(buf) => interleave_buf_f32!(buf),
    AudioBufferRef::S16(buf) => interleave_buf_f32!(buf),
    AudioBufferRef::S24(buf) => interleave_buf_f32!(buf),
    AudioBufferRef::S32(buf) => interleave_buf_f32!(buf),
    AudioBufferRef::F32(buf) => interleave_buf_f32!(buf),
    AudioBufferRef::F64(buf) => interleave_buf_f32!(buf),
  };
  Ok(interleaved)
}

#[cfg(test)]
mod tests {
  use super::*;
  use symphonia::core::audio::{AsAudioBufferRef, AudioBuffer, Channels, SignalSpec};

  #[test]
  fn interleaves_planar_buffer_in_frame_order() {
    let spec = SignalSpec::new(48_000, Channels::FRONT_LEFT | Channels::FRONT_RIGHT);
    let mut buffer = AudioBuffer::<f32>::new(3, spec);
    buffer.render_reserved(Some(3));
    buffer.chan_mut(0).copy_from_slice(&[0.1, 0.2, 0.3]);
    buffer.chan_mut(1).copy_from_slice(&[1.1, 1.2, 1.3]);

    let interleaved =
      audio_buffer_ref_to_interleaved_f32(buffer.as_audio_buffer_ref()).expect("pcm");

    assert_eq!(interleaved, vec![0.1, 1.1, 0.2, 1.2, 0.3, 1.3]);
  }

  #[test]
  fn converts_integer_samples_to_normalized_f32() {
    let spec = SignalSpec::new(48_000, Channels::FRONT_LEFT);
    let mut buffer = AudioBuffer::<i16>::new(2, spec);
    buffer.render_reserved(Some(2));
    buffer.chan_mut(0).copy_from_slice(&[i16::MAX, 0]);

    let interleaved =
      audio_buffer_ref_to_interleaved_f32(buffer.as_audio_buffer_ref()).expect("pcm");

    assert!((interleaved[0] - 1.0).abs() < 1e-3);
    assert_eq!(interleaved[1], 0.0);
  }
}
