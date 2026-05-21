//! C ABI entry for `tap_bridge.m` IOProc → Rust `SyncSender` (real-time thread).

use std::ffi::c_void;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::SyncSender;

/// Shared with Core Audio callback via raw pointer (`macos_tap_create`).
pub struct PcmBridgeCtx {
  pub tx: SyncSender<Vec<f32>>,
  pub dropped: std::sync::Arc<AtomicU64>,
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
  let mut v = Vec::with_capacity(n);
  v.extend_from_slice(slice);
  if ctx.tx.try_send(v).is_err() {
    ctx.dropped.fetch_add(1, Ordering::Relaxed);
  }
}
