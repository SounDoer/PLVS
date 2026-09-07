#[cfg(target_os = "windows")]
mod windows_probe {
  use std::error::Error;
  use std::mem::ManuallyDrop;
  use std::os::windows::ffi::OsStrExt;
  use std::path::PathBuf;
  use std::ptr;
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
    IMFAttributes, IMFByteStream, IMFMediaBuffer, IMFSample, IMFSinkWriter, MFCreateMediaType,
    MFCreateMemoryBuffer, MFCreateSample, MFCreateSinkWriterFromURL, MFMediaType_Video, MFStartup,
    MFVideoFormat_H264, MFVideoFormat_RGB32, MFVideoInterlace_Progressive, MFSTARTUP_FULL,
    MF_MT_AVG_BITRATE, MF_MT_FRAME_RATE, MF_MT_FRAME_SIZE, MF_MT_INTERLACE_MODE, MF_MT_MAJOR_TYPE,
    MF_MT_PIXEL_ASPECT_RATIO, MF_MT_SUBTYPE, MF_VERSION,
  };
  use windows_capture::capture::{Context, GraphicsCaptureApiHandler};
  use windows_capture::frame::Frame;
  use windows_capture::graphics_capture_api::InternalCaptureControl;
  use windows_capture::settings::{
    ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings,
    MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings,
  };
  use windows_capture::window::Window;

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
    fn new(settings: &ProbeSettings) -> Result<Self, windows62::core::Error> {
      unsafe { MFStartup(MF_VERSION, MFSTARTUP_FULL)? };
      let wide_path = settings
        .output
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
      let writer = unsafe {
        MFCreateSinkWriterFromURL(
          PCWSTR(wide_path.as_ptr()),
          Option::<&IMFByteStream>::None,
          Option::<&IMFAttributes>::None,
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
          (u64::from(settings.width) << 32) | u64::from(settings.height),
        )?;
        output.SetUINT64(&MF_MT_FRAME_RATE, u64::from(settings.fps) << 32 | 1)?;
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
          (u64::from(settings.width) << 32) | u64::from(settings.height),
        )?;
        input.SetUINT64(&MF_MT_FRAME_RATE, u64::from(settings.fps) << 32 | 1)?;
        input.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, 1_u64 << 32 | 1)?;
        writer.SetInputMediaType(stream, &input, Option::<&IMFAttributes>::None)?;
        writer.BeginWriting()?;
      }
      Ok(Self {
        writer,
        stream,
        width: settings.width,
        height: settings.height,
        frame_duration: 10_000_000 / i64::from(settings.fps),
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

    // Inset the WGC frame to prove a real source crop rather than a same-size copy.
    let inset = 8_u32
      .min(source_width.saturating_sub(2) / 2)
      .min(source_height.saturating_sub(2) / 2);
    let source_rect = RECT {
      left: inset as i32,
      top: inset as i32,
      right: (source_width - inset) as i32,
      bottom: (source_height - inset) as i32,
    };
    let destination = aspect_fit(
      source_width - inset * 2,
      source_height - inset * 2,
      output_width,
      output_height,
    );
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
      let encoder = MediaFoundationEncoder::new(&settings)?;
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
      composite_frame(frame, encoder.width, encoder.height, &mut self.scratch)?;
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
}

#[cfg(target_os = "windows")]
fn main() -> Result<(), Box<dyn std::error::Error>> {
  windows_probe::run()
}

#[cfg(not(target_os = "windows"))]
fn main() {
  eprintln!("visual capture probe is Windows-only");
  std::process::exit(2);
}
