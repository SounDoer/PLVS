use std::path::Path;
use std::sync::mpsc;
use std::time::Duration;

use cairo::{Format, ImageSurface};
use image::{imageops, ImageFormat, Rgba, RgbaImage};
use tauri::{AppHandle, Manager};
use webkit2gtk::{SnapshotOptions, SnapshotRegion, WebViewExt};

use super::platform::{
  calculate_pixel_crop, CaptureError, CaptureFuture, CapturedImage, CssRect, CssViewport,
  PlatformCapabilities, RecordingCapabilities, RecordingPermission, ScreenshotCapabilities,
  ScreenshotRequest, VisualCapturePlatform,
};

const SNAPSHOT_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug)]
pub(crate) struct RawFrame {
  pub width: u32,
  pub height: u32,
  pub stride: usize,
  pub pixels: Vec<u8>,
  pub has_alpha: bool,
}

pub struct LinuxPlatform;

impl VisualCapturePlatform for LinuxPlatform {
  fn capabilities(&self) -> PlatformCapabilities {
    PlatformCapabilities {
      platform: "linux".to_owned(),
      screenshot: ScreenshotCapabilities {
        available: true,
        targets: vec![
          "main",
          "workspace",
          "panel",
          "dockHeader",
          "dockEditor",
          "dockUpdate",
        ],
      },
      recording: RecordingCapabilities {
        available: true,
        permission: RecordingPermission::Granted,
        targets: vec!["main", "workspace"],
        audio_sources: vec!["none", "measuredSource"],
        cursor_modes: vec!["none"],
      },
    }
  }

  fn capture_screenshot<'a>(
    &'a self,
    app: &'a AppHandle,
    request: &'a ScreenshotRequest,
    output_path: &'a Path,
  ) -> CaptureFuture<'a> {
    let app = app.clone();
    let request = request.clone();
    let output_path = output_path.to_owned();
    Box::pin(async move {
      tauri::async_runtime::spawn_blocking(move || {
        let frame = capture_visible_frame(&app, &request.window_label)?;
        write_screenshot_png(&frame, request.viewport, request.rect, &output_path)
      })
      .await
      .map_err(|_| CaptureError::failed("The Linux screenshot worker failed."))?
    })
  }
}

pub(crate) fn capture_visible_frame(
  app: &AppHandle,
  window_label: &str,
) -> Result<RawFrame, CaptureError> {
  let window = app.get_webview_window(window_label).ok_or_else(|| {
    CaptureError::target_unavailable("The requested PLVS WebView does not exist.")
  })?;
  if !window
    .is_visible()
    .map_err(|_| CaptureError::failed("The requested PLVS WebView visibility is unavailable."))?
  {
    return Err(CaptureError::target_unavailable(
      "The requested PLVS WebView is not visible.",
    ));
  }

  let (sender, receiver) = mpsc::sync_channel(1);
  let callback_sender = sender.clone();
  window
    .with_webview(move |platform_webview| {
      platform_webview.inner().snapshot(
        SnapshotRegion::Visible,
        SnapshotOptions::TRANSPARENT_BACKGROUND,
        None::<&webkit2gtk::gio::Cancellable>,
        move |result| {
          let frame = result
            .map_err(|error| CaptureError::failed(format!("The WebKit snapshot failed: {error}")))
            .and_then(raw_frame_from_surface);
          let _ = callback_sender.send(frame);
        },
      );
    })
    .map_err(|_| CaptureError::failed("The WebView capture task could not be scheduled."))?;

  receiver
    .recv_timeout(SNAPSHOT_TIMEOUT)
    .map_err(|_| CaptureError::failed("The WebKit screenshot timed out."))?
}

fn raw_frame_from_surface(surface: cairo::Surface) -> Result<RawFrame, CaptureError> {
  let image = ImageSurface::try_from(surface)
    .map_err(|_| CaptureError::failed("The WebKit snapshot was not an image surface."))?;
  let width = u32::try_from(image.width())
    .map_err(|_| CaptureError::failed("The WebKit snapshot width is invalid."))?;
  let height = u32::try_from(image.height())
    .map_err(|_| CaptureError::failed("The WebKit snapshot height is invalid."))?;
  let stride = usize::try_from(image.stride())
    .map_err(|_| CaptureError::failed("The WebKit snapshot stride is invalid."))?;
  let has_alpha = match image.format() {
    Format::ARgb32 => true,
    Format::Rgb24 => false,
    _ => {
      return Err(CaptureError::failed(
        "The WebKit snapshot pixel format is unsupported.",
      ))
    }
  };
  if width == 0 || height == 0 || stride < width as usize * 4 {
    return Err(CaptureError::failed(
      "The WebKit snapshot geometry is empty or invalid.",
    ));
  }
  let mut pixels = Vec::new();
  image
    .with_data(|data| pixels.extend_from_slice(data))
    .map_err(|_| CaptureError::failed("The WebKit snapshot pixels are unavailable."))?;
  Ok(RawFrame {
    width,
    height,
    stride,
    pixels,
    has_alpha,
  })
}

