//! Bounded, local-only evidence for recoverable window failures. No audio-thread callers.
use std::{collections::VecDeque, io::Write, path::PathBuf, sync::Mutex, time::Instant};

use atomic_write_file::AtomicWriteFile;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{Manager, Runtime, WebviewWindow};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

pub const SCHEMA_VERSION: u32 = 2;
pub const EXPORT_BUDGET: usize = 120 * 1024;
const JOURNAL_BUDGET: usize = 64 * 1024;
const OPERATION_LIMIT: usize = 100;

pub fn now() -> String {
  OffsetDateTime::now_utc()
    .format(&Rfc3339)
    .unwrap_or_default()
}

pub fn section<T: Serialize, E>(value: Result<T, E>) -> Value {
  match value {
    Ok(data) => json!({"status":"ok", "data":data}),
    Err(_) => json!({"status":"readFailed"}),
  }
}

/// New snapshot fields never include monitor names, device names, paths or UI text.
pub fn window_snapshot<R: Runtime>(window: &WebviewWindow<R>) -> Value {
  json!({
    "position": section(window.outer_position()),
    "innerSize": section(window.inner_size()),
    "visible": section(window.is_visible()),
    "minimized": section(window.is_minimized()),
    "alwaysOnTop": section(window.is_always_on_top()),
    "scaleFactor": section(window.scale_factor()),
    "monitorPosition": section(window.current_monitor().map(|monitor| monitor.map(|monitor| *monitor.position()))),
  })
}

fn dock_snapshot<R: Runtime>(app: &tauri::AppHandle<R>) -> Value {
  crate::dock::read_dock_state(app).map_or(Value::Null, |dock| {
    let monitor_position = app.get_webview_window("main")
      .and_then(|main| main.available_monitors().ok())
      .and_then(|monitors| monitors.into_iter().find(|monitor| monitor.name() == dock.monitor.as_ref()))
      .map(|monitor| *monitor.position());
    json!({"enabled":dock.enabled, "edge":dock.edge, "height":dock.height,
      "reserveSpace":dock.reserve_space,
      "monitorPosition":monitor_position,
      "nativeEnabled":app.state::<crate::dock::DockedFlag>().0.load(std::sync::atomic::Ordering::Relaxed)})
  })
}

fn monitor_snapshot<R: Runtime>(main: &WebviewWindow<R>) -> Value {
  let monitors = main.available_monitors().map(|monitors| {
    monitors
      .iter()
      .take(16)
      .enumerate()
      .map(|(index, m)| {
        json!({
          "index":index, "position":m.position(), "size":m.size(),
          "workArea":m.work_area(), "scaleFactor":m.scale_factor(),
        })
      })
      .collect::<Vec<_>>()
  });
  section(monitors)
}

