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
  app_data: std::path::PathBuf,
  running: crate::update_gate::RunningInstallation,
  pending_worker: Mutex<Option<crate::update_worker::PendingWorker>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
  enabled: bool,
  installation_supported: bool,
  installation_unavailable_reason: Option<String>,
  ready: Option<ReadyUpdate>,
  fresh_session: bool,
  attempt: Option<crate::update_worker::Attempt>,
  error: Option<String>,
}

impl UpdateRuntime {
  pub fn new(cache: UpdateCache, app_data: std::path::PathBuf) -> Result<Self, String> {
    crate::update_worker::check_abandoned_attempt(cache.root())?;
    let running = crate::update_gate::RunningInstallation::enter(cache.root())?;
    cache.reconcile()?;
    Ok(Self {
      cache,
      candidates: Mutex::new(HashMap::new()),
      transfers: Mutex::new(None),
      installation_supported: installed_distribution() && installation_location_error().is_none(),
      app_data,
      running,
      pending_worker: Mutex::new(None),
    })
  }
}

fn installed_distribution() -> bool {
  if cfg!(feature = "preview-identity") || cfg!(feature = "dev-identity") {
    return false;
  }
  #[cfg(windows)]
  {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};
    if !std::env::current_exe()
      .ok()
      .and_then(|path| {
        path
          .file_name()
          .map(|name| name.to_string_lossy().eq_ignore_ascii_case("plvs.exe"))
      })
      .unwrap_or(false)
    {
      return false;
    }
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

/// A read-only volume cannot become writable through an authorization prompt. Do not
/// confuse it with an application directory that merely needs elevated permission.
fn installation_location_error() -> Option<String> {
  #[cfg(target_os = "macos")]
  {
    use std::os::unix::ffi::OsStrExt;
    let result = (|| -> Result<bool, String> {
      let exe = std::env::current_exe().map_err(|e| e.to_string())?;
      let path = std::ffi::CString::new(exe.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
      let mut volume = std::mem::MaybeUninit::<libc::statvfs>::uninit();
      // SAFETY: path is NUL-terminated and volume points to writable storage. The
      // output is initialized only after statvfs reports success.
      if unsafe { libc::statvfs(path.as_ptr(), volume.as_mut_ptr()) } != 0 {
        return Err(std::io::Error::last_os_error().to_string());
      }
      let volume = unsafe { volume.assume_init() };
      Ok(volume.f_flag & libc::ST_RDONLY != 0)
    })();
    match result {
      Ok(false) => None,
      Ok(true) => Some("Move PLVS to Applications and reopen it to enable automatic updates. The current volume is read-only.".into()),
      Err(_) => Some("PLVS could not verify its installation location. Move it to Applications and reopen it.".into()),
    }
  }
  #[cfg(not(target_os = "macos"))]
  None
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
  app: tauri::AppHandle,
) -> Result<UpdateStatus, String> {
  if window.label() != "main" {
    return Err("Updates are owned by the main window.".into());
  }
  let mut ready = if cfg!(feature = "preview-identity") {
    None
  } else {
    runtime.cache.ready()?
  };
  let mut error = None;
  if let Some(candidate) = ready.as_ref() {
    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.from_manifest(candidate.manifest.clone()) {
      Ok(Some(update)) => {
        let verified = runtime.cache.load(&candidate.id).and_then(|(_, bytes)| {
          if candidate.version != update.version {
            return Err("Cached update version metadata is inconsistent.".into());
          }
          update.verify_cached(&bytes).map_err(|e| e.to_string())
        });
        if let Err(problem) = verified {
          runtime.cache.cancel()?;
          ready = None;
          error = Some(problem);
        }
      }
      Ok(None) => {
        runtime.cache.cancel()?;
        ready = None;
      }
      Err(problem) => {
        runtime.cache.cancel()?;
        ready = None;
        error = Some(problem.to_string());
      }
    }
  }
  let mut attempt = crate::update_worker::read_attempt(runtime.cache.root())?;
  if let Some(previous) = attempt.as_mut() {
    if ready
      .as_ref()
      .is_some_and(|ready| ready.version == previous.version)
      && matches!(previous.phase.as_str(), "finished" | "installing")
    {
      previous.phase = "failed".into();
      previous.error = Some("The previous installation did not replace this running version. You can retry from update details.".into());
      crate::update_worker::save_attempt(runtime.cache.root(), previous)?;
    }
  }
  Ok(UpdateStatus {
    enabled: !cfg!(feature = "preview-identity"),
    installation_supported: runtime.installation_supported
      && installation_location_error().is_none(),
    installation_unavailable_reason: installation_location_error(),
    ready,
    fresh_session: runtime.running.fresh_session,
    attempt,
    error,
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
  let mut candidates = runtime
    .candidates
    .lock()
    .map_err(|_| "Update state unavailable.")?;
  if candidates.len() >= 8 {
    if let Some(expired) = candidates.keys().next().cloned() {
      candidates.remove(&expired);
    }
  }
  candidates.insert(id, candidate);
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
  if let Some(reason) = installation_location_error() {
    return Err(reason);
  }
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
    .unwrap_or_else(|_| Err("Update download canceled.".to_string()));
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
  if runtime
    .pending_worker
    .lock()
    .map_err(|_| "Update state unavailable.")?
    .is_some()
  {
    return Err("Installation has been confirmed.".into());
  }
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

#[tauri::command]
pub async fn update_prepare_install(
  window: WebviewWindow,
  app: tauri::AppHandle,
  package_id: String,
  startup: bool,
) -> Result<String, String> {
  authorize(&window, &app)?;
  tauri::async_runtime::spawn_blocking(move || {
    let runtime = app.state::<UpdateRuntime>();
    if let Some(reason) = installation_location_error() {
      return Err(reason);
    }
    if !runtime.installation_supported {
      return Err("This distribution requires a manual download.".into());
    }
    let mut pending = runtime
      .pending_worker
      .lock()
      .map_err(|_| "Update state unavailable.")?;
    if pending.is_some() {
      return Err("Installation is already being prepared.".into());
    }
    let (ready, bytes) = runtime.cache.load(&package_id)?;
    let update = app
      .updater()
      .map_err(|e| e.to_string())?
      .from_manifest(ready.manifest)
      .map_err(|e| e.to_string())?
      .ok_or("The update is no longer newer.")?;
    update.verify_cached(&bytes).map_err(|e| e.to_string())?;
    if ready.version != update.version {
      return Err("Cached update version metadata is inconsistent.".into());
    }
    let mut nonce = [0; 16];
    getrandom::fill(&mut nonce).map_err(|e| e.to_string())?;
    let nonce = nonce
      .iter()
      .map(|byte| format!("{byte:02x}"))
      .collect::<String>();
    let ticket = crate::update_worker::Ticket {
      nonce: nonce.clone(),
      package_id,
      app_data: runtime.app_data.clone(),
      target: std::env::current_exe()
        .map_err(|e| e.to_string())?
        .canonicalize()
        .map_err(|e| e.to_string())?,
      args: crate::update_worker::relaunch_args(std::env::args().skip(1)),
      identity: env!("PLVS_APP_ID").into(),
    };
    let mut worker = crate::update_worker::spawn(runtime.cache.root(), ticket)?;
    // The helper now owns the entry gate, so this registry snapshot cannot race a new launch.
    if startup {
      let registry = app.state::<crate::coordinator::InstanceRegistry>();
      let eligibility = registry.remove_stale().and_then(|_| registry.list());
      if !runtime.running.fresh_session || !matches!(&eligibility, Ok(peers) if peers.len() == 1) {
        crate::update_worker::abort(&mut worker);
        eligibility?;
        return Err(
          "Another workbench is active. Reopen update details when it has closed.".into(),
        );
      }
    }
    *pending = Some(worker);
    Ok(nonce)
  })
  .await
  .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn update_abort_install(
  window: WebviewWindow,
  app: tauri::AppHandle,
  token: String,
) -> Result<(), String> {
  authorize(&window, &app)?;
  let runtime = app.state::<UpdateRuntime>();
  let mut pending = runtime
    .pending_worker
    .lock()
    .map_err(|_| "Update state unavailable.")?;
  if pending
    .as_ref()
    .is_some_and(|worker| worker.ticket.nonce == token)
  {
    if let Some(mut worker) = pending.take() {
      crate::update_worker::abort(&mut worker);
    }
  }
  Ok(())
}

#[tauri::command]
pub fn update_commit_install(
  window: WebviewWindow,
  app: tauri::AppHandle,
  token: String,
) -> Result<(), String> {
  authorize(&window, &app)?;
  let runtime = app.state::<UpdateRuntime>();
  let mut pending = runtime
    .pending_worker
    .lock()
    .map_err(|_| "Update state unavailable.")?;
  let worker = pending
    .as_mut()
    .filter(|worker| worker.ticket.nonce == token)
    .ok_or("Installation confirmation expired.")?;
  crate::update_worker::commit(runtime.cache.root(), worker)?;
  app.exit(0);
  Ok(())
}
