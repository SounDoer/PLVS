//! The light/dark state of the surface the tray icon sits on.
//!
//! On Windows the notification area follows "Choose your Windows mode"
//! (`SystemUsesLightTheme`), which is independent of both the app mode the webview reports through
//! `prefers-color-scheme` (`AppsUseLightTheme`) and a fixed PLVS theme. Choosing the tray icon from
//! the PLVS theme therefore draws a black glyph on a dark taskbar in mixed configurations.
//! macOS renders the tray icon as a template image, so it has no equivalent here.

/// Event emitted with `"light"` or `"dark"` when the taskbar mode changes.
#[cfg(target_os = "windows")]
const TASKBAR_COLOR_SCHEME_EVENT: &str = "taskbar-color-scheme-changed";

/// Returns the taskbar colour scheme and starts watching it, or `None` where the tray icon does
/// not depend on it.
#[tauri::command]
pub fn taskbar_color_scheme<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Option<&'static str> {
  #[cfg(target_os = "windows")]
  {
    windows_impl::ensure_watcher(app);
    Some(windows_impl::read())
  }
  #[cfg(not(target_os = "windows"))]
  {
    let _ = app;
    None
  }
}

/// A missing value means Windows predates the light taskbar (before 1903), whose taskbar is dark.
#[cfg(any(target_os = "windows", test))]
fn scheme_from_system_uses_light_theme(value: Option<u32>) -> &'static str {
  match value {
    Some(value) if value != 0 => "light",
    _ => "dark",
  }
}

#[cfg(target_os = "windows")]
mod windows_impl {
  use super::{scheme_from_system_uses_light_theme, TASKBAR_COLOR_SCHEME_EVENT};
  use std::sync::Once;
  use tauri::Emitter;
  use windows_sys::Win32::Foundation::ERROR_SUCCESS;
  use windows_sys::Win32::System::Registry::{RegNotifyChangeKeyValue, REG_NOTIFY_CHANGE_LAST_SET};
  use winreg::enums::{HKEY_CURRENT_USER, KEY_NOTIFY, KEY_READ};
  use winreg::RegKey;

  const PERSONALIZE_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";

  pub fn read() -> &'static str {
    let value = RegKey::predef(HKEY_CURRENT_USER)
      .open_subkey_with_flags(PERSONALIZE_KEY, KEY_READ)
      .and_then(|key| key.get_value::<u32, _>("SystemUsesLightTheme"))
      .ok();
    scheme_from_system_uses_light_theme(value)
  }

  /// Only the coordinator owns the tray and calls the command, so participants never start the
  /// thread. It blocks in the registry wait and lives as long as the process.
  pub fn ensure_watcher<R: tauri::Runtime>(app: tauri::AppHandle<R>) {
    static STARTED: Once = Once::new();
    STARTED.call_once(|| {
      let spawned = std::thread::Builder::new()
        .name("taskbar-theme".into())
        .spawn(move || watch(app));
      if let Err(error) = spawned {
        log::warn!("taskbar theme watcher: {error}");
      }
    });
  }

  fn watch<R: tauri::Runtime>(app: tauri::AppHandle<R>) {
    let key =
      match RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(PERSONALIZE_KEY, KEY_NOTIFY) {
        Ok(key) => key,
        Err(error) => {
          log::warn!("taskbar theme watcher: open {PERSONALIZE_KEY}: {error}");
          return;
        }
      };
    let mut last = read();
    loop {
      // SAFETY: `key` is an open handle with KEY_NOTIFY that outlives the call; the synchronous
      // form takes no event handle and returns after the next value change under the key.
      let status = unsafe {
        RegNotifyChangeKeyValue(
          key.raw_handle(),
          0,
          REG_NOTIFY_CHANGE_LAST_SET,
          std::ptr::null_mut(),
          0,
        )
      };
      if status != ERROR_SUCCESS {
        log::warn!("taskbar theme watcher: RegNotifyChangeKeyValue failed ({status})");
        return;
      }
      // The key also holds unrelated values (transparency, accent on taskbar); emit only when
      // the scheme itself changed.
      let next = read();
      if next != last {
        last = next;
        let _ = app.emit(TASKBAR_COLOR_SCHEME_EVENT, next);
      }
    }
  }
}

#[cfg(test)]
mod tests {
  use super::scheme_from_system_uses_light_theme;

  #[test]
  fn maps_system_uses_light_theme() {
    assert_eq!(scheme_from_system_uses_light_theme(Some(1)), "light");
    assert_eq!(scheme_from_system_uses_light_theme(Some(0)), "dark");
    assert_eq!(scheme_from_system_uses_light_theme(None), "dark");
  }
}
