use atomic_write_file::AtomicWriteFile;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::VecDeque;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

pub const CRASH_REPORT_SCHEMA_VERSION: u32 = 1;
const SESSION_START_PREFIX: &str = "PLVS_SESSION_START ";
const MAX_FRONTEND_ERROR_NAME_BYTES: usize = 256;
const MAX_FRONTEND_ERROR_MESSAGE_BYTES: usize = 16 * 1024;
const MAX_FRONTEND_STACK_BYTES: usize = 128 * 1024;
const MAX_COMPONENT_STACK_BYTES: usize = 64 * 1024;
const MAX_FRONTEND_LOG_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashReport {
  pub schema_version: u32,
  pub id: String,
  pub created_at: String,
  pub session_id: String,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub runtime: Option<CrashRuntime>,
  pub kind: CrashKind,
  pub app: CrashApp,
  pub error: CrashError,
  pub logs: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashRuntime {
  pub instance_id: String,
  pub workspace_id: String,
  pub log_file_name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CrashKind {
  RustPanic,
  FrontendRender,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CrashApp {
  pub version: String,
  pub os: String,
  pub arch: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashError {
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub name: Option<String>,
  pub message: String,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub location: Option<CrashLocation>,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub stack: Option<String>,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub component_stack: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CrashLocation {
  pub file: String,
  pub line: u32,
  pub column: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontendCrashInput {
  pub name: Option<String>,
  pub message: String,
  pub stack: Option<String>,
  pub component_stack: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackDiagnostics {
  pub schema_version: u32,
  pub app: CrashApp,
  pub logs: Vec<String>,
}

pub fn prompt_enabled_from_settings(settings: &Value) -> bool {
  settings
    .get("askToSendCrashReports")
    .and_then(Value::as_bool)
    .unwrap_or(true)
}

pub fn normalize_frontend_crash(input: FrontendCrashInput) -> Result<CrashError, String> {
  validate_optional_text(
    "error name",
    input.name.as_deref(),
    MAX_FRONTEND_ERROR_NAME_BYTES,
  )?;
  validate_text(
    "error message",
    &input.message,
    MAX_FRONTEND_ERROR_MESSAGE_BYTES,
  )?;
  validate_optional_text(
    "error stack",
    input.stack.as_deref(),
    MAX_FRONTEND_STACK_BYTES,
  )?;
  validate_optional_text(
    "component stack",
    input.component_stack.as_deref(),
    MAX_COMPONENT_STACK_BYTES,
  )?;
  Ok(CrashError {
    name: input.name.filter(|value| !value.trim().is_empty()),
    message: if input.message.trim().is_empty() {
      "Unknown frontend render error".into()
    } else {
      input.message
    },
    location: None,
    stack: input.stack.filter(|value| !value.trim().is_empty()),
    component_stack: input
      .component_stack
      .filter(|value| !value.trim().is_empty()),
  })
}

pub fn normalize_frontend_log(message: String) -> Result<String, String> {
  validate_text("frontend log message", &message, MAX_FRONTEND_LOG_BYTES)?;
  Ok(if message.trim().is_empty() {
    "Unknown frontend error".into()
  } else {
    message
  })
}

fn validate_text(label: &str, value: &str, max_bytes: usize) -> Result<(), String> {
  if value.len() > max_bytes {
    return Err(format!("{label} exceeds {max_bytes} bytes"));
  }
  Ok(())
}

fn validate_optional_text(
  label: &str,
  value: Option<&str>,
  max_bytes: usize,
) -> Result<(), String> {
  value.map_or(Ok(()), |value| validate_text(label, value, max_bytes))
}

#[derive(Debug)]
pub struct CrashReporterState {
  store: CrashStore,
  log_dir: PathBuf,
  log_file_name: String,
  session_id: String,
  prompt_enabled: AtomicBool,
  panic_guard: AtomicBool,
  app: CrashApp,
  runtime: Option<CrashRuntime>,
}

impl CrashReporterState {
  pub fn new(
    log_dir: PathBuf,
    log_file_name: impl Into<String>,
    home: impl Into<String>,
    prompt_enabled: bool,
    app: CrashApp,
  ) -> io::Result<Self> {
    fs::create_dir_all(&log_dir)?;
    let session_id = format!("session-{}", generate_report_id(OffsetDateTime::now_utc())?);
    Ok(Self {
      store: CrashStore::new(&log_dir, home, cfg!(target_os = "windows")),
      log_dir,
      log_file_name: log_file_name.into(),
      session_id,
      prompt_enabled: AtomicBool::new(prompt_enabled),
      panic_guard: AtomicBool::new(false),
      app,
      runtime: None,
    })
  }

  pub fn with_runtime_identity(mut self, instance_id: &str, workspace_id: &str) -> Self {
    self.runtime = Some(CrashRuntime {
      instance_id: instance_id.to_string(),
      workspace_id: workspace_id.to_string(),
      log_file_name: self.log_file_name.clone(),
    });
    self
  }

  pub fn session_id(&self) -> &str {
    &self.session_id
  }

  pub fn prompt_enabled(&self) -> bool {
    self.prompt_enabled.load(Ordering::Acquire)
  }

  pub fn set_prompt_enabled(&self, enabled: bool) {
    self.prompt_enabled.store(enabled, Ordering::Release);
  }

  pub fn try_begin_panic(&self) -> bool {
    self
      .panic_guard
      .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
      .is_ok()
  }

  pub fn new_report(&self, kind: CrashKind, error: CrashError) -> io::Result<CrashReport> {
    let now = OffsetDateTime::now_utc();
    Ok(CrashReport {
      schema_version: CRASH_REPORT_SCHEMA_VERSION,
      id: generate_report_id(now)?,
      created_at: now.format(&Rfc3339).map_err(io::Error::other)?,
      session_id: self.session_id.clone(),
      runtime: self.runtime.clone(),
      kind,
      app: self.app.clone(),
      error,
      logs: Vec::new(),
    })
  }

  pub fn save_report(&self, report: &CrashReport) -> io::Result<PathBuf> {
    self.store.save(report, self.prompt_enabled())
  }

  pub fn newest_pending(&self) -> io::Result<Option<CrashReport>> {
    self.store.newest_pending()
  }

  pub fn discard(&self, id: &str) -> io::Result<bool> {
    self.store.discard(id)
  }

  pub fn enrich_pending(&self, line_limit: usize) -> io::Result<()> {
    self
      .store
      .enrich_pending(&self.log_dir, &self.log_file_name, line_limit)
  }

  pub fn feedback_diagnostics(&self, line_limit: usize) -> io::Result<FeedbackDiagnostics> {
    let logs = extract_session_log_tail(
      &self.log_dir,
      &self.log_file_name,
      &self.session_id,
      line_limit,
    )?
    .into_iter()
    .map(|line| redact_home_paths(&line, &self.store.home, self.store.case_insensitive_home))
    .collect();
    Ok(FeedbackDiagnostics {
      schema_version: CRASH_REPORT_SCHEMA_VERSION,
      app: self.app.clone(),
      logs,
    })
  }
}

pub fn install_panic_hook(reporter: Arc<CrashReporterState>) {
  #[cfg(debug_assertions)]
  let previous = std::panic::take_hook();
  #[cfg(not(debug_assertions))]
  let _ = std::panic::take_hook();
  std::panic::set_hook(Box::new(move |info| {
    if reporter.try_begin_panic() {
      // A panic can originate on the audio callback thread. Allocation and filesystem I/O are
      // acceptable here because panic=abort makes this path terminal; the callback will never
      // return to normal realtime processing.
      let message = if let Some(message) = info.payload().downcast_ref::<&str>() {
        (*message).to_owned()
      } else if let Some(message) = info.payload().downcast_ref::<String>() {
        message.clone()
      } else {
        "Non-string panic payload".into()
      };
      let location = info.location().map(|location| CrashLocation {
        file: location.file().to_owned(),
        line: location.line(),
        column: location.column(),
      });
      let error = CrashError {
        name: Some("Rust panic".into()),
        message,
        location,
        stack: Some(std::backtrace::Backtrace::force_capture().to_string()),
        component_stack: None,
      };
      if let Ok(report) = reporter.new_report(CrashKind::RustPanic, error) {
        let _ = reporter.save_report(&report);
      }
    }

    // Development keeps Rust's normal console panic output. Release avoids calling another hook
    // after the artifact is complete, minimizing duplicate output and re-entrancy risk.
    #[cfg(debug_assertions)]
    previous(info);
  }));
}

#[derive(Debug, Clone)]
pub struct CrashStore {
  pending_dir: PathBuf,
  suppressed_dir: PathBuf,
  home: String,
  case_insensitive_home: bool,
}

impl CrashStore {
  pub fn new(log_dir: &Path, home: impl Into<String>, case_insensitive_home: bool) -> Self {
    let root = log_dir.join("crash");
    Self {
      pending_dir: root.join("pending"),
      suppressed_dir: root.join("suppressed"),
      home: home.into(),
      case_insensitive_home,
    }
  }

  pub fn save(&self, report: &CrashReport, prompt_enabled: bool) -> io::Result<PathBuf> {
    if !valid_report_id(&report.id) {
      return Err(io::Error::new(
        io::ErrorKind::InvalidInput,
        "invalid crash report id",
      ));
    }
    let directory = if prompt_enabled {
      &self.pending_dir
    } else {
      &self.suppressed_dir
    };
    fs::create_dir_all(directory)?;
    let path = directory.join(format!("{}.json", report.id));
    let mut value = serde_json::to_value(report).map_err(io::Error::other)?;
    redact_json_strings(&mut value, &self.home, self.case_insensitive_home);
    let bytes = serde_json::to_vec_pretty(&value).map_err(io::Error::other)?;
    write_atomic(&path, &bytes)?;
    self.prune()?;
    Ok(path)
  }

  pub fn newest_pending(&self) -> io::Result<Option<CrashReport>> {
    let mut paths = json_files_in(&self.pending_dir)?;
    paths.sort_by(|left, right| right.file_name().cmp(&left.file_name()));

    for path in paths {
      let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) => {
          log::warn!("Unable to read crash report {}: {error}", path.display());
          continue;
        }
      };
      let value: Value = match serde_json::from_slice(&bytes) {
        Ok(value) => value,
        Err(error) => {
          log::warn!("Removing corrupt crash report {}: {error}", path.display());
          let _ = fs::remove_file(&path);
          continue;
        }
      };
      let schema_version = value.get("schemaVersion").and_then(Value::as_u64);
      if schema_version != Some(u64::from(CRASH_REPORT_SCHEMA_VERSION)) {
        continue;
      }
      match serde_json::from_value::<CrashReport>(value) {
        Ok(report) => return Ok(Some(report)),
        Err(error) => {
          log::warn!(
            "Removing malformed crash report {}: {error}",
            path.display()
          );
          let _ = fs::remove_file(&path);
        }
      }
    }
    Ok(None)
  }

  pub fn discard(&self, id: &str) -> io::Result<bool> {
    if !valid_report_id(id) {
      return Err(io::Error::new(
        io::ErrorKind::InvalidInput,
        "invalid crash report id",
      ));
    }
    let path = self.pending_dir.join(format!("{id}.json"));
    match fs::remove_file(path) {
      Ok(()) => Ok(true),
      Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
      Err(error) => Err(error),
    }
  }

  pub fn enrich_pending(
    &self,
    log_dir: &Path,
    log_file_name: &str,
    line_limit: usize,
  ) -> io::Result<()> {
    for path in json_files_in(&self.pending_dir)? {
      let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) => {
          log::warn!("Unable to read crash report {}: {error}", path.display());
          continue;
        }
      };
      let mut report = match serde_json::from_slice::<CrashReport>(&bytes) {
        Ok(report) if report.schema_version == CRASH_REPORT_SCHEMA_VERSION => report,
        Ok(_) => continue,
        Err(error) => {
          log::warn!("Removing corrupt crash report {}: {error}", path.display());
          let _ = fs::remove_file(&path);
          continue;
        }
      };
      if !report.logs.is_empty() {
        continue;
      }
      let report_log_file_name = report
        .runtime
        .as_ref()
        .map(|runtime| runtime.log_file_name.as_str())
        .unwrap_or(log_file_name);
      report.logs = match extract_session_log_tail(
        log_dir,
        report_log_file_name,
        &report.session_id,
        line_limit,
      ) {
        Ok(lines) => lines,
        Err(error) => {
          log::warn!(
            "Unable to enrich crash report {} with logs: {error}",
            report.id
          );
          continue;
        }
      };
      self.save(&report, true)?;
    }
    self.prune()
  }

  fn report_files(&self) -> io::Result<Vec<PathBuf>> {
    let mut paths = json_files_in(&self.pending_dir)?;
    paths.extend(json_files_in(&self.suppressed_dir)?);
    paths.sort_by(|left, right| left.file_name().cmp(&right.file_name()));
    Ok(paths)
  }

  fn prune(&self) -> io::Result<()> {
    const RETAINED_REPORTS: usize = 5;
    let paths = self.report_files()?;
    let remove_count = paths.len().saturating_sub(RETAINED_REPORTS);
    for path in paths.into_iter().take(remove_count) {
      if let Err(error) = fs::remove_file(&path) {
        if error.kind() != io::ErrorKind::NotFound {
          return Err(error);
        }
      }
    }
    Ok(())
  }
}

fn json_files_in(directory: &Path) -> io::Result<Vec<PathBuf>> {
  let entries = match fs::read_dir(directory) {
    Ok(entries) => entries,
    Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
    Err(error) => return Err(error),
  };
  let mut paths = Vec::new();
  for entry in entries {
    let path = entry?.path();
    if path.extension().and_then(|value| value.to_str()) == Some("json") {
      paths.push(path);
    }
  }
  Ok(paths)
}

pub fn session_start_marker(session_id: &str) -> String {
  format!("{SESSION_START_PREFIX}{session_id}")
}

pub fn extract_session_log_tail(
  log_dir: &Path,
  log_file_name: &str,
  session_id: &str,
  limit: usize,
) -> io::Result<Vec<String>> {
  if limit == 0 {
    return Ok(Vec::new());
  }
  let active_name = format!("{log_file_name}.log");
  let archive_prefix = format!("{log_file_name}_");
  let mut files = fs::read_dir(log_dir)?
    .filter_map(Result::ok)
    .map(|entry| entry.path())
    .filter(|path| {
      let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
      };
      name == active_name
        || (name.starts_with(&archive_prefix)
          && (name.ends_with(".log") || name.ends_with(".log.bak")))
    })
    .collect::<Vec<_>>();
  files.sort_by(|left, right| {
    let left_name = left.file_name().unwrap().to_string_lossy();
    let right_name = right.file_name().unwrap().to_string_lossy();
    let left_active = left_name == active_name;
    let right_active = right_name == active_name;
    left_active
      .cmp(&right_active)
      .then(left_name.cmp(&right_name))
  });

  let target_marker = session_start_marker(session_id);
  let mut in_target_session = false;
  let mut lines = VecDeque::with_capacity(limit);
  for path in files {
    let content = fs::read_to_string(path)?;
    for line in content.lines() {
      if line.contains(&target_marker) {
        in_target_session = true;
        lines.clear();
        continue;
      }
      if line.contains(SESSION_START_PREFIX) {
        if in_target_session {
          return Ok(lines.into());
        }
        continue;
      }
      if in_target_session {
        if lines.len() == limit {
          lines.pop_front();
        }
        lines.push_back(line.to_owned());
      }
    }
  }
  Ok(lines.into())
}

fn valid_report_id(id: &str) -> bool {
  !id.is_empty()
    && id.len() <= 80
    && id
      .bytes()
      .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

fn redact_json_strings(value: &mut Value, home: &str, case_insensitive: bool) {
  match value {
    Value::String(text) => *text = redact_home_paths(text, home, case_insensitive),
    Value::Array(values) => {
      for value in values {
        redact_json_strings(value, home, case_insensitive);
      }
    }
    Value::Object(values) => {
      for value in values.values_mut() {
        redact_json_strings(value, home, case_insensitive);
      }
    }
    _ => {}
  }
}

fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
  write_atomic_observed(path, bytes, || {})
}

fn write_atomic_observed(
  path: &Path,
  bytes: &[u8],
  before_commit: impl FnOnce(),
) -> io::Result<()> {
  let mut file = AtomicWriteFile::open(path)?;
  file.write_all(bytes)?;
  before_commit();
  file.commit()
}

fn format_report_id(now: OffsetDateTime, random: [u8; 4]) -> String {
  format!(
    "{:04}{:02}{:02}T{:02}{:02}{:02}Z-{:02x}{:02x}{:02x}{:02x}",
    now.year(),
    u8::from(now.month()),
    now.day(),
    now.hour(),
    now.minute(),
    now.second(),
    random[0],
    random[1],
    random[2],
    random[3]
  )
}

fn generate_report_id(now: OffsetDateTime) -> io::Result<String> {
  let mut random = [0_u8; 4];
  getrandom::fill(&mut random).map_err(io::Error::other)?;
  Ok(format_report_id(now, random))
}

fn redact_home_paths(input: &str, home: &str, case_insensitive: bool) -> String {
  let home = home.trim_end_matches(['/', '\\']);
  if home.is_empty() {
    return input.to_owned();
  }

  let mut redacted = input.to_owned();
  let native = home.to_owned();
  let alternate = if home.contains('\\') {
    home.replace('\\', "/")
  } else {
    home.replace('/', "\\")
  };

  for candidate in [native, alternate] {
    redacted = if case_insensitive {
      replace_ascii_case_insensitive(&redacted, &candidate, "~")
    } else {
      redacted.replace(&candidate, "~")
    };
  }
  redacted
}

fn replace_ascii_case_insensitive(input: &str, needle: &str, replacement: &str) -> String {
  let mut output = String::with_capacity(input.len());
  let mut cursor = 0;

  while cursor < input.len() {
    let remaining = &input[cursor..];
    let match_at = remaining.char_indices().find_map(|(offset, _)| {
      remaining
        .get(offset..offset + needle.len())
        .filter(|candidate| candidate.eq_ignore_ascii_case(needle))
        .map(|_| offset)
    });
    let Some(offset) = match_at else {
      output.push_str(remaining);
      break;
    };
    output.push_str(&remaining[..offset]);
    output.push_str(replacement);
    cursor += offset + needle.len();
  }

  output
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::fs;
  use std::path::PathBuf;

  struct TestDirectory(PathBuf);

  impl TestDirectory {
    fn new() -> Self {
      let mut random = [0_u8; 4];
      getrandom::fill(&mut random).unwrap();
      let path = std::env::temp_dir().join(format!(
        "plvs-crash-report-test-{}-{}",
        std::process::id(),
        format_report_id(OffsetDateTime::now_utc(), random)
      ));
      fs::create_dir_all(&path).unwrap();
      Self(path)
    }
  }

  impl Drop for TestDirectory {
    fn drop(&mut self) {
      let _ = fs::remove_dir_all(&self.0);
    }
  }

  fn sample_report(id: &str) -> CrashReport {
    CrashReport {
      schema_version: CRASH_REPORT_SCHEMA_VERSION,
      id: id.into(),
      created_at: "2026-09-16T12:00:00Z".into(),
      session_id: "session-a".into(),
      runtime: None,
      kind: CrashKind::RustPanic,
      app: CrashApp {
        version: "0.15.4".into(),
        os: "windows".into(),
        arch: "x86_64".into(),
      },
      error: CrashError {
        name: None,
        message: "test panic".into(),
        location: None,
        stack: None,
        component_stack: None,
      },
      logs: Vec::new(),
    }
  }

  #[test]
  fn serializes_the_versioned_report_contract() {
    let report = CrashReport {
      schema_version: CRASH_REPORT_SCHEMA_VERSION,
      id: "20260916T120000Z-a1b2c3d4".into(),
      created_at: "2026-09-16T12:00:00Z".into(),
      session_id: "session-a".into(),
      runtime: None,
      kind: CrashKind::RustPanic,
      app: CrashApp {
        version: "0.15.4".into(),
        os: "windows".into(),
        arch: "x86_64".into(),
      },
      error: CrashError {
        name: None,
        message: "test panic".into(),
        location: Some(CrashLocation {
          file: "src/audio/capture.rs".into(),
          line: 428,
          column: 17,
        }),
        stack: None,
        component_stack: None,
      },
      logs: vec!["last log line".into()],
    };

    let value = serde_json::to_value(&report).unwrap();
    assert_eq!(value["schemaVersion"], 1);
    assert_eq!(value["kind"], "rust_panic");
    assert_eq!(value["app"]["version"], "0.15.4");
    assert_eq!(value["error"]["location"]["line"], 428);
    assert_eq!(value["logs"][0], "last log line");
  }

  #[test]
  fn serializes_frontend_render_error_details() {
    let mut report = sample_report("20260916T120000Z-01234567");
    report.kind = CrashKind::FrontendRender;
    report.error.name = Some("TypeError".into());
    report.error.stack = Some("render@main.js:1".into());
    report.error.component_stack = Some("at Meter (Meter.jsx:10)".into());

    let value = serde_json::to_value(report).unwrap();

    assert_eq!(value["kind"], "frontend_render");
    assert_eq!(value["error"]["name"], "TypeError");
    assert_eq!(value["error"]["componentStack"], "at Meter (Meter.jsx:10)");
  }

  #[test]
  fn report_ids_are_safe_and_sort_in_creation_order() {
    let earlier = OffsetDateTime::from_unix_timestamp(1_789_558_400).unwrap();
    let later = earlier + time::Duration::seconds(1);

    let earlier_id = format_report_id(earlier, [0x01, 0x23, 0x45, 0x67]);
    let later_id = format_report_id(later, [0x89, 0xab, 0xcd, 0xef]);

    assert!(earlier_id < later_id);
    assert!(earlier_id
      .bytes()
      .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-'));
  }

  #[test]
  fn redacts_windows_home_paths_with_either_separator_and_case() {
    let input =
      r#"C:\Users\ShenXiChen\Music\mix.wav and c:/users/shenxichen/AppData/Local/PLVS/log.log"#;

    let redacted = redact_home_paths(input, r#"C:\Users\ShenXiChen"#, true);

    assert_eq!(
      redacted,
      r#"~\Music\mix.wav and ~/AppData/Local/PLVS/log.log"#
    );
  }

  #[test]
  fn redacts_macos_home_paths() {
    let input = "/Users/shenxichen/Music/mix.wav";

    assert_eq!(
      redact_home_paths(input, "/Users/shenxichen", false),
      "~/Music/mix.wav"
    );
  }

  #[test]
  fn save_redacts_before_the_final_json_is_written() {
    let directory = TestDirectory::new();
    let store = CrashStore::new(&directory.0, r#"C:\Users\ShenXiChen"#, true);
    let mut report = sample_report("20260916T120000Z-01234567");
    report.error.message = r#"failed below C:\Users\ShenXiChen\Music"#.into();

    let path = store.save(&report, true).unwrap();
    let bytes = fs::read(&path).unwrap();
    let stored: CrashReport = serde_json::from_slice(&bytes).unwrap();

    assert_eq!(stored.error.message, r#"failed below ~\Music"#);
    assert!(!String::from_utf8(bytes).unwrap().contains("ShenXiChen"));
  }

  #[test]
  fn atomic_writer_has_no_final_file_before_commit() {
    let directory = TestDirectory::new();
    let path = directory.0.join("report.json");

    write_atomic_observed(&path, b"{}", || assert!(!path.exists())).unwrap();

    assert_eq!(fs::read(path).unwrap(), b"{}");
  }

  #[test]
  fn retention_keeps_the_newest_five_across_both_queues() {
    let directory = TestDirectory::new();
    let store = CrashStore::new(&directory.0, "", true);
    for index in 0..7 {
      let id = format!("20260916T12000{index}Z-01234567");
      store.save(&sample_report(&id), index % 2 == 0).unwrap();
    }

    let names = store
      .report_files()
      .unwrap()
      .into_iter()
      .map(|path| path.file_stem().unwrap().to_string_lossy().into_owned())
      .collect::<Vec<_>>();

    assert_eq!(names.len(), 5);
    assert!(!names.iter().any(|name| name.ends_with("000Z-01234567")));
    assert!(!names.iter().any(|name| name.ends_with("001Z-01234567")));
  }

  #[test]
  fn newest_pending_skips_future_schema_and_removes_corrupt_files() {
    let directory = TestDirectory::new();
    let store = CrashStore::new(&directory.0, "", true);
    let valid = sample_report("20260916T120000Z-01234567");
    store.save(&valid, true).unwrap();
    let mut future = sample_report("20260916T120001Z-01234567");
    future.schema_version = CRASH_REPORT_SCHEMA_VERSION + 1;
    store.save(&future, true).unwrap();
    let corrupt_path = store.pending_dir.join("20260916T120002Z-01234567.json");
    fs::write(&corrupt_path, b"not json").unwrap();

    let newest = store.newest_pending().unwrap().unwrap();

    assert_eq!(newest.id, valid.id);
    assert!(store
      .pending_dir
      .join("20260916T120001Z-01234567.json")
      .exists());
    assert!(!corrupt_path.exists());
  }

  #[test]
  fn discard_requires_an_exact_safe_report_id() {
    let directory = TestDirectory::new();
    let store = CrashStore::new(&directory.0, "", true);
    let report = sample_report("20260916T120000Z-01234567");
    let path = store.save(&report, true).unwrap();

    assert!(store.discard("../20260916T120000Z-01234567").is_err());
    assert!(path.exists());
    assert!(store.discard(&report.id).unwrap());
    assert!(!path.exists());
    assert!(!store.discard(&report.id).unwrap());
  }

  #[test]
  fn extracts_the_final_two_hundred_session_lines_across_rotated_logs() {
    let directory = TestDirectory::new();
    let archived = directory.0.join("PLVS_2026-09-16_11-59-59.log");
    let active = directory.0.join("PLVS.log");
    let mut first = format!("{}\n", session_start_marker("crashed-session"));
    for index in 1..=120 {
      first.push_str(&format!("line {index}\n"));
    }
    let mut second = String::new();
    for index in 121..=230 {
      second.push_str(&format!("line {index}\n"));
    }
    second.push_str(&format!(
      "{}\ncurrent session line\n",
      session_start_marker("current")
    ));
    fs::write(archived, first).unwrap();
    fs::write(active, second).unwrap();

    let lines = extract_session_log_tail(&directory.0, "PLVS", "crashed-session", 200).unwrap();

    assert_eq!(lines.len(), 200);
    assert_eq!(lines.first().unwrap(), "line 31");
    assert_eq!(lines.last().unwrap(), "line 230");
  }

  #[test]
  fn healthy_startup_enriches_and_redacts_a_pending_report() {
    let directory = TestDirectory::new();
    let store = CrashStore::new(&directory.0, r#"C:\Users\ShenXiChen"#, true);
    let report = sample_report("20260916T120000Z-01234567");
    store.save(&report, true).unwrap();
    fs::write(
      directory.0.join("PLVS.log"),
      format!(
        "{}\nopened C:\\Users\\ShenXiChen\\Music\\mix.wav\n",
        session_start_marker(&report.session_id)
      ),
    )
    .unwrap();

    store.enrich_pending(&directory.0, "PLVS", 200).unwrap();
    let enriched = store.newest_pending().unwrap().unwrap();

    assert_eq!(enriched.logs, vec![r#"opened ~\Music\mix.wav"#]);
  }

  #[test]
  fn reporter_state_owns_prompt_snapshot_and_report_metadata() {
    let directory = TestDirectory::new();
    let reporter = CrashReporterState::new(
      directory.0.clone(),
      "PLVS",
      "",
      true,
      CrashApp {
        version: "0.15.4".into(),
        os: "windows".into(),
        arch: "x86_64".into(),
      },
    )
    .unwrap()
    .with_runtime_identity("instance-one", "workspace-spotify");

    let report = reporter
      .new_report(
        CrashKind::FrontendRender,
        CrashError {
          name: Some("Error".into()),
          message: "render failed".into(),
          location: None,
          stack: None,
          component_stack: None,
        },
      )
      .unwrap();
    reporter.set_prompt_enabled(false);

    assert_eq!(report.schema_version, CRASH_REPORT_SCHEMA_VERSION);
    assert_eq!(report.session_id, reporter.session_id());
    assert_eq!(report.app.version, "0.15.4");
    assert_eq!(report.runtime.as_ref().unwrap().instance_id, "instance-one");
    assert_eq!(
      report.runtime.as_ref().unwrap().workspace_id,
      "workspace-spotify"
    );
    assert!(!reporter.prompt_enabled());
    assert!(reporter.try_begin_panic());
    assert!(!reporter.try_begin_panic());
  }

  #[test]
  fn prompt_setting_defaults_on_and_accepts_an_explicit_false() {
    assert!(prompt_enabled_from_settings(&serde_json::json!({})));
    assert!(prompt_enabled_from_settings(&serde_json::json!({
      "askToSendCrashReports": "not-a-boolean"
    })));
    assert!(!prompt_enabled_from_settings(&serde_json::json!({
      "askToSendCrashReports": false
    })));
  }

  #[test]
  fn normalizes_frontend_crash_input_and_rejects_oversized_fields() {
    let normalized = normalize_frontend_crash(FrontendCrashInput {
      name: Some("  ".into()),
      message: "".into(),
      stack: Some("stack".into()),
      component_stack: None,
    })
    .unwrap();
    assert_eq!(normalized.name, None);
    assert_eq!(normalized.message, "Unknown frontend render error");
    assert_eq!(normalized.stack.as_deref(), Some("stack"));

    let error = normalize_frontend_crash(FrontendCrashInput {
      name: None,
      message: "x".repeat(MAX_FRONTEND_ERROR_MESSAGE_BYTES + 1),
      stack: None,
      component_stack: None,
    })
    .unwrap_err();
    assert!(error.contains("error message"));
  }
}