pub(crate) fn cropped_rgba(
  frame: &RawFrame,
  viewport: CssViewport,
  rect: CssRect,
) -> Result<RgbaImage, CaptureError> {
  let crop = calculate_pixel_crop(frame.width, frame.height, viewport, rect)?;
  let mut output = RgbaImage::new(crop.width, crop.height);
  for y in 0..crop.height {
    for x in 0..crop.width {
      let source_x = crop.x + x;
      let source_y = crop.y + y;
      let offset = source_y as usize * frame.stride + source_x as usize * 4;
      let bytes = frame
        .pixels
        .get(offset..offset + 4)
        .ok_or_else(|| CaptureError::failed("The WebKit snapshot pixels are truncated."))?;
      #[cfg(target_endian = "little")]
      let (blue, green, red, stored_alpha) = (bytes[0], bytes[1], bytes[2], bytes[3]);
      #[cfg(target_endian = "big")]
      let (stored_alpha, red, green, blue) = (bytes[0], bytes[1], bytes[2], bytes[3]);
      let alpha = if frame.has_alpha { stored_alpha } else { 255 };
      let unpremultiply = |channel: u8| {
        if alpha == 0 {
          0
        } else if alpha == 255 || !frame.has_alpha {
          channel
        } else {
          ((u32::from(channel) * 255 + u32::from(alpha) / 2) / u32::from(alpha)).min(255) as u8
        }
      };
      output.put_pixel(
        x,
        y,
        Rgba([
          unpremultiply(red),
          unpremultiply(green),
          unpremultiply(blue),
          alpha,
        ]),
      );
    }
  }
  Ok(output)
}

pub(crate) fn recording_frame_rgba(
  frame: &RawFrame,
  viewport: CssViewport,
  rect: CssRect,
  output_width: u32,
  output_height: u32,
) -> Result<Vec<u8>, CaptureError> {
  let cropped = cropped_rgba(frame, viewport, rect)?;
  if cropped.width() == output_width && cropped.height() == output_height {
    return Ok(cropped.into_raw());
  }
  let scale = (f64::from(output_width) / f64::from(cropped.width()))
    .min(f64::from(output_height) / f64::from(cropped.height()));
  let fitted_width = (f64::from(cropped.width()) * scale)
    .round()
    .clamp(1.0, f64::from(output_width)) as u32;
  let fitted_height = (f64::from(cropped.height()) * scale)
    .round()
    .clamp(1.0, f64::from(output_height)) as u32;
  let resized = imageops::resize(
    &cropped,
    fitted_width,
    fitted_height,
    imageops::FilterType::Triangle,
  );
  let mut canvas = RgbaImage::from_pixel(output_width, output_height, Rgba([0, 0, 0, 255]));
  imageops::overlay(
    &mut canvas,
    &resized,
    i64::from((output_width - fitted_width) / 2),
    i64::from((output_height - fitted_height) / 2),
  );
  Ok(canvas.into_raw())
}

fn write_screenshot_png(
  frame: &RawFrame,
  viewport: CssViewport,
  rect: CssRect,
  output_path: &Path,
) -> Result<CapturedImage, CaptureError> {
  let image = cropped_rgba(frame, viewport, rect)?;
  let width = image.width();
  let height = image.height();
  image::save_buffer_with_format(
    output_path,
    image.as_raw(),
    width,
    height,
    image::ColorType::Rgba8,
    ImageFormat::Png,
  )
  .map_err(|error| CaptureError {
    reason: "artifactWriteFailed",
    message: format!("The Linux screenshot PNG could not be written: {error}"),
  })?;
  Ok(CapturedImage { width, height })
}

#[cfg(test)]
mod tests {
  use super::*;

  fn frame(width: u32, height: u32, pixels: Vec<u8>) -> RawFrame {
    RawFrame {
      width,
      height,
      stride: width as usize * 4,
      pixels,
      has_alpha: true,
    }
  }

  #[test]
  fn linux_capabilities_expose_only_implemented_recording_options() {
    let capabilities = LinuxPlatform.capabilities();
    assert!(capabilities.screenshot.available);
    assert!(capabilities.recording.available);
    assert_eq!(
      capabilities.recording.permission,
      RecordingPermission::Granted
    );
    assert_eq!(
      capabilities.recording.audio_sources,
      vec!["none", "measuredSource"]
    );
    assert_eq!(capabilities.recording.cursor_modes, vec!["none"]);
  }

  #[test]
  fn cairo_bgra_is_unpremultiplied_and_cropped() {
    let source = frame(
      2,
      1,
      vec![
        0, 0, 0, 0, // transparent
        32, 64, 128, 128, // premultiplied BGRA
      ],
    );
    let result = cropped_rgba(
      &source,
      CssViewport {
        width: 2.0,
        height: 1.0,
      },
      CssRect {
        x: 1.0,
        y: 0.0,
        width: 1.0,
        height: 1.0,
      },
    )
    .unwrap();
    assert_eq!(result.into_raw(), vec![255, 128, 64, 128]);
  }

  #[test]
  fn recording_resize_letterboxes_to_the_fixed_canvas() {
    let source = frame(2, 1, vec![0, 0, 255, 255, 0, 0, 255, 255]);
    let result = recording_frame_rgba(
      &source,
      CssViewport {
        width: 2.0,
        height: 1.0,
      },
      CssRect {
        x: 0.0,
        y: 0.0,
        width: 2.0,
        height: 1.0,
      },
      4,
      4,
    )
    .unwrap();
    assert_eq!(result.len(), 4 * 4 * 4);
    assert_eq!(&result[0..4], &[0, 0, 0, 255]);
    assert_eq!(&result[4 * 4..4 * 4 + 4], &[255, 0, 0, 255]);
  }
}
