//! Linux visual recording encodes with the distribution FFmpeg, never the package-private sidecar.
//!
//! The sidecar under `/usr/lib/plvs*/sidecars` is built audio-only with GPL and nonfree code
//! disabled (ADR 0033), so it has no H.264 encoder. Recording instead probes `/usr/bin/ffmpeg`,
//! which Ubuntu builds with libx264 and AAC, and reports the result truthfully (ADR 0037). The
//! parsing is platform-neutral so it is tested on every host; only Linux calls [`probe`].

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Serialize;

use super::super::platform::{RecordingCapabilities, RecordingPermission};

/// The distribution FFmpeg on Debian and Ubuntu.
pub const SYSTEM_FFMPEG: &str = "/usr/bin/ffmpeg";
/// Absolute path of another FFmpeg executable to record with. A development and test override;
/// `PLVS_FFMPEG_DIR` names the decoder sidecar directory and deliberately does not apply here.
pub const RECORDING_FFMPEG_ENV: &str = "PLVS_RECORDING_FFMPEG";
pub const INSTALL_REMEDY: &str = "sudo apt install ffmpeg";
pub const UNAVAILABLE_REASON: &str = "recordingEncoderUnavailable";
pub const H264_ENCODER: &str = "libx264";
pub const AAC_ENCODER: &str = "aac";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EncoderProbe {
  pub path: PathBuf,
  pub h264: bool,
  pub aac: bool,
  /// Why the executable could not be listed at all, when it could not.
  pub error: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncoderUnavailable {
  pub reason: &'static str,
  pub message: String,
  pub details: EncoderUnavailableDetails,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncoderUnavailableDetails {
  pub encoder_path: String,
  pub missing_encoders: Vec<&'static str>,
  pub remedy: &'static str,
}

impl EncoderProbe {
  /// Why a recording with or without measured-source audio cannot start, or `None` when it can.
  pub fn unavailable(&self, with_audio: bool) -> Option<EncoderUnavailable> {
    let mut missing = Vec::new();
    if !self.h264 {
      missing.push(H264_ENCODER);
    }
    if with_audio && !self.aac {
      missing.push(AAC_ENCODER);
    }
    if missing.is_empty() {
      return None;
    }
    let found = match &self.error {
      Some(error) => format!("{} could not be used ({error})", self.path.display()),
      None => format!(
        "{} has no {} encoder",
        self.path.display(),
        missing.join(" or ")
      ),
    };
    Some(EncoderUnavailable {
      reason: UNAVAILABLE_REASON,
      message: format!(
        "Linux visual recording needs the distribution FFmpeg with the {} {}, but {found}. \
         Install it with `{INSTALL_REMEDY}`, then restart PLVS.",
        missing.join(" and "),
        if missing.len() == 1 {
          "encoder"
        } else {
          "encoders"
        }
      ),
      details: EncoderUnavailableDetails {
        encoder_path: self.path.display().to_string(),
        missing_encoders: missing,
        remedy: INSTALL_REMEDY,
      },
    })
  }
}

/// What Linux recording can do with the FFmpeg that `probe` found. Without H.264 nothing can be
/// recorded; without AAC only `--audio none` can.
pub fn linux_recording_capabilities(probe: &EncoderProbe) -> RecordingCapabilities {
  let unavailable = probe.unavailable(false);
  let available = unavailable.is_none();
  let mut audio_sources = Vec::new();
  if available {
    audio_sources.push("none");
    if probe.aac {
      audio_sources.push("measuredSource");
    }
  }
  RecordingCapabilities {
    available,
    permission: RecordingPermission::Granted,
    targets: if available {
      vec!["main", "workspace"]
    } else {
      Vec::new()
    },
    audio_sources,
    cursor_modes: if available { vec!["none"] } else { Vec::new() },
    unavailable,
  }
}

pub fn recording_ffmpeg_path(override_path: Option<&str>) -> PathBuf {
  override_path
    .filter(|value| !value.is_empty())
    .map_or_else(|| PathBuf::from(SYSTEM_FFMPEG), PathBuf::from)
}

/// Whether `ffmpeg -encoders` output lists the video H.264 and audio AAC encoders.
pub fn parse_encoders(listing: &str) -> (bool, bool) {
  let mut h264 = false;
  let mut aac = false;
  let rows = listing
    .lines()
    .skip_while(|line| !line.trim_start().starts_with("---"))
    .skip(1);
  for row in rows {
    let mut fields = row.split_whitespace();
    let (Some(flags), Some(name)) = (fields.next(), fields.next()) else {
      continue;
    };
    match (flags.chars().next(), name) {
      (Some('V'), H264_ENCODER) => h264 = true,
      (Some('A'), AAC_ENCODER) => aac = true,
      _ => {}
    }
  }
  (h264, aac)
}

pub fn probe_at(path: &Path) -> EncoderProbe {
  let failed = |error: String| EncoderProbe {
    path: path.to_path_buf(),
    h264: false,
    aac: false,
    error: Some(error),
  };
  if !path.is_absolute() {
    return failed(format!("{RECORDING_FFMPEG_ENV} must be an absolute path"));
  }
  if !path.exists() {
    return failed("it is not installed".to_owned());
  }
  match Command::new(path)
    .args(["-hide_banner", "-encoders"])
    .stdin(Stdio::null())
    .stderr(Stdio::null())
    .output()
  {
    Ok(output) if output.status.success() => {
      let (h264, aac) = parse_encoders(&String::from_utf8_lossy(&output.stdout));
      EncoderProbe {
        path: path.to_path_buf(),
        h264,
        aac,
        error: None,
      }
    }
    Ok(output) => failed(format!(
      "listing its encoders exited with {}",
      output.status
    )),
    Err(error) => failed(error.to_string()),
  }
}

/// Probe the FFmpeg this process would record with.
pub fn probe() -> EncoderProbe {
  let override_path = std::env::var(RECORDING_FFMPEG_ENV).ok();
  probe_at(&recording_ffmpeg_path(override_path.as_deref()))
}

#[cfg(test)]
mod tests {
  use super::*;

  const UBUNTU_LISTING: &str = "Encoders:
 V..... = Video
 A..... = Audio
 S..... = Subtitle
 .F.... = Frame-level multithreading
 ------
 V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)
 V....D libx264rgb           libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 RGB (codec h264)
 A....D aac                  AAC (Advanced Audio Coding)
 A....D pcm_f32le            PCM 32-bit floating point little-endian
";

  const SIDECAR_LISTING: &str = "Encoders:
 V..... = Video
 A..... = Audio
 ------
 A....D pcm_f32le            PCM 32-bit floating point little-endian
";

  fn probe_result(h264: bool, aac: bool) -> EncoderProbe {
    EncoderProbe {
      path: PathBuf::from(SYSTEM_FFMPEG),
      h264,
      aac,
      error: None,
    }
  }

  #[test]
  fn distribution_listing_has_both_encoders() {
    assert_eq!(parse_encoders(UBUNTU_LISTING), (true, true));
  }

  #[test]
  fn audio_only_sidecar_listing_has_neither_encoder() {
    assert_eq!(parse_encoders(SIDECAR_LISTING), (false, false));
  }

  #[test]
  fn legend_lines_and_similar_names_are_not_encoders() {
    let listing = "Encoders:
 V..... libx264 legend text before the separator
 ------
 V....D libx264rgb           RGB only
 A....D libfdk_aac           Fraunhofer AAC
 A....D libx264              wrong media type
 V....D aac                  wrong media type
";
    assert_eq!(parse_encoders(listing), (false, false));
  }

  #[test]
  fn complete_probe_allows_silent_and_audio_recording() {
    let probe = probe_result(true, true);
    assert_eq!(probe.unavailable(false), None);
    assert_eq!(probe.unavailable(true), None);
  }

  #[test]
  fn missing_h264_reports_the_install_remedy() {
    let unavailable = probe_result(false, true).unavailable(false).unwrap();
    assert_eq!(unavailable.reason, "recordingEncoderUnavailable");
    assert_eq!(unavailable.details.missing_encoders, vec!["libx264"]);
    assert_eq!(unavailable.details.remedy, "sudo apt install ffmpeg");
    assert_eq!(unavailable.details.encoder_path, "/usr/bin/ffmpeg");
    assert!(unavailable.message.contains("sudo apt install ffmpeg"));
    assert!(unavailable.message.contains("libx264"));
  }

  #[test]
  fn missing_aac_blocks_only_audio_recording() {
    let probe = probe_result(true, false);
    assert_eq!(probe.unavailable(false), None);
    assert_eq!(
      probe.unavailable(true).unwrap().details.missing_encoders,
      vec!["aac"]
    );
  }

  #[test]
  fn capabilities_advertise_every_option_with_a_complete_encoder() {
    let capabilities = linux_recording_capabilities(&probe_result(true, true));
    assert!(capabilities.available);
    assert_eq!(capabilities.permission, RecordingPermission::Granted);
    assert_eq!(capabilities.targets, vec!["main", "workspace"]);
    assert_eq!(capabilities.audio_sources, vec!["none", "measuredSource"]);
    assert_eq!(capabilities.cursor_modes, vec!["none"]);
    assert_eq!(capabilities.unavailable, None);
  }

  #[test]
  fn capabilities_without_h264_are_unavailable_with_reason_and_remedy() {
    let capabilities = linux_recording_capabilities(&probe_result(false, true));
    assert!(!capabilities.available);
    assert!(capabilities.targets.is_empty());
    assert!(capabilities.audio_sources.is_empty());
    assert!(capabilities.cursor_modes.is_empty());
    let value = serde_json::to_value(&capabilities).unwrap();
    assert_eq!(
      value["unavailable"]["reason"],
      "recordingEncoderUnavailable"
    );
    assert_eq!(
      value["unavailable"]["details"]["remedy"],
      "sudo apt install ffmpeg"
    );
    assert_eq!(
      value["unavailable"]["details"]["missingEncoders"],
      serde_json::json!(["libx264"])
    );
  }

  #[test]
  fn capabilities_without_aac_offer_only_silent_recording() {
    let capabilities = linux_recording_capabilities(&probe_result(true, false));
    assert!(capabilities.available);
    assert_eq!(capabilities.audio_sources, vec!["none"]);
    assert_eq!(capabilities.unavailable, None);
  }

  #[test]
  fn absent_executable_is_unavailable_with_its_cause() {
    let path = std::env::temp_dir()
      .join("plvs-no-such-ffmpeg")
      .join("ffmpeg");
    let probe = probe_at(&path);
    assert!(!probe.h264 && !probe.aac);
    let unavailable = probe.unavailable(false).unwrap();
    assert!(unavailable.message.contains("is not installed"));
    assert_eq!(
      unavailable.details.missing_encoders,
      vec!["libx264"],
      "an absent executable cannot provide H.264"
    );
  }

  #[test]
  fn relative_override_is_refused() {
    let probe = probe_at(Path::new("ffmpeg"));
    assert!(probe.error.unwrap().contains("absolute"));
  }

  #[test]
  fn override_replaces_the_distribution_path_and_empty_is_ignored() {
    assert_eq!(
      recording_ffmpeg_path(None),
      PathBuf::from("/usr/bin/ffmpeg")
    );
    assert_eq!(
      recording_ffmpeg_path(Some("")),
      PathBuf::from("/usr/bin/ffmpeg")
    );
    assert_eq!(
      recording_ffmpeg_path(Some("/opt/ffmpeg/bin/ffmpeg")),
      PathBuf::from("/opt/ffmpeg/bin/ffmpeg")
    );
  }
}
