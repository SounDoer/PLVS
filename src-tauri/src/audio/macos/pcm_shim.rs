//! C ABI entry for `tap_bridge.m` IOProc → Rust `PcmDeliveryQueue` (real-time thread).

use std::ffi::c_void;

use super::super::cpal_backend::PcmCallbackForwarder;

/// Shared with Core Audio callback via raw pointer (`macos_tap_create`).
pub struct PcmBridgeCtx {
  pub forwarder: PcmCallbackForwarder,
}

#[no_mangle]
pub unsafe extern "C" fn pcm_bridge(
  userdata: *mut c_void,
  samples: *const f32,
  frame_count: u32,
  channels: u32,
) {
  if userdata.is_null() || samples.is_null() || channels == 0 {
    return;
  }
  let ctx = &*(userdata.cast::<PcmBridgeCtx>());
  let n = (frame_count as usize).saturating_mul(channels as usize);
  let slice = std::slice::from_raw_parts(samples, n);
  ctx.forwarder.forward_f32(slice);
}
