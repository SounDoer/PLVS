//! Files for the MCP adapter. The chat agent sees only the conversation while this server runs on
//! the user's machine, so documents may be read from local files, audio paths must be absolute,
//! explicit exports create a new local file and return its path.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use rmcp::model::JsonObject;
use serde_json::Value;

use crate::cli_control::stream_staged_artifact;
use crate::cli_manifest::CommandEntry;

/// Mirrors what a user could reasonably hand the CLI as one JSON document.
const MAX_INPUT_DOCUMENT_BYTES: u64 = 16 * 1024 * 1024;

pub(super) const DOWNLOADS: &str = "downloads";

pub(super) fn home_dir() -> Result<PathBuf, String> {
  dirs::home_dir().ok_or_else(|| "The home folder is unavailable.".to_string())
}

/// Expands a leading `~` and requires an absolute result: a chat has no working directory, so a
/// relative path would silently resolve against wherever the chat app happened to start us.
pub(super) fn absolute_path(raw: &str, home: &Path) -> Result<PathBuf, String> {
  let trimmed = raw.trim();
  let expanded = if trimmed == "~" {
    home.to_path_buf()
  } else if let Some(rest) = trimmed
    .strip_prefix("~/")
    .or_else(|| trimmed.strip_prefix("~\\"))
  {
    home.join(rest)
  } else {
    PathBuf::from(trimmed)
  };
  if trimmed.is_empty() || !expanded.is_absolute() {
    return Err(format!(
      "`{raw}` is not an absolute path. Give the full path, for example ~/Music/mix.wav."
    ));
  }
  Ok(expanded)
}

/// The wire fields a command accepts as a JSON document, which the CLI reads from `file|-`.
pub(super) fn document_fields(entry: &CommandEntry) -> Vec<&str> {
  entry
    .positionals
    .iter()
    .filter(|argument| matches!(argument.name.as_str(), "file|-" | "file"))
    .filter_map(|argument| argument.maps_to.as_deref())
    .collect()
}

fn read_document(path: &Path) -> Result<Value, String> {
  let display = path.display();
  let size = fs::metadata(path)
    .map_err(|error| format!("Unable to read {display}: {error}"))?
    .len();
  if size > MAX_INPUT_DOCUMENT_BYTES {
    return Err(format!(
      "{display} exceeds the {MAX_INPUT_DOCUMENT_BYTES}-byte document limit."
    ));
  }
  let bytes = fs::read(path).map_err(|error| format!("Unable to read {display}: {error}"))?;
  let bytes = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(&bytes);
  serde_json::from_slice(bytes)
    .map_err(|error| format!("Unable to parse {display} as JSON: {error}"))
}

/// Fills document fields named in the tool's `files` argument from local JSON files.
pub(super) fn apply_files(
  entry: &CommandEntry,
  arguments: &JsonObject,
  params: &mut Value,
  home: &Path,
) -> Result<(), String> {
  let Some(files) = arguments.get("files") else {
    return Ok(());
  };
  let files = files
    .as_object()
    .ok_or_else(|| "`files` must map a parameter name to an absolute file path.".to_string())?;
  let allowed = document_fields(entry);
  for (field, raw_path) in files {
    if !allowed.contains(&field.as_str()) {
      return Err(if allowed.is_empty() {
        format!("`{}` takes no parameter from a file.", entry.id)
      } else {
        format!(
          "`{field}` cannot be read from a file for `{}`; use one of: {}.",
          entry.id,
          allowed.join(", ")
        )
      });
    }
    if params.get(field).is_some() {
      return Err(format!(
        "Give `{field}` either in `params` or in `files`, not both."
      ));
    }
    let raw_path = raw_path
      .as_str()
      .ok_or_else(|| format!("`files.{field}` must be a path string."))?;
    let document = read_document(&absolute_path(raw_path, home)?)?;
    params[field.as_str()] = document;
  }
  Ok(())
}

/// Makes File Mode audio paths absolute, as the CLI does, without a working directory to resolve
/// a relative one against.
pub(super) fn normalize_audio_paths(
  entry: &CommandEntry,
  params: &mut Value,
  home: &Path,
) -> Result<(), String> {
  match entry.id.as_str() {
    "transport.file.analyze" => {
      if let Some(raw) = params.get("path").and_then(Value::as_str) {
        let path = absolute_path(raw, home)?;
        let canonical = fs::canonicalize(&path)
          .map_err(|error| format!("Unable to resolve audio path {}: {error}", path.display()))?;
        params["path"] = Value::String(canonical.to_string_lossy().into_owned());
      }
    }
    "transport.file.batch.enqueue" => {
      if let Some(paths) = params.get("paths").and_then(Value::as_array) {
        let resolved = paths
          .iter()
          .map(|path| {
            let raw = path
              .as_str()
              .ok_or_else(|| "Every entry in `paths` must be a path string.".to_string())?;
            Ok(Value::String(
              absolute_path(raw, home)?.to_string_lossy().into_owned(),
            ))
          })
          .collect::<Result<Vec<_>, String>>()?;
        params["paths"] = Value::Array(resolved);
      }
    }
    _ => {}
  }
  Ok(())
}