pub fn native_snapshot<R: Runtime>(app: &tauri::AppHandle<R>) -> Value {
  let Some(main) = app.get_webview_window("main") else {
    return json!({"status":"windowUnavailable"});
  };
  let mut windows = serde_json::Map::new();
  for label in ["main", "dock-header", "dock-editor"] {
    windows.insert(
      label.into(),
      app
        .get_webview_window(label)
        .map(|window| window_snapshot(&window))
        .unwrap_or_else(|| json!({"status":"windowUnavailable"})),
    );
  }
  json!({"status":"ok", "capturedAt":now(), "dock":dock_snapshot(app),
    "windows":windows, "monitors":monitor_snapshot(&main)})
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FrontendSnapshot {
  pub captured_at: String,
  pub viewport_width: u32,
  pub viewport_height: u32,
  pub device_pixel_ratio: f64,
  pub page_visible: bool,
  pub dock_mounted: bool,
  pub dock_module_count: u32,
  pub dock_module_types: Vec<String>,
  pub dock: Option<FrontendDock>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FrontendDock {
  pub enabled: bool,
  pub suspended: bool,
  pub height: u32,
  pub preview_height: Option<u32>,
}

impl FrontendSnapshot {
  pub fn validated(self) -> Value {
    if self.captured_at.len() > 40
      || !self.device_pixel_ratio.is_finite()
      || !(0.1..=16.0).contains(&self.device_pixel_ratio)
      || self.viewport_width > 100_000
      || self.viewport_height > 100_000
      || self.dock_module_count > 1000
      || self.dock_module_types.len() > 9
      || self.dock_module_types.iter().any(|id| {
        ![
          "level",
          "loudness",
          "spectrum",
          "correlation",
          "stats",
          "waveform",
          "spectrogram",
          "stereoMap",
          "transport",
        ]
        .contains(&id.as_str())
      })
    {
      return json!({"status":"invalid"});
    }
    json!({"status":"ok", "data":self})
  }
}

#[derive(Clone, Copy, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Origin {
  #[default]
  Unknown,
  Ui,
  AgentControl,
  Preset,
  Tray,
  Lifecycle,
  System,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Operation {
  id: u64,
  session_id: String,
  kind: String,
  origin: Origin,
  started_at: String,
  ended_at: Option<String>,
  elapsed_ms: Option<u64>,
  outcome: String,
  requested: Value,
  before: Value,
  after: Value,
  request_count: u64,
  error_count: u64,
  error: Option<String>,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Journal {
  records: VecDeque<Operation>,
  dropped: u64,
}

struct Inner {
  journal: Journal,
  resize: Option<u64>,
  sequence: u64,
  storage_status: &'static str,
  last_environment: Option<Value>,
}

pub struct DiagnosticsState {
  inner: Mutex<Inner>,
  path: PathBuf,
  session_id: String,
  started: Instant,
  pub collecting_native: std::sync::atomic::AtomicBool,
}

impl DiagnosticsState {
  pub fn new(directory: PathBuf, workspace_id: &str, session_id: &str) -> Self {
    // RuntimeIdentity already validates this key. Never use a display name as a path.
    let path = directory.join(format!("{workspace_id}.json"));
    let (mut journal, storage_status) = match std::fs::metadata(&path) {
      Ok(metadata) if metadata.len() <= JOURNAL_BUDGET as u64 => {
        match std::fs::read(&path)
          .ok()
          .and_then(|bytes| serde_json::from_slice::<Journal>(&bytes).ok())
        {
          Some(journal) => (journal, "ok"),
          None => (Journal::default(), "readFailed"),
        }
      }
      Err(error) if error.kind() == std::io::ErrorKind::NotFound => (Journal::default(), "empty"),
      _ => (Journal::default(), "readFailed"),
    };
    // Only retain this run and its immediate predecessor, not an unbounded session history.
    let previous_session = journal
      .records
      .back()
      .map(|record| record.session_id.clone());
    journal
      .records
      .retain(|record| Some(&record.session_id) == previous_session.as_ref());
    for record in &mut journal.records {
      if record.outcome == "pending" {
        record.outcome = "interrupted".into();
      }
    }
    let sequence = journal
      .records
      .iter()
      .map(|record| record.id)
      .max()
      .unwrap_or(0);
    Self {
      inner: Mutex::new(Inner {
        journal,
        resize: None,
        sequence,
        storage_status,
        last_environment: None,
      }),
      path,
      session_id: session_id.into(),
      started: Instant::now(),
      collecting_native: std::sync::atomic::AtomicBool::new(false),
    }
  }

  fn persist(&self, inner: &mut Inner) {
    while inner.journal.records.len() > OPERATION_LIMIT
      || serde_json::to_vec(&inner.journal).map_or(true, |bytes| bytes.len() > JOURNAL_BUDGET)
    {
      if inner.journal.records.pop_front().is_none() {
        break;
      }
      inner.journal.dropped += 1;
    }
    let result = (|| -> std::io::Result<()> {
      std::fs::create_dir_all(self.path.parent().unwrap())?;
      let mut file = AtomicWriteFile::open(&self.path)?;
      serde_json::to_writer(&mut file, &inner.journal)?;
      file.flush()?;
      file.commit()
    })();
    inner.storage_status = if result.is_ok() { "ok" } else { "writeFailed" };
  }

  fn begin(&self, kind: &str, origin: Origin, requested: Value, before: Value) -> u64 {
    let Ok(mut inner) = self.inner.lock() else {
      return 0;
    };
    if kind == "dock.resize" {
      if let Some(id) = inner.resize {
        if let Some(record) = inner
          .journal
          .records
          .iter_mut()
          .find(|record| record.id == id)
        {
          let height = requested["height"].as_u64().unwrap_or(0);
          record.requested["height"] = json!(height);
          record.requested["minHeight"] = json!(record.requested["minHeight"]
            .as_u64()
            .unwrap_or(height)
            .min(height));
          record.requested["maxHeight"] = json!(record.requested["maxHeight"]
            .as_u64()
            .unwrap_or(height)
            .max(height));
          record.request_count += 1;
          return id;
        }
      }
    }
    inner.sequence += 1;
    let id = inner.sequence;
    let mut requested = requested;
    if kind == "dock.resize" {
      requested["minHeight"] = requested["height"].clone();
      requested["maxHeight"] = requested["height"].clone();
      inner.resize = Some(id);
    }
    inner.journal.records.push_back(Operation {
      id,
      session_id: self.session_id.clone(),
      kind: kind.into(),
      origin,
      started_at: now(),
      ended_at: None,
      elapsed_ms: None,
      outcome: "pending".into(),
      requested,
      before,
      after: Value::Null,
      request_count: 1,
      error_count: 0,
      error: None,
    });
    self.persist(&mut inner);
    id
  }

  fn finish(&self, id: u64, after: Value, error: Option<&str>, complete: bool, cancelled: bool) {
    let Ok(mut inner) = self.inner.lock() else {
      return;
    };
    let Some(record) = inner
      .journal
      .records
      .iter_mut()
      .find(|record| record.id == id)
    else {
      return;
    };
    if let Some(error) = error {
      record.error_count += 1;
      record.error = Some(sanitize_log(error).chars().take(512).collect());
    }
    if !complete && error.is_none() {
      return;
    }
    if !complete && record.error_count > 1 {
      return;
    }
    record.after = after;
    if complete {
      record.ended_at = Some(now());
      record.elapsed_ms = OffsetDateTime::parse(&record.started_at, &Rfc3339)
        .ok()
        .map(|start| {
          (OffsetDateTime::now_utc() - start)
            .whole_milliseconds()
            .max(0) as u64
        });
      record.outcome = if error.is_some() {
        "failed"
      } else if cancelled {
        "cancelled"
      } else {
        "completed"
      }
      .into();
      log::info!(target:"diagnostics", "PLVS_OPERATION {}", serde_json::to_string(record).unwrap_or_default());
      if inner.resize == Some(id) {
        inner.resize = None;
      }
    }
    // Repeated preview failures update one record; no per-frame log output.
    self.persist(&mut inner);
  }

  pub fn export(&self) -> Value {
    match self.inner.lock() {
      Ok(inner) => json!({"status":"ok", "storageStatus":inner.storage_status,
        "dropped":inner.journal.dropped, "records":inner.journal.records}),
      Err(_) => json!({"status":"readFailed", "records":[], "dropped":0}),
    }
  }

  pub fn uptime_ms(&self) -> u64 {
    self.started.elapsed().as_millis() as u64
  }

  fn has_pending_resize(&self) -> bool {
    self
      .inner
      .lock()
      .map(|inner| inner.resize.is_some())
      .unwrap_or(false)
  }

  fn environment_changed(&self, environment: Value) {
    let previous = {
      let Ok(mut inner) = self.inner.lock() else {
        return;
      };
      if inner.last_environment.as_ref() == Some(&environment) {
        return;
      }
      inner.last_environment.replace(environment.clone())
    };
    if let Some(previous) = previous {
      let id = self.begin("display.changed", Origin::System, json!({}), previous);
      self.finish(id, environment, None, true, false);
    }
  }
}

pub fn watch_environment<R: Runtime>(window: WebviewWindow<R>) {
  // Independent of the audio pipeline; only changed monitor geometry is retained.
  let _ = std::thread::Builder::new()
    .name("diagnostic-display-watch".into())
    .spawn(move || loop {
      if let Some(state) = window.app_handle().try_state::<DiagnosticsState>() {
        state.environment_changed(monitor_snapshot(&window));
      }
      std::thread::sleep(std::time::Duration::from_secs(2));
    });
}

/// Capture evidence at the common native command boundary, including handled errors.
pub fn observe<R: Runtime, T>(
  window: &WebviewWindow<R>,
  kind: &str,
  origin: Option<Origin>,
  requested: Value,
  complete: bool,
  cancelled: bool,
  operation: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
  let diagnostics = window.app_handle().try_state::<DiagnosticsState>();
  let id = diagnostics.as_ref().map(|state| {
    let before = if kind == "dock.resize" && state.has_pending_resize() {
      Value::Null
    } else {
      json!({"dock":dock_snapshot(window.app_handle()), "window":window_snapshot(window)})
    };
    state.begin(kind, origin.unwrap_or_default(), requested, before)
  });
  let result = operation();
  if let (Some(state), Some(id)) = (diagnostics, id) {
    let after = if complete || result.is_err() {
      json!({"dock":dock_snapshot(window.app_handle()),
      "window":window_snapshot(window)})
    } else {
      Value::Null
    };
    state.finish(
      id,
      after,
      result.as_ref().err().map(String::as_str),
      complete,
      cancelled,
    );
  }
  result
}

/// Redact from the first absolute path onwards, including paths with spaces.
/// Free-form logs may still contain device labels; structured snapshots never do.
pub fn sanitize_log(line: &str) -> String {
  let bytes = line.as_bytes();
  for (index, character) in line.char_indices() {
    let drive = character.is_ascii_alphabetic()
      && bytes.get(index + 1) == Some(&b':')
      && matches!(bytes.get(index + 2), Some(b'/' | b'\\'));
    let unc = character == '\\' && bytes.get(index + 1) == Some(&b'\\');
    let unix = character == '/'
      && (index == 0 || matches!(bytes[index - 1], b' ' | b'\'' | b'"' | b'(' | b'='));
    if drive || unc || unix {
      return format!("{}[path]", &line[..index]);
    }
  }
  line.to_owned()
}

pub fn bound_export(mut report: Value) -> Value {
  report["truncation"] = json!({"logs":0, "operations":0, "snapshot":false});
  // Account once, then subtract removed items. Re-encoding several MiB on each
  // of 500 removals would make the feedback dialog stall on exactly the bad logs
  // this budget is meant to handle. Reserve room for the growing counters.
  let mut bytes = serde_json::to_vec(&report).map_or(usize::MAX, |bytes| bytes.len());
  while bytes > EXPORT_BUDGET - 256 {
    if let Some(lines) = report["logs"]["lines"]
      .as_array_mut()
      .filter(|lines| !lines.is_empty())
    {
      let comma = usize::from(lines.len() > 1);
      let removed = lines.remove(0);
      bytes =
        bytes.saturating_sub(serde_json::to_vec(&removed).map_or(0, |bytes| bytes.len()) + comma);
      report["truncation"]["logs"] = json!(report["truncation"]["logs"].as_u64().unwrap_or(0) + 1);
    } else if let Some(records) = report["operations"]["records"]
      .as_array_mut()
      .filter(|records| !records.is_empty())
    {
      // Drop oldest successes first, preserving failures and unfinished work preferentially.
      let index = records
        .iter()
        .position(|record| record["outcome"] == "completed" && record["errorCount"] == 0)
        .unwrap_or(0);
      let comma = usize::from(records.len() > 1);
      let removed = records.remove(index);
      bytes =
        bytes.saturating_sub(serde_json::to_vec(&removed).map_or(0, |bytes| bytes.len()) + comma);
      report["truncation"]["operations"] =
        json!(report["truncation"]["operations"].as_u64().unwrap_or(0) + 1);
    } else {
      report["native"] = json!({"status":"sizeLimit"});
      report["frontend"] = json!({"status":"sizeLimit"});
      report["truncation"]["snapshot"] = json!(true);
      break;
    }
  }
  report
}

#[cfg(test)]
mod tests {
  use super::*;

  struct Directory(PathBuf);
  impl Directory {
    fn new() -> Self {
      Self(std::env::temp_dir().join(format!(
          "plvs-diagnostics-{}-{}",
          std::process::id(),
          std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
        )))
    }
    fn state(&self, workspace: &str, session: &str) -> DiagnosticsState {
      DiagnosticsState::new(self.0.clone(), workspace, session)
    }
  }
  impl Drop for Directory {
    fn drop(&mut self) {
      let _ = std::fs::remove_dir_all(&self.0);
    }
  }

  #[test]
  fn drag_previews_share_one_durable_start_and_one_completed_summary() {
    let directory = Directory::new();
    let state = directory.state("default", "session-a");
    let first = state.begin(
      "dock.resize",
      Origin::Ui,
      json!({"height":72}),
      json!({"height":56}),
    );
    let initial_bytes = std::fs::read(&state.path).unwrap();
    for height in 73..=150 {
      assert_eq!(
        state.begin(
          "dock.resize",
          Origin::Ui,
          json!({"height":height}),
          Value::Null
        ),
        first
      );
      state.finish(first, Value::Null, None, false, false);
    }
    assert_eq!(std::fs::read(&state.path).unwrap(), initial_bytes);
    state.finish(first, json!({"actualHeight":150}), None, true, false);
    let result = state.export();
    assert_eq!(result["records"].as_array().unwrap().len(), 1);
    let record = &result["records"][0];
    assert_eq!(record["requestCount"], 79);
    assert_eq!(record["requested"]["minHeight"], 72);
    assert_eq!(record["requested"]["maxHeight"], 150);
    assert_eq!(record["before"]["height"], 56);
    assert_eq!(record["outcome"], "completed");
    assert!(record["elapsedMs"].as_u64().is_some());
  }

  #[test]
  fn preview_errors_are_counted_without_repeated_disk_writes_and_cancellation_is_explicit() {
    let directory = Directory::new();
    let state = directory.state("default", "a");
    let id = state.begin("dock.resize", Origin::Ui, json!({"height":72}), Value::Null);
    state.finish(id, Value::Null, Some("MoveWindow failed"), false, false);
    let initial_bytes = std::fs::read(&state.path).unwrap();
    for _ in 0..20 {
      state.finish(id, Value::Null, Some("MoveWindow failed"), false, false);
    }
    assert_eq!(std::fs::read(&state.path).unwrap(), initial_bytes);
    state.finish(id, json!({"height":56}), None, true, true);
    assert_eq!(state.export()["records"][0]["errorCount"], 21);
    assert_eq!(state.export()["records"][0]["outcome"], "cancelled");
  }

  #[test]
  fn restart_keeps_previous_session_and_identifies_interrupted_work_without_mixing_workspaces() {
    let directory = Directory::new();
    let first = directory.state("one", "a");
    first.begin("dock.resize", Origin::Ui, json!({"height":80}), Value::Null);
    let second = directory.state("one", "b");
    assert_eq!(second.export()["records"][0]["outcome"], "interrupted");
    assert_eq!(second.export()["records"][0]["sessionId"], "a");
    assert_eq!(directory.state("two", "c").export()["records"], json!([]));
    let id = second.begin("dock.exit", Origin::AgentControl, json!({}), Value::Null);
    second.finish(id, Value::Null, None, true, false);
    let third = directory.state("one", "d");
    assert_eq!(third.export()["records"].as_array().unwrap().len(), 1);
    assert_eq!(third.export()["records"][0]["sessionId"], "b");
  }

  #[test]
  fn journal_has_both_record_and_byte_limits() {
    let directory = Directory::new();
    let state = directory.state("one", "a");
    for _ in 0..120 {
      let id = state.begin(
        "dock.enter",
        Origin::Ui,
        json!({}),
        json!({"fixture":"x".repeat(1024)}),
      );
      state.finish(id, Value::Null, None, true, false);
    }
    assert!(state.export()["records"].as_array().unwrap().len() <= 100);
    assert!(state.export()["dropped"].as_u64().unwrap() > 0);
    assert!(std::fs::metadata(&state.path).unwrap().len() <= JOURNAL_BUDGET as u64);
  }

  #[test]
  fn export_budget_counts_utf8_and_json_escaping_and_preserves_snapshot_and_failure() {
    let report = bound_export(
      json!({"native":{"status":"ok"}, "frontend":{"status":"unavailable"},
      "operations":{"records":[{"outcome":"failed","errorCount":1,"error":"resize failed"}]},
      "logs":{"lines":vec!["中文\"\\\n".repeat(2048);500]}}),
    );
    assert!(serde_json::to_vec(&report).unwrap().len() <= EXPORT_BUDGET);
    assert_eq!(report["operations"]["records"][0]["error"], "resize failed");
    assert_eq!(report["native"]["status"], "ok");
    assert!(report["truncation"]["logs"].as_u64().unwrap() > 0);
  }

  #[test]
  fn unavailable_values_and_invalid_frontend_fields_are_explicit_and_do_not_leak_errors() {
    assert_eq!(
      section::<bool, _>(Err("C:\\private\\file")),
      json!({"status":"readFailed"})
    );
    assert_eq!(FrontendSnapshot::default().validated()["status"], "invalid");
    assert!(serde_json::from_value::<FrontendSnapshot>(json!({"filePath":"secret"})).is_err());
    assert_eq!(
      sanitize_log("open D:\\client\\secret.wav /Users/a/audio.wav failed"),
      "open [path]"
    );
  }

  #[test]
  fn unchanged_display_environment_does_not_fill_the_timeline() {
    let directory = Directory::new();
    let state = directory.state("one", "a");
    state.environment_changed(json!({"scale":1}));
    for _ in 0..100 {
      state.environment_changed(json!({"scale":1}));
    }
    assert_eq!(state.export()["records"], json!([]));
    state.environment_changed(json!({"scale":1.5}));
    assert_eq!(state.export()["records"][0]["kind"], "display.changed");
    assert_eq!(state.export()["records"][0]["before"]["scale"], 1);
  }
}
