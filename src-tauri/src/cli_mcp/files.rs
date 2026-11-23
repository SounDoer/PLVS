//! Files for the MCP adapter. The chat agent sees only the conversation while this server runs on
//! the user's machine, so documents may be read from local files, audio paths must be absolute,
//! text outputs come back inline unless the agent asks to save them, and CSV and recordings are
//! always saved locally with only the path returned.

use std::fs;
use std::path::{Path, PathBuf};

use rmcp::model::JsonObject;
use serde_json::Value;

use crate::cli_control::read_staged_artifact;
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

/// Where one command's output document lives in the result and how it is saved.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct OutputSpec {
  pub field: &'static str,
  /// Written as text rather than pretty JSON.
  pub raw: bool,
  pub name: &'static str,
  pub extension: &'static str,
  /// Saved even when the agent did not ask: content that does not belong in a chat.
  pub always: bool,
}

pub(super) fn output_spec(id: &str, result: &Value) -> Option<OutputSpec> {
  let spec = |field, raw, name, extension, always| OutputSpec {
    field,
    raw,
    name,
    extension,
    always,
  };
  match id {
    "preset.export" => Some(spec("pack", false, "PLVS Presets", "plvspreset", false)),
    "theme.export" => Some(spec("pack", false, "PLVS Themes", "plvstheme", false)),
    "loudnessProfile.export" => Some(spec(
      "pack",
      false,
      "PLVS Loudness Profiles",
      "plvsloudness",
      false,
    )),
    "config.export" => Some(spec(
      "configuration",
      false,
      "PLVS Configuration",
      "plvsconfig",
      false,
    )),
    "transport.file.report" if result.get("markdown").is_some() => {
      Some(spec("markdown", true, "PLVS File Report", "md", false))
    }
    "transport.file.report" => Some(spec("report", false, "PLVS File Report", "json", false)),
    "transport.file.exportStatistics" => {
      Some(spec("csv", true, "PLVS File Statistics", "csv", true))
    }
    _ => None,
  }
}

/// A name in `directory` that does not exist yet: `<name>.<ext>`, then `<name> (2).<ext>`, ...,
/// the way browsers name downloads.
pub(super) fn unique_file(directory: &Path, name: &str, extension: &str) -> PathBuf {
  let first = directory.join(format!("{name}.{extension}"));
  if !first.exists() {
    return first;
  }
  (2..)
    .map(|index| directory.join(format!("{name} ({index}).{extension}")))
    .find(|candidate| !candidate.exists())
    .expect("an unbounded range always yields a free name")
}

/// Resolves the tool's `saveTo` argument. `None` means "keep it in the chat".
pub(super) fn destination(
  save_to: Option<&str>,
  always: bool,
  name: &str,
  extension: &str,
  home: &Path,
) -> Result<Option<PathBuf>, String> {
  let directory_target = |directory: PathBuf| unique_file(&directory, name, extension);
  match save_to {
    None if !always => Ok(None),
    None | Some(DOWNLOADS) => {
      let downloads = dirs::download_dir().unwrap_or_else(|| home.join("Downloads"));
      Ok(Some(directory_target(downloads)))
    }
    Some(raw) => {
      let path = absolute_path(raw, home)?;
      Ok(Some(if path.is_dir() {
        directory_target(path)
      } else {
        path
      }))
    }
  }
}

/// Moves `result.<field>` into a file and leaves `result.out`, as the CLI's `--out` does.
pub(super) fn save_document(
  report: &mut Value,
  spec: OutputSpec,
  path: &Path,
) -> Result<(), String> {
  let Some(result) = report.get_mut("result").and_then(Value::as_object_mut) else {
    return Ok(());
  };
  let Some(document) = result.get(spec.field) else {
    return Ok(());
  };
  let contents = if spec.raw {
    document
      .as_str()
      .ok_or_else(|| format!("Expected `{}` to be text.", spec.field))?
      .to_string()
  } else {
    format!(
      "{}\n",
      serde_json::to_string_pretty(document).map_err(|error| error.to_string())?
    )
  };
  crate::profile::write_export(path, contents.as_bytes())
    .map_err(|error| format!("Unable to write {}: {error}", path.display()))?;
  result.remove(spec.field);
  result.insert(
    "out".to_string(),
    Value::String(path.to_string_lossy().into_owned()),
  );
  Ok(())
}

/// Copies a completed recording out of PLVS's staging area after the hash check.
pub(super) fn save_recording(report: &mut Value, path: &Path) -> Result<(), String> {
  let Some(artifact) = report.pointer("/result/recording/artifact").cloned() else {
    return Ok(());
  };
  if artifact.get("stagedPath").is_none() {
    return Ok(());
  }
  let bytes = read_staged_artifact(&artifact, "video/mp4")?;
  crate::profile::write_export(path, &bytes)
    .map_err(|error| format!("Unable to write {}: {error}", path.display()))?;
  if let Some(artifact) = report
    .pointer_mut("/result/recording/artifact")
    .and_then(Value::as_object_mut)
  {
    artifact.remove("stagedPath");
    artifact.insert(
      "out".to_string(),
      Value::String(path.to_string_lossy().into_owned()),
    );
  }
  Ok(())
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
  fn outputs_stay_inline_unless_asked_except_csv_and_recordings() {
    let home = Path::new(TEST_HOME);
    let export = output_spec("theme.export", &json!({ "pack": {} })).unwrap();
    assert!(!export.always);
    assert_eq!(
      destination(None, export.always, export.name, export.extension, home).unwrap(),
      None
    );
    let csv = output_spec("transport.file.exportStatistics", &json!({ "csv": "" })).unwrap();
    assert!(csv.always);
    assert!(destination(None, csv.always, csv.name, csv.extension, home)
      .unwrap()
      .is_some());
    assert_eq!(
      output_spec("transport.file.report", &json!({ "markdown": "# r" }))
        .unwrap()
        .extension,
      "md"
    );
    assert!(output_spec("theme.list", &json!({})).is_none());
  }

  #[test]
  fn saving_moves_the_document_out_and_never_clobbers() {
    let directory = scratch("save");
    let first = unique_file(&directory, "PLVS Themes", "plvstheme");
    assert!(first.ends_with("PLVS Themes.plvstheme"));
    fs::write(&first, b"existing").unwrap();
    let second = unique_file(&directory, "PLVS Themes", "plvstheme");
    assert_ne!(first, second);
    assert!(second.to_string_lossy().ends_with("(2).plvstheme"));

    let spec = output_spec("theme.export", &json!({})).unwrap();
    let mut report = json!({ "ok": true, "result": { "pack": { "themes": [] }, "revision": 3 } });
    save_document(&mut report, spec, &second).unwrap();
    assert!(report["result"].get("pack").is_none());
    assert_eq!(report["result"]["out"], json!(second.to_string_lossy()));
    assert_eq!(
      fs::read_to_string(&second).unwrap(),
      "{\n  \"themes\": []\n}\n"
    );
    assert_eq!(fs::read(&first).unwrap(), b"existing");
  }
}
