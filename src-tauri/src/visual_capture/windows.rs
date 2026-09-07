use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use std::sync::mpsc;
use std::time::Duration;

use image::GenericImageView;
use tauri::{AppHandle, Manager};
use webview2_com::CapturePreviewCompletedHandler;
use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG;
use windows::core::PCWSTR;
use windows::Win32::System::Com::{STGC_DEFAULT, STGM_CREATE, STGM_READWRITE};
use windows::Win32::UI::Shell::SHCreateStreamOnFileEx;

use super::platform::{
  calculate_pixel_crop, CaptureError, CaptureFuture, CssRect, CssViewport, PlatformCapabilities,
  RecordingCapabilities, ScreenshotCapabilities, VisualCapturePlatform,
};

pub struct WindowsPlatform;

impl VisualCapturePlatform for WindowsPlatform {
  fn capabilities(&self) -> PlatformCapabilities {
    PlatformCapabilities {
      platform: "windows".to_owned(),
      screenshot: ScreenshotCapabilities {
        available: true,
        targets: vec!["main", "workspace", "panel", "dockHeader", "dockEditor"],
      },
      recording: RecordingCapabilities {
        available: true,
        targets: vec!["main", "workspace"],
        audio_sources: vec!["none", "measuredSource"],
      },
    }
  }

  fn capture_preview<'a>(
    &'a self,
    app: &'a AppHandle,
    window_label: &'a str,
    output_path: &'a Path,
  ) -> CaptureFuture<'a> {
    Box::pin(capture_webview_preview(app, window_label, output_path))
  }
}

async fn capture_webview_preview(
  app: &AppHandle,
  window_label: &str,
  output_path: &Path,
) -> Result<(), CaptureError> {
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

  let output_path = output_path.to_owned();
  let (sender, receiver) = mpsc::sync_channel(1);
  let callback_sender = sender.clone();
  window
    .with_webview(move |platform_webview| {
      let invoke = (|| -> Result<(), CaptureError> {
        let wide_path = output_path
          .as_os_str()
          .encode_wide()
          .chain(std::iter::once(0))
          .collect::<Vec<_>>();
        let stream = unsafe {
          SHCreateStreamOnFileEx(
            PCWSTR(wide_path.as_ptr()),
            STGM_CREATE.0 | STGM_READWRITE.0,
            0,
            true,
            None,
          )
        }
        .map_err(|error| {
          CaptureError::failed(format!("WebView preview stream creation failed: {error}"))
        })?;
        let webview = unsafe { platform_webview.controller().CoreWebView2() }.map_err(|error| {
          CaptureError::failed(format!("The WebView2 controller is unavailable: {error}"))
        })?;
        let completion_sender = callback_sender.clone();
        let completion_stream = stream.clone();
        let handler = CapturePreviewCompletedHandler::create(Box::new(move |result| {
          let outcome = result
            .map_err(|error| {
              CaptureError::failed(format!("WebView2 preview capture failed: {error}"))
            })
            .and_then(|_| {
              unsafe { completion_stream.Commit(STGC_DEFAULT) }.map_err(|error| {
                CaptureError::failed(format!("WebView preview stream commit failed: {error}"))
              })
            });
          drop(completion_stream);
          let _ = completion_sender.send(outcome);
          Ok(())
        }));
        unsafe {
          webview.CapturePreview(
            COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
            &stream,
            &handler,
          )
        }
        .map_err(|error| {
          CaptureError::failed(format!("WebView2 rejected the preview capture: {error}"))
        })?;
        Ok(())
      })();
      if let Err(error) = invoke {
        let _ = sender.send(Err(error));
      }
    })
    .map_err(|_| CaptureError::failed("The WebView capture task could not be scheduled."))?;

  tauri::async_runtime::spawn_blocking(move || receiver.recv_timeout(Duration::from_secs(3)))
    .await
    .map_err(|_| CaptureError::failed("The WebView preview wait failed."))?
    .map_err(|_| CaptureError::failed("The WebView preview timed out."))?
}

pub fn crop_preview_png(
  path: &Path,
  viewport: CssViewport,
  rect: CssRect,
) -> Result<(u32, u32), CaptureError> {
  // Staged artifact names deliberately end in `.png.tmp`, so decoding must use the known capture
  // format instead of asking `image` to infer a format from the final extension.
  let mut reader = image::ImageReader::open(path).map_err(|error| {
    CaptureError::failed(format!(
      "The WebView preview PNG could not be decoded: {error}"
    ))
  })?;
  reader.set_format(image::ImageFormat::Png);
  let image = reader.decode().map_err(|error| {
    CaptureError::failed(format!(
      "The WebView preview PNG could not be decoded: {error}"
    ))
  })?;
  let (image_width, image_height) = image.dimensions();
  let crop = calculate_pixel_crop(image_width, image_height, viewport, rect)?;
  let cropped = image.crop_imm(crop.x, crop.y, crop.width, crop.height);
  cropped
    .save_with_format(path, image::ImageFormat::Png)
    .map_err(|_| CaptureError::failed("The cropped PNG could not be encoded."))?;
  Ok((crop.width, crop.height))
}

#[cfg(test)]
mod tests {
  use super::*;
  use image::{Rgba, RgbaImage};

  struct TestFile(std::path::PathBuf);

  impl TestFile {
    fn png() -> Self {
      let mut random = [0_u8; 8];
      getrandom::fill(&mut random).unwrap();
      Self(std::env::temp_dir().join(format!(
        "plvs-crop-{}.png.tmp",
        random
          .iter()
          .map(|byte| format!("{byte:02x}"))
          .collect::<String>()
      )))
    }
  }

  impl Drop for TestFile {
    fn drop(&mut self) {
      let _ = std::fs::remove_file(&self.0);
    }
  }

  #[test]
  fn png_crop_preserves_exact_rgba_pixels_including_transparency() {
    let file = TestFile::png();
    let mut source = RgbaImage::new(4, 3);
    source.put_pixel(1, 1, Rgba([10, 20, 30, 0]));
    source.put_pixel(2, 1, Rgba([40, 50, 60, 128]));
    source
      .save_with_format(&file.0, image::ImageFormat::Png)
      .unwrap();

    assert_eq!(
      crop_preview_png(
        &file.0,
        CssViewport {
          width: 4.0,
          height: 3.0,
        },
        CssRect {
          x: 1.0,
          y: 1.0,
          width: 2.0,
          height: 1.0,
        },
      )
      .unwrap(),
      (2, 1)
    );
    let output = image::load_from_memory_with_format(
      &std::fs::read(&file.0).unwrap(),
      image::ImageFormat::Png,
    )
    .unwrap()
    .to_rgba8();
    assert_eq!(output.dimensions(), (2, 1));
    assert_eq!(*output.get_pixel(0, 0), Rgba([10, 20, 30, 0]));
    assert_eq!(*output.get_pixel(1, 0), Rgba([40, 50, 60, 128]));
  }
}
