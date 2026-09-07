#[cfg(target_os = "windows")]
mod windows_backend {
  use std::error::Error;
  use std::mem::ManuallyDrop;
  use std::os::windows::ffi::OsStrExt;
  use std::path::PathBuf;
  use std::ptr;
  use std::sync::atomic::{AtomicBool, Ordering};
  use std::sync::mpsc::{sync_channel, Receiver, SyncSender, TryRecvError, TrySendError};
  use std::sync::{Arc, Mutex};
  use std::time::SystemTime;
  use std::time::{Duration, Instant};

  use windows62::core::{Interface, PCWSTR};
  use windows62::Win32::Foundation::RECT;
  use windows62::Win32::Graphics::Direct3D11::{
    ID3D11Texture2D, ID3D11VideoContext, ID3D11VideoDevice, D3D11_BIND_RENDER_TARGET,
    D3D11_CPU_ACCESS_READ, D3D11_MAPPED_SUBRESOURCE, D3D11_MAP_READ, D3D11_TEX2D_VPIV,
    D3D11_TEX2D_VPOV, D3D11_TEXTURE2D_DESC, D3D11_USAGE_DEFAULT, D3D11_USAGE_STAGING,
    D3D11_VIDEO_COLOR, D3D11_VIDEO_COLOR_0, D3D11_VIDEO_COLOR_RGBA,
    D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE, D3D11_VIDEO_PROCESSOR_CONTENT_DESC,
    D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC, D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC_0,
    D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC, D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC_0,
    D3D11_VIDEO_PROCESSOR_STREAM, D3D11_VIDEO_USAGE_PLAYBACK_NORMAL,
    D3D11_VPIV_DIMENSION_TEXTURE2D, D3D11_VPOV_DIMENSION_TEXTURE2D,
  };
  use windows62::Win32::Graphics::Dxgi::Common::{
    DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_RATIONAL, DXGI_SAMPLE_DESC,
  };
  use windows62::Win32::Media::MediaFoundation::{
    IMFAttributes, IMFByteStream, IMFMediaBuffer, IMFSample, IMFSinkWriter, MFCreateAttributes,
    MFCreateMediaType, MFCreateMemoryBuffer, MFCreateSample, MFCreateSinkWriterFromURL,
    MFMediaType_Video, MFStartup, MFTranscodeContainerType_MPEG4, MFVideoFormat_H264,
    MFVideoFormat_RGB32, MFVideoInterlace_Progressive, MFSTARTUP_FULL,
    MF_TRANSCODE_CONTAINERTYPE, MF_MT_AVG_BITRATE, MF_MT_FRAME_RATE, MF_MT_FRAME_SIZE,
    MF_MT_INTERLACE_MODE, MF_MT_MAJOR_TYPE, MF_MT_PIXEL_ASPECT_RATIO, MF_MT_SUBTYPE, MF_VERSION,
  };
  use windows_capture::capture::{Context, GraphicsCaptureApiHandler};
  use windows_capture::frame::Frame;
  use windows_capture::graphics_capture_api::InternalCaptureControl;
  use windows_capture::settings::{
    ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings,
    MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings,
  };
  use windows_capture::window::Window;
  use windows_sys::Win32::Foundation::{POINT, RECT as SysRect};
  use windows_sys::Win32::Graphics::Gdi::ClientToScreen;
  use windows_sys::Win32::UI::WindowsAndMessaging::{GetClientRect, GetWindowRect};

  use super::super::super::artifacts::{ArtifactStore, PendingArtifact};
  use super::super::super::platform::{calculate_pixel_crop, CssRect, CssViewport, PixelCrop};
  use super::super::state::{RecordingRegistry, StopReason, MAX_ARTIFACT_BYTES};

  #[derive(Clone, Debug)]
  struct ProbeSettings {
    output: PathBuf,
    width: u32,
    height: u32,
    fps: u32,
    duration: Duration,
  }

  struct ProbeCapture {
    encoder: Option<MediaFoundationEncoder>,
    started: Instant,
    duration: Duration,
    frames: u64,
    scratch: Vec<u8>,
  }

  struct MediaFoundationEncoder {
    writer: IMFSinkWriter,
    stream: u32,
    width: u32,
    height: u32,
    frame_duration: i64,
  }