/// The app queries that can be saved by the MCP export tool.
pub(super) const EXPORT_COMMANDS: [&str; 7] = [
  "preset.export",
  "theme.export",
  "loudnessProfile.export",
  "config.export",
  "transport.file.report",
  "transport.file.exportStatistics",
  "visual.recording.inspect",
];

pub(super) const RECORDING_EXPORT: &str = "visual.recording.inspect";

/// Where one command's output document lives in the result and how it is saved.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct OutputSpec {
  field: &'static str,
  raw: bool,
  name: &'static str,
  extension: &'static str,
}

fn output_spec(id: &str, result: &serde_json::Map<String, Value>) -> Option<OutputSpec> {
  let spec = |field, raw, name, extension| OutputSpec {
    field,
    raw,
    name,
    extension,
  };
  match id {
    "preset.export" => Some(spec("pack", false, "PLVS Presets", "plvspreset")),
    "theme.export" => Some(spec("pack", false, "PLVS Themes", "plvstheme")),
    "loudnessProfile.export" => Some(spec(
      "pack",
      false,
      "PLVS Loudness Profiles",
      "plvsloudness",
    )),
    "config.export" => Some(spec(
      "configuration",
      false,
      "PLVS Configuration",
      "plvsconfig",
    )),
    "transport.file.report" if result.contains_key("markdown") => {
      Some(spec("markdown", true, "PLVS File Report", "md"))
    }
    "transport.file.report" => Some(spec("report", false, "PLVS File Report", "json")),
    "transport.file.exportStatistics" => Some(spec("csv", true, "PLVS File Statistics", "csv")),
    _ => None,
  }
}

struct Destination {
  directory: PathBuf,
  filename: Option<std::ffi::OsString>,
}

fn destination(raw: Option<&str>, home: &Path, downloads: &Path) -> Result<Destination, String> {
  let target = match raw {
    None | Some(DOWNLOADS) => downloads.to_path_buf(),
    Some(raw) => absolute_path(raw, home)?,
  };

  let (directory, filename) = if raw.is_none() || raw == Some(DOWNLOADS) || target.is_dir() {
    (target.as_path(), None)
  } else {
    let filename = target
      .file_name()
      .ok_or("The export path must name a file or folder.")?;
    #[cfg(windows)]
    if filename.to_string_lossy().contains(':') {
      return Err(
        "The export path must name a file, not a Windows alternate data stream.".to_string(),
      );
    }
    (
      target
        .parent()
        .ok_or("The export path has no parent folder.")?,
      Some(filename.to_os_string()),
    )
  };

  let directory = directory.canonicalize().map_err(|error| {
    format!(
      "Unable to resolve export folder {}: {error}",
      directory.display()
    )
  })?;
  let allowed = [home, downloads].iter().any(|root| {
    root
      .canonicalize()
      .is_ok_and(|root| directory.starts_with(root))
  });
  if !allowed {
    return Err("Choose an export location in your home or Downloads folder.".to_string());
  }
  Ok(Destination {
    directory,
    filename,
  })
}

/// Writes to a temporary file in the destination folder and publishes it without replacing any
/// existing entry. Folder destinations get the first available numbered filename.
fn save_new(
  raw: Option<&str>,
  home: &Path,
  downloads: &Path,
  name: &str,
  extension: &str,
  write: impl FnOnce(&mut fs::File) -> Result<(), String>,
) -> Result<PathBuf, String> {
  let target = destination(raw, home, downloads)?;
  let mut staged = tempfile::NamedTempFile::new_in(&target.directory).map_err(|error| {
    format!(
      "Unable to create an export in {}: {error}",
      target.directory.display()
    )
  })?;
  write(staged.as_file_mut())?;
  staged
    .as_file()
    .sync_all()
    .map_err(|error| format!("Unable to flush export: {error}"))?;

  for index in 1.. {
    let path = match &target.filename {
      Some(filename) => target.directory.join(filename),
      None if index == 1 => target.directory.join(format!("{name}.{extension}")),
      None => target
        .directory
        .join(format!("{name} ({index}).{extension}")),
    };
    match staged.persist_noclobber(&path) {
      Ok(_) => return Ok(path),
      Err(error)
        if error.error.kind() == io::ErrorKind::AlreadyExists && target.filename.is_none() =>
      {
        staged = error.file;
      }
      Err(error) => {
        return Err(format!(
          "Unable to create {}: {}",
          path.display(),
          error.error
        ))
      }
    }
  }
  unreachable!("the filename sequence is unbounded")
}

