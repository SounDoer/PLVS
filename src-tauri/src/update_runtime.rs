//! Native update ownership. The frontend exchanges opaque candidate IDs, never manifests or paths.
use crate::{
  coordinator::CoordinatorRole,
  persistence::commands::PersistenceRuntime,
  update_cache::{ReadyUpdate, UpdateCache},
};
use serde::Serialize;
use std::{collections::HashMap, sync::Mutex, time::Duration};
use tauri::{Emitter, Manager, State, WebviewWindow};
use tauri_plugin_updater::{Update, UpdaterExt};

pub struct UpdateRuntime {
  cache: UpdateCache,
  candidates: Mutex<HashMap<String, Update>>,
  transfers: Mutex<Option<(u64, futures_util::future::AbortHandle)>>,
  pub installation_supported: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
  enabled: bool,
  installation_supported: bool,
  ready: Option<ReadyUpdate>,
}

impl UpdateRuntime {
  pub fn new(cache: UpdateCache) -> Self {
    Self {
      cache,
      candidates: Mutex::new(HashMap::new()),
      transfers: Mutex::new(None),
      installation_supported: installed_distribution(),
    }
  }
}

fn installed_distribution() -> bool {
  if cfg!(feature = "preview-identity") || cfg!(feature = "dev-identity") {
    return false;
  }
  #[cfg(windows)]
  {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};
    let installed = RegKey::predef(HKEY_CURRENT_USER)
      .open_subkey(r"Software\SounDoer\PLVS")
      .and_then(|key| key.get_value::<String, _>("InstallDir"))
      .ok();
    let actual = std::env::current_exe()
      .ok()
      .and_then(|path| path.parent().and_then(|p| p.canonicalize().ok()));
    installed
      .and_then(|path| std::path::Path::new(&path).canonicalize().ok())
      .zip(actual)
      .is_some_and(|(registered, actual)| registered == actual)
  }
  #[cfg(target_os = "macos")]
  {
    std::env::current_exe().ok().is_some_and(|path| {
      path
        .components()
        .any(|part| part.as_os_str().to_string_lossy().ends_with(".app"))
    })
  }
  #[cfg(not(any(windows, target_os = "macos")))]
  false
}

fn authorize(window: &WebviewWindow, app: &tauri::AppHandle) -> Result<(), String> {
  if window.label() != "main" {
    return Err("Updates are owned by the main window.".into());
  }
  if cfg!(feature = "preview-identity") {
    return Err("Updates are unavailable in Preview.".into());
  }
  if !app.state::<CoordinatorRole>().is_coordinator() {
    return Err("Updates are owned by the coordinator.".into());
  }
  Ok(())
}

fn automatic_allowed(app: &tauri::AppHandle, download: bool) -> Result<(), String> {
  let preferences = app
    .state::<PersistenceRuntime>()
    .global_preference("updatePreferences")?
    .map(|entry| entry.value)
    .unwrap_or_default();
  if preferences["choiceMade"] != true
    || preferences["autoCheck"] != true
    || (download && preferences["autoDownload"] != true)
  {
    return Err("Automatic updates are disabled.".into());
  }
  Ok(())
}

#[tauri::command]
pub fn update_status(
  window: WebviewWindow,
  runtime: State<'_, UpdateRuntime>,
) -> Result<UpdateStatus, String> {
  if window.label() != "main" {
    return Err("Updates are owned by the main window.".into());
  }
  Ok(UpdateStatus {
    enabled: !cfg!(feature = "preview-identity"),
    installation_supported: runtime.installation_supported,
    ready: runtime.cache.ready()?,
  })
}

#[tauri::command]
pub async fn update_check(
  window: WebviewWindow,
  app: tauri::AppHandle,
  automatic: bool,
) -> Result<Option<ReadyUpdate>, String> {
  authorize(&window, &app)?;
  if automatic {
    automatic_allowed(&app, false)?;
  }
  let runtime = app.state::<UpdateRuntime>();
  let generation = runtime.cache.generation()?;
  let candidate = app
    .updater_builder()
    .timeout(Duration::from_secs(30))
    .build()
    .map_err(|e| e.to_string())?
    .check()
    .await
    .map_err(|e| e.to_string())?;
  if automatic {
    automatic_allowed(&app, false)?;
  }
  if generation != runtime.cache.generation()? {
    return Ok(None);
  }
  let Some(candidate) = candidate else {
    return Ok(None);
  };
  let mut nonce = [0; 16];
  getrandom::fill(&mut nonce).map_err(|e| e.to_string())?;
  let id = nonce
    .iter()
    .map(|byte| format!("{byte:02x}"))
    .collect::<String>();
  let descriptor = ReadyUpdate {
    id: id.clone(),
    version: candidate.version.clone(),
    manifest: candidate.raw_json.clone(),
  };
  runtime
    .candidates
    .lock()
    .map_err(|_| "Update state unavailable.")?
    .insert(id, candidate);
  Ok(Some(descriptor))
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
  received: u64,
  total: Option<u64>,
}

#[tauri::command]
pub async fn update_download(
  window: WebviewWindow,
  app: tauri::AppHandle,
  candidate_id: String,
  automatic: bool,
) -> Result<Option<ReadyUpdate>, String> {
  authorize(&window, &app)?;
  if automatic {
    automatic_allowed(&app, true)?;
  }
  let runtime = app.state::<UpdateRuntime>();
  if !runtime.installation_supported {
    return Err("This distribution requires a manual download.".into());
  }
  let _lease = runtime.cache.download_lease()?;
  let generation = runtime.cache.generation()?;
  let mut candidate = runtime
    .candidates
    .lock()
    .map_err(|_| "Update state unavailable.")?
    .get(&candidate_id)
    .cloned()
    .ok_or("The update selection has expired. Check again.")?;
  candidate.timeout = Some(Duration::from_secs(600));
  let cache = runtime.cache.clone();
  let task_app = app.clone();
  let (abort, registration) = futures_util::future::AbortHandle::new_pair();
  *runtime
    .transfers
    .lock()
    .map_err(|_| "Update state unavailable.")? = Some((generation, abort));
  if generation != runtime.cache.generation()? {
    return Ok(None);
  }
  let task = futures_util::future::Abortable::new(
    async move {
      let mut received = 0;
      let bytes = candidate
        .download(
          |length, total| {
            received += length as u64;
            let _ = task_app.emit_to(
              "main",
              "update-download-progress",
              DownloadProgress { received, total },
            );
          },
          || {},
        )
        .await
        .map_err(|e| e.to_string())?;
      if automatic {
        automatic_allowed(&task_app, true)?;
      }
      candidate.verify_cached(&bytes).map_err(|e| e.to_string())?;
      cache.publish_verified(generation, candidate.version, candidate.raw_json, &bytes)
    },
    registration,
  );
  let result = task
    .await
    .map_err(|_| "Update download canceled.".to_string())?;
  let mut transfer = runtime
    .transfers
    .lock()
    .map_err(|_| "Update state unavailable.")?;
  if transfer
    .as_ref()
    .is_some_and(|(active, _)| *active == generation)
  {
    transfer.take();
  }
  result
}

#[tauri::command]
pub fn update_cancel(window: WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
  authorize(&window, &app)?;
  let runtime = app.state::<UpdateRuntime>();
  runtime.cache.cancel()?;
  if let Some((_, task)) = runtime
    .transfers
    .lock()
    .map_err(|_| "Update state unavailable.")?
    .take()
  {
    task.abort();
  }
  Ok(())
}