  // The sink writer is created and consumed on the capture worker. The trait requires the handler
  // to be movable into that worker before `new` constructs this COM object; it is never shared.
  unsafe impl Send for MediaFoundationEncoder {}

  impl MediaFoundationEncoder {
    fn new(
      output_path: &std::path::Path,
      width: u32,
      height: u32,
      fps: u32,
    ) -> Result<Self, windows62::core::Error> {
      unsafe { MFStartup(MF_VERSION, MFSTARTUP_FULL)? };
      let wide_path = output_path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
      let mut attributes = None;
      unsafe { MFCreateAttributes(&mut attributes, 1)? };
      let attributes = attributes.expect("Media Foundation returned no attribute store");
      unsafe {
        attributes.SetGUID(&MF_TRANSCODE_CONTAINERTYPE, &MFTranscodeContainerType_MPEG4)?;
      }
      let writer = unsafe {
        MFCreateSinkWriterFromURL(
          PCWSTR(wide_path.as_ptr()),
          Option::<&IMFByteStream>::None,
          Some(&attributes),
        )?
      };
      let output = unsafe { MFCreateMediaType()? };
      unsafe {
        output.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
        output.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_H264)?;
        output.SetUINT32(&MF_MT_AVG_BITRATE, 8_000_000)?;
        output.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)?;
        output.SetUINT64(
          &MF_MT_FRAME_SIZE,
          (u64::from(width) << 32) | u64::from(height),
        )?;
        output.SetUINT64(&MF_MT_FRAME_RATE, u64::from(fps) << 32 | 1)?;
        output.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, 1_u64 << 32 | 1)?;
      }
      let stream = unsafe { writer.AddStream(&output)? };

      let input = unsafe { MFCreateMediaType()? };
      unsafe {
        input.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
        input.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_RGB32)?;
        input.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)?;
        input.SetUINT64(
          &MF_MT_FRAME_SIZE,
          (u64::from(width) << 32) | u64::from(height),
        )?;
        input.SetUINT64(&MF_MT_FRAME_RATE, u64::from(fps) << 32 | 1)?;
        input.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, 1_u64 << 32 | 1)?;
        writer.SetInputMediaType(stream, &input, Option::<&IMFAttributes>::None)?;
        writer.BeginWriting()?;
      }
      Ok(Self {
        writer,
        stream,
        width,
        height,
        frame_duration: 10_000_000 / i64::from(fps),
      })
    }

    fn write_frame(&self, bytes: &[u8], frame_index: u64) -> Result<(), windows62::core::Error> {
      let buffer: IMFMediaBuffer = unsafe { MFCreateMemoryBuffer(bytes.len() as u32)? };
      let mut destination = ptr::null_mut();
      unsafe {
        buffer.Lock(&mut destination, None, None)?;
        ptr::copy_nonoverlapping(bytes.as_ptr(), destination, bytes.len());
        buffer.Unlock()?;
        buffer.SetCurrentLength(bytes.len() as u32)?;
      }
      let sample: IMFSample = unsafe { MFCreateSample()? };
      unsafe {
        sample.AddBuffer(&buffer)?;
        sample
          .SetSampleTime(i64::try_from(frame_index).unwrap_or(i64::MAX) * self.frame_duration)?;
        sample.SetSampleDuration(self.frame_duration)?;
        self.writer.WriteSample(self.stream, &sample)?;
      }
      Ok(())
    }

    fn finish(self) -> Result<(), windows62::core::Error> {
      unsafe { self.writer.Finalize() }
    }
  }

  fn aspect_fit(
    source_width: u32,
    source_height: u32,
    output_width: u32,
    output_height: u32,
  ) -> RECT {
    let source_aspect = source_width as f64 / source_height as f64;
    let output_aspect = output_width as f64 / output_height as f64;
    let (width, height) = if source_aspect > output_aspect {
      (
        output_width,
        (f64::from(output_width) / source_aspect).round() as u32,
      )
    } else {
      (
        (f64::from(output_height) * source_aspect).round() as u32,
        output_height,
      )
    };
    let left = (output_width - width) / 2;
    let top = (output_height - height) / 2;
    RECT {
      left: left as i32,
      top: top as i32,
      right: (left + width) as i32,
      bottom: (top + height) as i32,
    }
  }

  fn composite_frame(
    frame: &Frame,
    crop: PixelCrop,
    output_width: u32,
    output_height: u32,
    bottom_up: &mut Vec<u8>,
  ) -> Result<(), windows62::core::Error> {
    let device = frame.device();
    let context = frame.device_context();
    let video_device: ID3D11VideoDevice = device.cast()?;
    let video_context: ID3D11VideoContext = context.cast()?;
    let source_width = frame.width();
    let source_height = frame.height();
    let content = D3D11_VIDEO_PROCESSOR_CONTENT_DESC {
      InputFrameFormat: D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE,
      InputFrameRate: DXGI_RATIONAL {
        Numerator: 30,
        Denominator: 1,
      },
      InputWidth: source_width,
      InputHeight: source_height,
      OutputFrameRate: DXGI_RATIONAL {
        Numerator: 30,
        Denominator: 1,
      },
      OutputWidth: output_width,
      OutputHeight: output_height,
      Usage: D3D11_VIDEO_USAGE_PLAYBACK_NORMAL,
    };
    let enumerator = unsafe { video_device.CreateVideoProcessorEnumerator(&content)? };
    let processor = unsafe { video_device.CreateVideoProcessor(&enumerator, 0)? };
    let input_desc = D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC {
      FourCC: 0,
      ViewDimension: D3D11_VPIV_DIMENSION_TEXTURE2D,
      Anonymous: D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC_0 {
        Texture2D: D3D11_TEX2D_VPIV {
          MipSlice: 0,
          ArraySlice: 0,
        },
      },
    };
    let mut input_view = None;
    unsafe {
      video_device.CreateVideoProcessorInputView(
        frame.as_raw_texture(),
        &enumerator,
        &input_desc,
        Some(&mut input_view),
      )?;
    }
    let input_view = input_view.expect("D3D11 returned success without an input view");

    let output_desc = D3D11_TEXTURE2D_DESC {
      Width: output_width,
      Height: output_height,
      MipLevels: 1,
      ArraySize: 1,
      Format: DXGI_FORMAT_B8G8R8A8_UNORM,
      SampleDesc: DXGI_SAMPLE_DESC {
        Count: 1,
        Quality: 0,
      },
      Usage: D3D11_USAGE_DEFAULT,
      BindFlags: D3D11_BIND_RENDER_TARGET.0 as u32,
      CPUAccessFlags: 0,
      MiscFlags: 0,
    };
    let mut output_texture = None;
    unsafe { device.CreateTexture2D(&output_desc, None, Some(&mut output_texture))? };
    let output_texture = output_texture.expect("D3D11 returned success without an output texture");
    let output_view_desc = D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC {
      ViewDimension: D3D11_VPOV_DIMENSION_TEXTURE2D,
      Anonymous: D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC_0 {
        Texture2D: D3D11_TEX2D_VPOV { MipSlice: 0 },
      },
    };
    let mut output_view = None;
    unsafe {
      video_device.CreateVideoProcessorOutputView(
        &output_texture,
        &enumerator,
        &output_view_desc,
        Some(&mut output_view),
      )?;
    }
    let output_view = output_view.expect("D3D11 returned success without an output view");

    let source_rect = RECT {
      left: crop.x as i32,
      top: crop.y as i32,
      right: (crop.x + crop.width) as i32,
      bottom: (crop.y + crop.height) as i32,
    };
    let destination = aspect_fit(crop.width, crop.height, output_width, output_height);
    let background = D3D11_VIDEO_COLOR {
      Anonymous: D3D11_VIDEO_COLOR_0 {
        RGBA: D3D11_VIDEO_COLOR_RGBA {
          R: 0.0,
          G: 0.0,
          B: 0.0,
          A: 1.0,
        },
      },
    };
    unsafe {
      video_context.VideoProcessorSetOutputBackgroundColor(&processor, false, &background);
      video_context.VideoProcessorSetStreamSourceRect(&processor, 0, true, Some(&source_rect));
      video_context.VideoProcessorSetStreamDestRect(&processor, 0, true, Some(&destination));
    }
    let mut stream = D3D11_VIDEO_PROCESSOR_STREAM {
      Enable: true.into(),
      pInputSurface: ManuallyDrop::new(Some(input_view)),
      ..Default::default()
    };
    let blit = unsafe {
      video_context.VideoProcessorBlt(&processor, &output_view, 0, std::slice::from_ref(&stream))
    };
    unsafe { ManuallyDrop::drop(&mut stream.pInputSurface) };
    blit?;

    let staging_desc = D3D11_TEXTURE2D_DESC {
      Usage: D3D11_USAGE_STAGING,
      BindFlags: 0,
      CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
      ..output_desc
    };
    let mut staging = None;
    unsafe { device.CreateTexture2D(&staging_desc, None, Some(&mut staging))? };
    let staging: ID3D11Texture2D =
      staging.expect("D3D11 returned success without a staging texture");
    unsafe { context.CopyResource(&staging, &output_texture) };
    let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
    unsafe { context.Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped))? };
    let row_bytes = usize::try_from(output_width * 4).unwrap();
    let required = row_bytes * usize::try_from(output_height).unwrap();
    bottom_up.resize(required, 0);
    for row in 0..usize::try_from(output_height).unwrap() {
      let source = unsafe {
        std::slice::from_raw_parts(
          (mapped.pData as *const u8).add(row * mapped.RowPitch as usize),
          row_bytes,
        )
      };
      let destination_offset = (usize::try_from(output_height).unwrap() - row - 1) * row_bytes;
      bottom_up[destination_offset..destination_offset + row_bytes].copy_from_slice(source);
    }
    unsafe { context.Unmap(&staging, 0) };
    Ok(())
  }

  impl GraphicsCaptureApiHandler for ProbeCapture {
    type Flags = ProbeSettings;
    type Error = Box<dyn Error + Send + Sync>;

    fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> {
      let settings = ctx.flags;
      let initializing = Instant::now();
      let encoder = MediaFoundationEncoder::new(
        &settings.output,
        settings.width,
        settings.height,
        settings.fps,
      )?;
      println!(
        "{{\"event\":\"initialized\",\"width\":{},\"height\":{},\"fps\":{},\"latencyMs\":{}}}",
        settings.width,
        settings.height,
        settings.fps,
        initializing.elapsed().as_millis()
      );
      Ok(Self {
        encoder: Some(encoder),
        started: Instant::now(),
        duration: settings.duration,
        frames: 0,
        scratch: Vec::new(),
      })
    }

    fn on_frame_arrived(
      &mut self,
      frame: &mut Frame,
      capture_control: InternalCaptureControl,
    ) -> Result<(), Self::Error> {
      let encoder = self
        .encoder
        .as_ref()
        .expect("probe encoder remains owned until finalization");
      let inset = 8_u32
        .min(frame.width().saturating_sub(2) / 2)
        .min(frame.height().saturating_sub(2) / 2);
      let crop = PixelCrop {
        x: inset,
        y: inset,
        width: frame.width() - inset * 2,
        height: frame.height() - inset * 2,
      };
      composite_frame(
        frame,
        crop,
        encoder.width,
        encoder.height,
        &mut self.scratch,
      )?;
      encoder.write_frame(&self.scratch, self.frames)?;
      self.frames += 1;
      if self.started.elapsed() >= self.duration {
        let finalizing = Instant::now();
        self
          .encoder
          .take()
          .expect("probe encoder finalizes exactly once")
          .finish()?;
        println!(
          "{{\"ok\":true,\"stopReason\":\"duration\",\"frames\":{},\"elapsedMs\":{},\"finalizeMs\":{}}}",
          self.frames,
          self.started.elapsed().as_millis(),
          finalizing.elapsed().as_millis()
        );
        capture_control.stop();
      }
      Ok(())
    }

    fn on_closed(&mut self) -> Result<(), Self::Error> {
      let finalizing = Instant::now();
      if let Some(encoder) = self.encoder.take() {
        encoder.finish()?;
      }
      println!(
        "{{\"ok\":true,\"stopReason\":\"windowClosed\",\"frames\":{},\"elapsedMs\":{},\"finalizeMs\":{}}}",
        self.frames,
        self.started.elapsed().as_millis(),
        finalizing.elapsed().as_millis()
      );
      Ok(())
    }
  }

  pub fn run() -> Result<(), Box<dyn Error>> {
    let mut args = std::env::args().skip(1);
    let title = args.next().unwrap_or_else(|| "PLVS Dev".to_string());
    let output = PathBuf::from(
      args
        .next()
        .unwrap_or_else(|| "visual-capture-probe.mp4".to_string()),
    );
    let duration_seconds = args
      .next()
      .map(|value| value.parse::<u64>())
      .transpose()?
      .unwrap_or(3);
    let fps = args
      .next()
      .map(|value| value.parse::<u32>())
      .transpose()?
      .unwrap_or(30);

    let window = Window::from_name(&title)?;
    // H.264 encoders require an even-sized 4:2:0 output canvas on common Windows hardware.
    let width = 960;
    let height = 540;
    let flags = ProbeSettings {
      output,
      width,
      height,
      fps,
      duration: Duration::from_secs(duration_seconds),
    };
    let settings = Settings::new(
      window,
      CursorCaptureSettings::WithCursor,
      DrawBorderSettings::WithoutBorder,
      SecondaryWindowSettings::Default,
      MinimumUpdateIntervalSettings::Default,
      DirtyRegionSettings::Default,
      ColorFormat::Bgra8,
      flags,
    );
    ProbeCapture::start(settings)?;
    Ok(())
  }

  #[derive(Clone, Copy, Debug)]
  pub struct RecordingGeometry {
    pub rect: CssRect,
    pub viewport: CssViewport,
  }

  #[derive(Clone)]
  pub struct RecordingSession {
    recording_id: String,
    stop_reason: Arc<Mutex<Option<StopReason>>>,
    geometry: Arc<Mutex<RecordingGeometry>>,
    finished: Arc<AtomicBool>,
  }

  impl RecordingSession {
    pub fn recording_id(&self) -> &str {
      &self.recording_id
    }

    pub fn request_stop(&self, reason: StopReason) {
      if let Ok(mut requested) = self.stop_reason.lock() {
        requested.get_or_insert(reason);
      }
    }

    pub fn update_geometry(&self, geometry: RecordingGeometry) -> Result<(), &'static str> {
      validate_geometry(geometry)?;
      *self.geometry.lock().map_err(|_| "stateUnavailable")? = geometry;
      Ok(())
    }

    pub fn is_finished(&self) -> bool {
      self.finished.load(Ordering::Acquire)
    }
  }

  struct ProductionSettings {
    recording_id: String,
    output_width: u32,
    output_height: u32,
    registry: RecordingRegistry,
    geometry: Arc<Mutex<RecordingGeometry>>,
    stop_reason: Arc<Mutex<Option<StopReason>>>,
    frames: SyncSender<Vec<u8>>,
    hwnd: usize,
  }

  struct ProductionCapture {
    recording_id: String,
    registry: RecordingRegistry,
    geometry: Arc<Mutex<RecordingGeometry>>,
    stop_reason: Arc<Mutex<Option<StopReason>>>,
    frames: SyncSender<Vec<u8>>,
    output_width: u32,
    output_height: u32,
    hwnd: usize,
    scratch: Vec<u8>,
  }

  impl GraphicsCaptureApiHandler for ProductionCapture {
    type Flags = ProductionSettings;
    type Error = Box<dyn Error + Send + Sync>;

    fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> {
      let settings = ctx.flags;
      Ok(Self {
        recording_id: settings.recording_id,
        registry: settings.registry,
        geometry: settings.geometry,
        stop_reason: settings.stop_reason,
        frames: settings.frames,
        output_width: settings.output_width,
        output_height: settings.output_height,
        hwnd: settings.hwnd,
        scratch: Vec::new(),
      })
    }

    fn on_frame_arrived(
      &mut self,
      frame: &mut Frame,
      _capture_control: InternalCaptureControl,
    ) -> Result<(), Self::Error> {
      let geometry = *self
        .geometry
        .lock()
        .map_err(|_| "recording geometry lock poisoned")?;
      let crop = window_client_crop(self.hwnd, frame.width(), frame.height(), geometry)?;
      composite_frame(
        frame,
        crop,
        self.output_width,
        self.output_height,
        &mut self.scratch,
      )?;
      let frame_bytes = std::mem::take(&mut self.scratch);
      match self.frames.try_send(frame_bytes) {
        Ok(()) => {}
        Err(TrySendError::Full(frame_bytes)) => {
          self.scratch = frame_bytes;
          self.registry.add_dropped_frames(&self.recording_id, 1);
        }
        Err(TrySendError::Disconnected(frame_bytes)) => {
          self.scratch = frame_bytes;
        }
      }
      Ok(())
    }

    fn on_closed(&mut self) -> Result<(), Self::Error> {
      if let Ok(mut reason) = self.stop_reason.lock() {
        reason.get_or_insert(StopReason::WindowLost);
      }
      Ok(())
    }
  }

  #[allow(clippy::too_many_arguments)]
  fn run_encoder(
    recording_id: String,
    output_width: u32,
    output_height: u32,
    fps: u32,
    pending: PendingArtifact,
    store: ArtifactStore,
    registry: RecordingRegistry,
    stop_reason: Arc<Mutex<Option<StopReason>>>,
    finished: Arc<AtomicBool>,
    frames: Receiver<Vec<u8>>,
    initialized: SyncSender<Result<(), String>>,
  ) {
    let encoder =
      match MediaFoundationEncoder::new(pending.path(), output_width, output_height, fps) {
        Ok(encoder) => encoder,
        Err(error) => {
          let message = format!("Media Foundation initialization failed: {error}");
          let _ = initialized.send(Err(message.clone()));
          registry.fail(&recording_id, message);
          finished.store(true, Ordering::Release);
          return;
        }
      };
    registry.mark_recording(&recording_id);
    let _ = initialized.send(Ok(()));

    let frame_interval = Duration::from_secs_f64(1.0 / f64::from(fps));
    let mut next_frame = Instant::now();
    let mut latest = None;
    let mut frame_index = 0_u64;
    let mut failure = None;
    loop {
      if stop_reason.lock().ok().and_then(|reason| *reason).is_some() {
        break;
      }
      let timeout = next_frame.saturating_duration_since(Instant::now());
      match frames.recv_timeout(timeout) {
        Ok(frame) => {
          latest = Some(frame);
          loop {
            match frames.try_recv() {
              Ok(frame) => {
                latest = Some(frame);
                registry.add_dropped_frames(&recording_id, 1);
              }
              Err(TryRecvError::Empty) => break,
              Err(TryRecvError::Disconnected) => break,
            }
          }
        }
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
          if let Some(frame) = latest.as_deref() {
            if let Err(error) = encoder.write_frame(frame, frame_index) {
              failure = Some(format!("Media Foundation video write failed: {error}"));
              if let Ok(mut reason) = stop_reason.lock() {
                reason.get_or_insert(StopReason::CaptureFailure);
              }
              break;
            }
            frame_index = frame_index.saturating_add(1);
            let bytes = std::fs::metadata(pending.path())
              .map(|metadata| metadata.len())
              .unwrap_or(0);
            registry.add_frame(&recording_id, bytes, 0);
            if bytes >= MAX_ARTIFACT_BYTES {
              if let Ok(mut reason) = stop_reason.lock() {
                reason.get_or_insert(StopReason::SizeLimit);
              }
            }
          }
          next_frame += frame_interval;
          if next_frame < Instant::now() {
            next_frame = Instant::now();
            registry.add_dropped_frames(&recording_id, 1);
          }
        }
        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
          if let Ok(mut reason) = stop_reason.lock() {
            reason.get_or_insert(StopReason::WindowLost);
          }
          break;
        }
      }
    }

    let terminal_reason = stop_reason.lock().ok().and_then(|reason| *reason);
    if let Some(reason) = terminal_reason {
      registry.request_stop(&recording_id, reason);
    }
    if let Err(error) = encoder.finish() {
      registry.fail(
        &recording_id,
        format!("Media Foundation finalization failed: {error}"),
      );
      finished.store(true, Ordering::Release);
      return;
    }
    match store.publish_blocking(pending, output_width, output_height, SystemTime::now()) {
      Ok(artifact) => {
        let failure = failure.or_else(|| {
          (terminal_reason == Some(StopReason::CaptureFailure))
            .then(|| "Windows Graphics Capture failed.".to_owned())
        });
        if let Some(message) = failure {
          registry.fail_with_artifact(&recording_id, message, artifact);
        } else {
          registry.complete(&recording_id, artifact);
        }
      }
      Err(error) => registry.fail(
        &recording_id,
        format!("Recording artifact publication failed: {error}"),
      ),
    }
    finished.store(true, Ordering::Release);
  }

  fn validate_geometry(geometry: RecordingGeometry) -> Result<(), &'static str> {
    let values = [
      geometry.rect.x,
      geometry.rect.y,
      geometry.rect.width,
      geometry.rect.height,
      geometry.viewport.width,
      geometry.viewport.height,
    ];
    if values.iter().any(|value| !value.is_finite())
      || geometry.rect.width <= 0.0
      || geometry.rect.height <= 0.0
      || geometry.viewport.width <= 0.0
      || geometry.viewport.height <= 0.0
    {
      return Err("invalidGeometry");
    }
    Ok(())
  }

  fn window_client_crop(
    hwnd: usize,
    frame_width: u32,
    frame_height: u32,
    geometry: RecordingGeometry,
  ) -> Result<PixelCrop, Box<dyn Error + Send + Sync>> {
    let hwnd = hwnd as windows_sys::Win32::Foundation::HWND;
    let mut window = SysRect::default();
    let mut client = SysRect::default();
    let mut client_origin = POINT::default();
    if unsafe { GetWindowRect(hwnd, &mut window) } == 0
      || unsafe { GetClientRect(hwnd, &mut client) } == 0
      || unsafe { ClientToScreen(hwnd, &mut client_origin) } == 0
    {
      return Err("The PLVS client-area geometry is unavailable.".into());
    }
    let window_width = f64::from(window.right - window.left);
    let window_height = f64::from(window.bottom - window.top);
    let client_width = f64::from(client.right - client.left);
    let client_height = f64::from(client.bottom - client.top);
    if window_width <= 0.0 || window_height <= 0.0 || client_width <= 0.0 || client_height <= 0.0 {
      return Err("The PLVS client area is empty.".into());
    }
    pixel_crop_for_client(
      frame_width,
      frame_height,
      (window_width, window_height),
      (
        f64::from(client_origin.x - window.left),
        f64::from(client_origin.y - window.top),
        client_width,
        client_height,
      ),
      geometry,
    )
    .map_err(Into::into)
  }

  fn pixel_crop_for_client(
    frame_width: u32,
    frame_height: u32,
    window_size: (f64, f64),
    client_bounds: (f64, f64, f64, f64),
    geometry: RecordingGeometry,
  ) -> Result<PixelCrop, super::super::super::platform::CaptureError> {
    let (window_width, window_height) = window_size;
    let (offset_x, offset_y, client_width, client_height) = client_bounds;
    let translated = CssRect {
      x: offset_x + geometry.rect.x * client_width / geometry.viewport.width,
      y: offset_y + geometry.rect.y * client_height / geometry.viewport.height,
      width: geometry.rect.width * client_width / geometry.viewport.width,
      height: geometry.rect.height * client_height / geometry.viewport.height,
    };
    calculate_pixel_crop(
      frame_width,
      frame_height,
      CssViewport {
        width: window_width,
        height: window_height,
      },
      translated,
    )
  }

  #[allow(clippy::too_many_arguments)]
  pub fn start_recording(
    hwnd: *mut std::ffi::c_void,
    recording_id: String,
    output_width: u32,
    output_height: u32,
    fps: u32,
    max_duration_seconds: u32,
    geometry: RecordingGeometry,
    pending: PendingArtifact,
    store: ArtifactStore,
    registry: RecordingRegistry,
  ) -> Result<RecordingSession, String> {
    validate_geometry(geometry).map_err(str::to_owned)?;
    let stop_reason = Arc::new(Mutex::new(None));
    let geometry = Arc::new(Mutex::new(geometry));
    let finished = Arc::new(AtomicBool::new(false));
    let session = RecordingSession {
      recording_id: recording_id.clone(),
      stop_reason: Arc::clone(&stop_reason),
      geometry: Arc::clone(&geometry),
      finished: Arc::clone(&finished),
    };
    let (frame_sender, frame_receiver) = sync_channel(2);
    let (initialized_sender, initialized_receiver) = sync_channel(1);
    let encoder_recording_id = recording_id.clone();
    let encoder_registry = registry.clone();
    let encoder_stop_reason = Arc::clone(&stop_reason);
    let encoder_finished = Arc::clone(&finished);
    std::thread::Builder::new()
      .name("visual-recording-encoder".into())
      .spawn(move || {
        run_encoder(
          encoder_recording_id,
          output_width,
          output_height,
          fps,
          pending,
          store,
          encoder_registry,
          encoder_stop_reason,
          encoder_finished,
          frame_receiver,
          initialized_sender,
        );
      })
      .map_err(|error| format!("Recording encoder worker could not start: {error}"))?;
    initialized_receiver
      .recv_timeout(Duration::from_secs(5))
      .map_err(|_| "Media Foundation initialization timed out.".to_owned())??;
    let settings = Settings::new(
      Window::from_raw_hwnd(hwnd),
      CursorCaptureSettings::WithCursor,
      DrawBorderSettings::WithoutBorder,
      SecondaryWindowSettings::Default,
      MinimumUpdateIntervalSettings::Default,
      DirtyRegionSettings::Default,
      ColorFormat::Bgra8,
      ProductionSettings {
        recording_id: recording_id.clone(),
        output_width,
        output_height,
        registry: registry.clone(),
        geometry,
        stop_reason: Arc::clone(&stop_reason),
        frames: frame_sender,
        hwnd: hwnd as usize,
      },
    );
    let control = ProductionCapture::start_free_threaded(settings).map_err(|error| {
      if let Ok(mut reason) = stop_reason.lock() {
        reason.get_or_insert(StopReason::CaptureFailure);
      }
      format!("Windows Graphics Capture start failed: {error}")
    })?;
    std::thread::Builder::new()
      .name("visual-recording-supervisor".into())
      .spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(u64::from(max_duration_seconds));
        loop {
          if control.is_finished() {
            if let Err(error) = control.wait() {
              if let Ok(mut reason) = stop_reason.lock() {
                reason.get_or_insert(StopReason::CaptureFailure);
              }
              registry.record_event(
                &recording_id,
                "captureFailure",
                format!("Windows Graphics Capture failed: {error}"),
              );
            }
            break;
          }
          let requested = stop_reason.lock().ok().and_then(|reason| *reason);
          if requested.is_some() || Instant::now() >= deadline {
            if requested.is_none() {
              if let Ok(mut reason) = stop_reason.lock() {
                reason.get_or_insert(StopReason::DurationLimit);
              }
            }
            if let Err(error) = control.stop() {
              if let Ok(mut reason) = stop_reason.lock() {
                reason.get_or_insert(StopReason::CaptureFailure);
              }
              registry.record_event(
                &recording_id,
                "captureFailure",
                format!("Windows Graphics Capture stop failed: {error}"),
              );
            }
            break;
          }
          std::thread::sleep(Duration::from_millis(20));
        }
      })
      .map_err(|error| format!("Recording supervisor could not start: {error}"))?;
    Ok(session)
  }

  #[cfg(test)]
  mod production_tests {
    use super::*;

    #[test]
    fn client_crop_excludes_native_chrome_and_scales_semantic_rect() {
      let crop = pixel_crop_for_client(
        1000,
        800,
        (1000.0, 800.0),
        (8.0, 40.0, 984.0, 752.0),
        RecordingGeometry {
          rect: CssRect {
            x: 100.0,
            y: 50.0,
            width: 200.0,
            height: 100.0,
          },
          viewport: CssViewport {
            width: 984.0,
            height: 752.0,
          },
        },
      )
      .unwrap();
      assert_eq!(
        crop,
        PixelCrop {
          x: 108,
          y: 90,
          width: 200,
          height: 100
        }
      );
    }

    #[test]
    fn aspect_fit_centers_letterboxing_without_changing_canvas() {
      assert_eq!(
        aspect_fit(1000, 500, 640, 480),
        RECT {
          left: 0,
          top: 80,
          right: 640,
          bottom: 400
        }
      );
      assert_eq!(
        aspect_fit(500, 1000, 640, 480),
        RECT {
          left: 200,
          top: 0,
          right: 440,
          bottom: 480
        }
      );
    }

    #[test]
    fn geometry_validation_rejects_empty_and_non_finite_updates() {
      for width in [0.0, f64::NAN] {
        assert_eq!(
          validate_geometry(RecordingGeometry {
            rect: CssRect {
              x: 0.0,
              y: 0.0,
              width,
              height: 10.0
            },
            viewport: CssViewport {
              width: 10.0,
              height: 10.0
            },
          }),
          Err("invalidGeometry")
        );
      }
    }
  }
}

#[cfg(target_os = "windows")]
pub fn run_probe() -> Result<(), Box<dyn std::error::Error>> {
  windows_backend::run()
}

#[cfg(target_os = "windows")]
pub use windows_backend::{start_recording, RecordingGeometry, RecordingSession};

#[cfg(not(target_os = "windows"))]
pub fn run_probe() -> Result<(), Box<dyn std::error::Error>> {
  Err("visual capture probe is Windows-only".into())
}