/// Saves a result obtained from the app. User input supplies the destination only.
pub(super) fn save_output(
  id: &str,
  report: &mut Value,
  raw: Option<&str>,
  home: &Path,
  downloads: &Path,
) -> Result<(), String> {
  let result = report
    .get_mut("result")
    .and_then(Value::as_object_mut)
    .ok_or("PLVS returned no export result.")?;
  if id == RECORDING_EXPORT {
    let artifact = result.get_mut("recording").and_then(|recording| recording.get_mut("artifact"))
      .and_then(Value::as_object_mut)
      .ok_or("This recording has no completed video to export. Wait for it to complete and check its state.")?;
    let path = save_new(raw, home, downloads, "PLVS Recording", "mp4", |file| {
      stream_staged_artifact(
        artifact,
        "recording",
        "video/mp4",
        || Ok(file),
        |error| format!("Unable to write the recording: {error}"),
      )
      .map(|_| ())
    })?;
    artifact.remove("stagedPath");
    artifact.insert(
      "out".to_string(),
      Value::String(path.to_string_lossy().into_owned()),
    );
    return Ok(());
  }

  let spec = output_spec(id, result).ok_or("This command has no document to export.")?;
  let document = result
    .get(spec.field)
    .ok_or("PLVS returned no document to export.")?;
  let output = if spec.raw {
    document
      .as_str()
      .ok_or_else(|| format!("Expected `{}` to be text.", spec.field))?
      .to_owned()
  } else {
    format!(
      "{}\n",
      serde_json::to_string_pretty(document).map_err(|error| error.to_string())?
    )
  };
  let path = save_new(raw, home, downloads, spec.name, spec.extension, |file| {
    file
      .write_all(output.as_bytes())
      .map_err(|error| format!("Unable to write the export: {error}"))
  })?;
  result.remove(spec.field);
  result.insert(
    "out".to_string(),
    Value::String(path.to_string_lossy().into_owned()),
  );
  Ok(())
}

