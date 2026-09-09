use std::future::Future;
use std::path::Path;
use std::pin::Pin;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformCapabilities {
  pub platform: String,
  pub screenshot: ScreenshotCapabilities,
  pub recording: RecordingCapabilities,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotCapabilities {
  pub available: bool,
  pub targets: Vec<&'static str>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingCapabilities {
  pub available: bool,
  pub targets: Vec<&'static str>,
  pub audio_sources: Vec<&'static str>,
  pub cursor_modes: Vec<&'static str>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CssRect {
  pub x: f64,
  pub y: f64,
  pub width: f64,
  pub height: f64,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CssViewport {
  pub width: f64,
  pub height: f64,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotRequest {
  pub window_label: String,
  pub rect: CssRect,
  pub viewport: CssViewport,
  pub device_pixel_ratio: f64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PixelCrop {
  pub x: u32,
  pub y: u32,
  pub width: u32,
  pub height: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CapturedImage {
  pub width: u32,
  pub height: u32,
}

#[derive(Debug)]
pub struct CaptureError {
  pub reason: &'static str,
  pub message: String,
}

impl CaptureError {
  pub fn unavailable(message: impl Into<String>) -> Self {
    Self {
      reason: "visualUnavailable",
      message: message.into(),
    }
  }

  pub fn failed(message: impl Into<String>) -> Self {
    Self {
      reason: "captureFailed",
      message: message.into(),
    }
  }

  pub fn target_unavailable(message: impl Into<String>) -> Self {
    Self {
      reason: "targetUnavailable",
      message: message.into(),
    }
  }
}

impl std::fmt::Display for CaptureError {
  fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    write!(formatter, "{}: {}", self.reason, self.message)
  }
}

impl std::error::Error for CaptureError {}

pub type CaptureFuture<'a> =
  Pin<Box<dyn Future<Output = Result<CapturedImage, CaptureError>> + Send + 'a>>;

pub trait VisualCapturePlatform: Send + Sync {
  fn capabilities(&self) -> PlatformCapabilities;

  fn capture_screenshot<'a>(
    &'a self,
    app: &'a AppHandle,
    request: &'a ScreenshotRequest,
    output_path: &'a Path,
  ) -> CaptureFuture<'a>;
}

pub struct UnsupportedPlatform;

impl VisualCapturePlatform for UnsupportedPlatform {
  fn capabilities(&self) -> PlatformCapabilities {
    PlatformCapabilities {
      platform: std::env::consts::OS.to_owned(),
      screenshot: ScreenshotCapabilities {
        available: false,
        targets: Vec::new(),
      },
      recording: RecordingCapabilities {
        available: false,
        targets: Vec::new(),
        audio_sources: Vec::new(),
        cursor_modes: Vec::new(),
      },
    }
  }

  fn capture_screenshot<'a>(
    &'a self,
    _app: &'a AppHandle,
    _request: &'a ScreenshotRequest,
    _output_path: &'a Path,
  ) -> CaptureFuture<'a> {
    Box::pin(async {
      Err(CaptureError::unavailable(
        "Visual capture is unavailable on this platform.",
      ))
    })
  }
}

pub fn calculate_pixel_crop(
  image_width: u32,
  image_height: u32,
  viewport: CssViewport,
  rect: CssRect,
) -> Result<PixelCrop, CaptureError> {
  let values = [
    viewport.width,
    viewport.height,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
  ];
  if values.iter().any(|value| !value.is_finite())
    || image_width == 0
    || image_height == 0
    || viewport.width <= 0.0
    || viewport.height <= 0.0
    || rect.width <= 0.0
    || rect.height <= 0.0
  {
    return Err(CaptureError::failed(
      "Capture geometry is empty or invalid.",
    ));
  }

  let scale_x = f64::from(image_width) / viewport.width;
  let scale_y = f64::from(image_height) / viewport.height;
  let left = (rect.x * scale_x)
    .floor()
    .clamp(0.0, f64::from(image_width));
  let top = (rect.y * scale_y)
    .floor()
    .clamp(0.0, f64::from(image_height));
  let right = ((rect.x + rect.width) * scale_x)
    .ceil()
    .clamp(0.0, f64::from(image_width));
  let bottom = ((rect.y + rect.height) * scale_y)
    .ceil()
    .clamp(0.0, f64::from(image_height));
  if right <= left || bottom <= top {
    return Err(CaptureError::failed(
      "Capture geometry does not intersect the WebView preview.",
    ));
  }
  Ok(PixelCrop {
    x: left as u32,
    y: top as u32,
    width: (right - left) as u32,
    height: (bottom - top) as u32,
  })
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn crop_uses_independent_actual_bitmap_scales() {
    let crop = calculate_pixel_crop(
      1500,
      2400,
      CssViewport {
        width: 1000.0,
        height: 1200.0,
      },
      CssRect {
        x: 100.0,
        y: 50.0,
        width: 300.0,
        height: 200.0,
      },
    )
    .unwrap();
    assert_eq!(
      crop,
      PixelCrop {
        x: 150,
        y: 100,
        width: 450,
        height: 400
      }
    );
  }

  #[test]
  fn crop_rounds_outward_and_clamps_one_pixel_edges() {
    assert_eq!(
      calculate_pixel_crop(
        125,
        125,
        CssViewport {
          width: 100.0,
          height: 100.0,
        },
        CssRect {
          x: 99.0,
          y: 99.0,
          width: 1.0,
          height: 1.0,
        },
      )
      .unwrap(),
      PixelCrop {
        x: 123,
        y: 123,
        width: 2,
        height: 2,
      }
    );
    assert_eq!(
      calculate_pixel_crop(
        100,
        100,
        CssViewport {
          width: 100.0,
          height: 100.0,
        },
        CssRect {
          x: -10.0,
          y: -10.0,
          width: 11.0,
          height: 11.0,
        },
      )
      .unwrap(),
      PixelCrop {
        x: 0,
        y: 0,
        width: 1,
        height: 1,
      }
    );
  }

  #[test]
  fn crop_rejects_empty_non_finite_and_non_intersecting_geometry() {
    for rect in [
      CssRect {
        x: 0.0,
        y: 0.0,
        width: 0.0,
        height: 1.0,
      },
      CssRect {
        x: f64::NAN,
        y: 0.0,
        width: 1.0,
        height: 1.0,
      },
      CssRect {
        x: 200.0,
        y: 200.0,
        width: 10.0,
        height: 10.0,
      },
    ] {
      assert!(calculate_pixel_crop(
        100,
        100,
        CssViewport {
          width: 100.0,
          height: 100.0,
        },
        rect,
      )
      .is_err());
    }
  }

  #[test]
  fn unsupported_platform_is_explicit() {
    let capabilities = UnsupportedPlatform.capabilities();
    assert!(!capabilities.screenshot.available);
    assert!(!capabilities.recording.available);
  }
}
