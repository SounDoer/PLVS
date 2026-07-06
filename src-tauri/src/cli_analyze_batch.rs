use std::collections::VecDeque;
use std::fs;
use std::path::Path;
use std::sync::{mpsc, Arc, Mutex};
use std::thread;

use serde::{Deserialize, Serialize};

use crate::cli_analyze::{run_analyze, CliAnalyzeReport, CliAnalyzeStatus};

pub const DEFAULT_BATCH_CONCURRENCY: usize = 2;
pub const MAX_BATCH_CONCURRENCY: usize = 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CliAnalyzeBatchStatus {
  Ok,
  Warning,
  Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliAnalyzeBatchSummary {
  pub total: usize,
  pub ok: usize,
  pub error: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliAnalyzeBatchResult {
  pub path: String,
  pub status: CliAnalyzeStatus,
  pub report: CliAnalyzeReport,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliAnalyzeBatchReport {
  pub schema_version: u32,
  pub command: String,
  pub status: CliAnalyzeBatchStatus,
  pub concurrency: usize,
  pub summary: CliAnalyzeBatchSummary,
  pub results: Vec<CliAnalyzeBatchResult>,
}

#[derive(Debug, Deserialize)]
struct AnalyzeBatchManifest {
  files: Vec<String>,
}

pub fn read_manifest(path: &Path) -> Result<Vec<String>, String> {
  let contents = fs::read_to_string(path)
    .map_err(|err| format!("Unable to read analyze-batch manifest: {err}"))?;
  let contents = contents.trim_start_matches('\u{feff}');
  let manifest: AnalyzeBatchManifest = serde_json::from_str(contents)
    .map_err(|err| format!("Unable to parse analyze-batch manifest JSON: {err}"))?;
  Ok(manifest.files)
}

pub fn normalize_concurrency(concurrency: usize) -> usize {
  concurrency.clamp(1, MAX_BATCH_CONCURRENCY)
}

pub fn run_analyze_batch(paths: Vec<String>, concurrency: usize) -> CliAnalyzeBatchReport {
  let total = paths.len();
  let concurrency = normalize_concurrency(concurrency).min(total.max(1));
  let queue = Arc::new(Mutex::new(
    paths.into_iter().enumerate().collect::<VecDeque<_>>(),
  ));
  let (tx, rx) = mpsc::channel();
  let worker_count = concurrency.min(total);
  let mut workers = Vec::with_capacity(worker_count);

  for _ in 0..worker_count {
    let queue = queue.clone();
    let tx = tx.clone();
    workers.push(thread::spawn(move || loop {
      let next = {
        let mut guard = queue.lock().expect("analyze-batch queue lock poisoned");
        guard.pop_front()
      };
      let Some((index, path)) = next else {
        break;
      };

      let report = run_analyze(&path);
      let status = report.status();
      let _ = tx.send((
        index,
        CliAnalyzeBatchResult {
          path,
          status,
          report,
        },
      ));
    }));
  }
  drop(tx);

  let mut results: Vec<Option<CliAnalyzeBatchResult>> = vec![None; total];
  for (index, result) in rx {
    results[index] = Some(result);
  }

  for worker in workers {
    let _ = worker.join();
  }

  let results: Vec<CliAnalyzeBatchResult> = results.into_iter().flatten().collect();
  let ok = results
    .iter()
    .filter(|result| result.status == CliAnalyzeStatus::Ok)
    .count();
  let error = total.saturating_sub(ok);
  let status = if error == 0 {
    CliAnalyzeBatchStatus::Ok
  } else if ok == 0 {
    CliAnalyzeBatchStatus::Error
  } else {
    CliAnalyzeBatchStatus::Warning
  };

  CliAnalyzeBatchReport {
    schema_version: 1,
    command: "analyze-batch".to_string(),
    status,
    concurrency,
    summary: CliAnalyzeBatchSummary { total, ok, error },
    results,
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn normalizes_concurrency_to_supported_range() {
    assert_eq!(normalize_concurrency(0), 1);
    assert_eq!(normalize_concurrency(2), 2);
    assert_eq!(
      normalize_concurrency(MAX_BATCH_CONCURRENCY + 10),
      MAX_BATCH_CONCURRENCY
    );
  }

  #[test]
  fn reads_manifest_files() {
    let path = std::env::temp_dir().join(format!(
      "plvs-analyze-batch-manifest-{}.json",
      std::process::id()
    ));
    fs::write(&path, r#"{"files":["a.wav","b.wav"]}"#).expect("write manifest");

    let files = read_manifest(&path).expect("manifest should parse");
    let _ = fs::remove_file(&path);

    assert_eq!(files, vec!["a.wav".to_string(), "b.wav".to_string()]);
  }

  #[test]
  fn reads_utf8_bom_manifest_files() {
    let path = std::env::temp_dir().join(format!(
      "plvs-analyze-batch-bom-manifest-{}.json",
      std::process::id()
    ));
    fs::write(&path, "\u{feff}{\"files\":[\"a.wav\"]}").expect("write manifest");

    let files = read_manifest(&path).expect("manifest should parse");
    let _ = fs::remove_file(&path);

    assert_eq!(files, vec!["a.wav".to_string()]);
  }
}