/// Internal staging is an app implementation detail. An export looks it up by recording ID.
pub(super) fn hide_recording_path(report: &mut Value) {
  if let Some(artifact) = report
    .pointer_mut("/result/recording/artifact")
    .and_then(Value::as_object_mut)
  {
    artifact.remove("stagedPath");
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::cli_manifest::command_by_id;
  use serde_json::json;

  #[cfg(windows)]
  const TEST_HOME: &str = r"C:\Users\someone";
  #[cfg(not(windows))]
  const TEST_HOME: &str = "/home/someone";

  fn scratch(name: &str) -> PathBuf {
    let directory =
      std::env::temp_dir().join(format!("plvs-mcp-files-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&directory);
    fs::create_dir_all(&directory).unwrap();
    directory
  }

  #[test]
  fn paths_expand_home_and_must_be_absolute() {
    let home = Path::new(TEST_HOME);
    assert_eq!(
      absolute_path("~/Music/mix.wav", home).unwrap(),
      home.join("Music/mix.wav")
    );
    assert_eq!(
      absolute_path(r"~\mix.wav", home).unwrap(),
      home.join("mix.wav")
    );
    assert_eq!(absolute_path("~", home).unwrap(), home);
    assert!(absolute_path("mix.wav", home).is_err());
    assert!(absolute_path("./mix.wav", home).is_err());
    assert!(absolute_path("  ", home).is_err());
  }

  #[test]
  fn document_fields_come_from_the_manifest() {
    assert_eq!(
      document_fields(command_by_id("theme.import").unwrap()),
      ["pack"]
    );
    assert_eq!(
      document_fields(command_by_id("config.import").unwrap()),
      ["configuration"]
    );
    assert_eq!(
      document_fields(command_by_id("panel.update").unwrap()),
      ["patch"]
    );
    assert!(document_fields(command_by_id("loudnessProfile.select").unwrap()).is_empty());
  }

  #[test]
  fn files_fill_document_fields_and_refuse_ambiguity() {
    let directory = scratch("apply");
    let pack = directory.join("themes.plvstheme");
    fs::write(&pack, b"\xef\xbb\xbf{\"themes\":[]}").unwrap();
    let entry = command_by_id("theme.import").unwrap();
    let mut arguments = JsonObject::new();
    arguments.insert("files".into(), json!({ "pack": pack.to_string_lossy() }));

    let mut params = json!({ "expectedRevision": 4 });
    apply_files(entry, &arguments, &mut params, &directory).unwrap();
    assert_eq!(params["pack"], json!({ "themes": [] }));

    let mut both = json!({ "pack": {}, "expectedRevision": 4 });
    assert!(apply_files(entry, &arguments, &mut both, &directory).is_err());

    let mut wrong = JsonObject::new();
    wrong.insert(
      "files".into(),
      json!({ "document": pack.to_string_lossy() }),
    );
    let error = apply_files(entry, &wrong, &mut json!({}), &directory).unwrap_err();
    assert!(error.contains("pack"), "{error}");

    let mut relative = JsonObject::new();
    relative.insert("files".into(), json!({ "pack": "themes.plvstheme" }));
    assert!(apply_files(entry, &relative, &mut json!({}), &directory).is_err());
  }

  #[test]
  fn batch_paths_become_absolute_and_relative_ones_are_refused() {
    let home = Path::new(TEST_HOME);
    let entry = command_by_id("transport.file.batch.enqueue").unwrap();
    let absolute = home.join("b.wav");
    let mut params = json!({ "paths": ["~/a.wav", absolute] });
    normalize_audio_paths(entry, &mut params, home).unwrap();
    assert_eq!(params["paths"], json!([home.join("a.wav"), absolute]));
    let mut relative = json!({ "paths": ["a.wav"] });
    assert!(normalize_audio_paths(entry, &mut relative, home).is_err());
  }

  #[test]
  fn exporting_creates_new_files_and_refuses_overwrites_and_outside_paths() {
    let home = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let downloads = home.path().join("Downloads");
    fs::create_dir(&downloads).unwrap();
    let report = json!({ "ok": true, "result": { "pack": { "themes": [] }, "revision": 3 } });
    let first = downloads.join("PLVS Themes.plvstheme");
    fs::write(&first, b"existing").unwrap();
    let target = first.to_str().unwrap();
    let mut failed = report.clone();
    assert!(save_output(
      "theme.export",
      &mut failed,
      Some(target),
      home.path(),
      &downloads
    )
    .is_err());
    assert_eq!(failed, report);
    assert_eq!(fs::read(&first).unwrap(), b"existing");

    let escaped = outside.path().join("theme.plvstheme");
    assert!(save_output(
      "theme.export",
      &mut failed,
      escaped.to_str(),
      home.path(),
      &downloads
    )
    .is_err());
    assert!(!escaped.exists());
    let mut exported = report;
    save_output("theme.export", &mut exported, None, home.path(), &downloads).unwrap();
    assert!(exported["result"].get("pack").is_none());
    assert_eq!(exported["result"]["revision"], 3);
    let second = downloads
      .join("PLVS Themes (2).plvstheme")
      .canonicalize()
      .unwrap();
    assert_eq!(
      std::path::Path::new(exported["result"]["out"].as_str().unwrap())
        .canonicalize()
        .unwrap(),
      second
    );
    assert_eq!(
      fs::read_to_string(second).unwrap(),
      "{\n  \"themes\": []\n}\n"
    );
  }

  #[test]
  fn recording_results_hide_staging_and_export_only_verified_bytes() {
    let home = tempfile::tempdir().unwrap();
    let downloads = home.path().join("Downloads");
    fs::create_dir(&downloads).unwrap();
    let video = home.path().join("staged.mp4");
    fs::write(&video, b"abc").unwrap();
    let mut report = json!({ "ok": true, "result": { "recording": {
      "recordingId": "rec-1", "state": "completed", "artifact": {
        "kind": "recording", "mediaType": "video/mp4", "bytes": 3, "stagedPath": video,
        "sha256": "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
      }
    } } });
    let mut observed = report.clone();
    hide_recording_path(&mut observed);
    assert_eq!(observed["result"]["recording"]["state"], "completed");
    assert!(observed
      .pointer("/result/recording/artifact/stagedPath")
      .is_none());
    assert_eq!(fs::read_dir(&downloads).unwrap().count(), 0);

    let mut corrupted = report.clone();
    corrupted["result"]["recording"]["artifact"]["sha256"] = json!("0".repeat(64));
    assert!(save_output(
      RECORDING_EXPORT,
      &mut corrupted,
      None,
      home.path(),
      &downloads
    )
    .is_err());
    assert_eq!(fs::read_dir(&downloads).unwrap().count(), 0);

    save_output(RECORDING_EXPORT, &mut report, None, home.path(), &downloads).unwrap();
    let artifact = &report["result"]["recording"]["artifact"];
    assert!(artifact.get("stagedPath").is_none());
    assert_eq!(fs::read(artifact["out"].as_str().unwrap()).unwrap(), b"abc");
    assert_eq!(fs::read(video).unwrap(), b"abc");
  }
}
