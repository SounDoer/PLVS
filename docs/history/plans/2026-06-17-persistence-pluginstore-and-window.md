# plugin-store Backend + Rust First-Paint Injection + Window Geometry (Plan 3 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `plvs-settings.json` the single source of truth in the shipped app — add a production plugin-store backend behind the Plan 1 seam, have Rust read it before first paint and inject it so the sync JS stores hydrate without a flash, and persist/restore window geometry (size, position, maximized) with off-screen clamping.

**Architecture:** `createDomainStore` is synchronous, but the plugin-store JS API is async — so the production backend is a **synchronous in-memory cache seeded at boot from `window.__PLVS_INITIAL_STATE__`** (which Rust injects pre-paint), with **fire-and-forget** async persistence to `plvs-settings.json`. Rust reads the store in `setup`, builds the main window in code with an initialization script carrying the injected state, applies saved window bounds (clamped to a visible monitor) while the window is hidden, then shows it. Window move/resize events write bounds back to the store.

**Tech Stack:** JavaScript (`@tauri-apps/plugin-store`), Rust (Tauri v2, `tauri-plugin-store`, `tauri` window/monitor APIs), Vitest.

**Spec:** `docs/superpowers/specs/2026-06-17-persistence-unification-design.md`
**Depends on:** Plan 1 (`src/persistence/*`) and Plan 2 (consumers on the domain stores; `settings`/`workspace` are the live keys).

**Store layout in `plvs-settings.json` (production):** top-level keys `settings` and `workspace`, each an object — the same shape the domain stores use. (`captureDeviceId`, `clearShortcut`, `clearGlobal` already live as flat keys in this same file via `capturePrefs.js`/`clearShortcutPrefs.js`; they already satisfy "single file." Nesting them under the `settings` object is a minor consistency follow-up and is **out of scope here** — see "Deferred" below.)

> **Version note:** This plan uses Tauri v2 + `tauri-plugin-store` v2 APIs. Where a call is version-sensitive (the Rust `StoreExt`/`store` accessor, `WebviewWindowBuilder`, `available_monitors`), a verification step says exactly what to confirm against the installed crate (`src-tauri/Cargo.toml`: `tauri = 2`, `tauri-plugin-store = "2.4.3"`).

---

## File Structure (Plan 3)

- Create `src/persistence/pluginStoreBackend.js` — sync in-memory cache seeded from `window.__PLVS_INITIAL_STATE__`; fire-and-forget async persist via `@tauri-apps/plugin-store`.
- Create `src/persistence/pluginStoreBackend.test.js`
- Modify `src/persistence/index.js` — select backend by environment (`isTauri()` → plugin-store, else localStorage).
- Modify `src-tauri/tauri.conf.json` — make the main window not auto-create (built in code) or start hidden.
- Modify `src-tauri/src/lib.rs` — read store, build window with init script, restore+clamp bounds, show; persist bounds on move/resize.
- Create `src-tauri/src/window_state.rs` — bounds load/save + off-screen clamp helpers (unit-tested in Rust).
- Modify `src-tauri/src/main.rs` if module registration is needed.

---

## Task 1: Sync plugin-store backend (JS)

The backend satisfies the Plan 1 contract synchronously by caching in memory; persistence to the file is async and fire-and-forget. The cache is seeded from `window.__PLVS_INITIAL_STATE__` (set by Rust before the page runs).

**Files:**
- Create: `src/persistence/pluginStoreBackend.js`
- Test: `src/persistence/pluginStoreBackend.test.js`

- [ ] **Step 1: Write the failing test**

```js
// src/persistence/pluginStoreBackend.test.js
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const saved = [];
vi.mock("@tauri-apps/plugin-store", () => ({
  Store: {
    load: vi.fn(async () => ({
      set: vi.fn(async (k, v) => saved.push([k, v])),
      save: vi.fn(async () => {}),
      delete: vi.fn(async (k) => saved.push(["__delete__", k])),
    })),
  },
}));

describe("pluginStoreBackend", () => {
  beforeEach(() => {
    saved.length = 0;
    globalThis.window = globalThis.window || {};
    window.__PLVS_INITIAL_STATE__ = { "plvs:settings": { referenceLufs: -20 } };
  });
  afterEach(() => {
    delete window.__PLVS_INITIAL_STATE__;
    vi.clearAllMocks();
  });

  it("get reads synchronously from the injected initial state", async () => {
    const { createPluginStoreBackend } = await import("./pluginStoreBackend.js");
    const backend = createPluginStoreBackend();
    expect(backend.get("plvs:settings")).toEqual({ referenceLufs: -20 });
    expect(backend.get("plvs:workspace")).toBeNull();
  });

  it("set updates the cache synchronously and schedules an async persist", async () => {
    const { createPluginStoreBackend } = await import("./pluginStoreBackend.js");
    const backend = createPluginStoreBackend();
    backend.set("plvs:workspace", { activePresetId: "lls" });
    expect(backend.get("plvs:workspace")).toEqual({ activePresetId: "lls" }); // sync
    await new Promise((r) => setTimeout(r, 0)); // let the fire-and-forget persist run
    expect(saved).toContainEqual(["plvs:workspace", { activePresetId: "lls" }]);
  });

  it("remove clears the cache and schedules a delete", async () => {
    const { createPluginStoreBackend } = await import("./pluginStoreBackend.js");
    const backend = createPluginStoreBackend();
    backend.remove("plvs:settings");
    expect(backend.get("plvs:settings")).toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    expect(saved).toContainEqual(["__delete__", "plvs:settings"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/persistence/pluginStoreBackend.test.js`
Expected: FAIL — cannot resolve `./pluginStoreBackend.js`.

- [ ] **Step 3: Write the implementation**

```js
// src/persistence/pluginStoreBackend.js
/**
 * Production backend: the single source of truth is plvs-settings.json (plugin-store).
 *
 * createDomainStore is synchronous, but the plugin-store JS API is async, so this backend
 * holds a synchronous in-memory cache seeded from window.__PLVS_INITIAL_STATE__ (injected
 * by Rust before first paint) and persists writes asynchronously, fire-and-forget. Reads
 * never hit disk; first paint is flash-free because the seed is already present.
 */
const STORE_FILE = "plvs-settings.json";

export function createPluginStoreBackend() {
  const seed =
    (typeof window !== "undefined" && window.__PLVS_INITIAL_STATE__) || {};
  const cache = new Map(Object.entries(seed));

  let storePromise = null;
  function store() {
    if (!storePromise) {
      storePromise = import("@tauri-apps/plugin-store").then(({ Store }) => Store.load(STORE_FILE));
    }
    return storePromise;
  }
  function persist(key, value) {
    store()
      .then(async (s) => {
        await s.set(key, value);
        await s.save();
      })
      .catch(() => {});
  }
  function persistDelete(key) {
    store()
      .then(async (s) => {
        await s.delete(key);
        await s.save();
      })
      .catch(() => {});
  }

  return {
    get(key) {
      const v = cache.get(key);
      return v && typeof v === "object" && !Array.isArray(v) ? v : null;
    },
    set(key, value) {
      cache.set(key, value);
      persist(key, value);
    },
    remove(key) {
      cache.delete(key);
      persistDelete(key);
    },
    subscribe() {
      // Single-window app; the file is only written by this process. No cross-context events.
      return () => {};
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/persistence/pluginStoreBackend.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/persistence/pluginStoreBackend.js src/persistence/pluginStoreBackend.test.js
git commit -m "feat(persistence): add sync-cache plugin-store backend"
```

---

## Task 2: Select the backend by environment

**Files:**
- Modify: `src/persistence/index.js`
- Test: `src/persistence/index.env.test.js` (create)

- [ ] **Step 1: Write the failing test**

```js
// src/persistence/index.env.test.js
import { afterEach, describe, expect, it, vi } from "vitest";

describe("persistence backend selection", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete window.__PLVS_INITIAL_STATE__;
  });

  it("uses the plugin-store backend under Tauri", async () => {
    vi.doMock("../ipc/env.js", () => ({ isTauri: () => true }));
    vi.doMock("@tauri-apps/plugin-store", () => ({
      Store: { load: vi.fn(async () => ({ set: vi.fn(), save: vi.fn(), delete: vi.fn() })) },
    }));
    window.__PLVS_INITIAL_STATE__ = { "plvs:settings": { referenceLufs: -19 } };
    const { settingsStore } = await import("./index.js");
    expect(settingsStore.read()).toEqual({ referenceLufs: -19 });
  });

  it("uses localStorage when not under Tauri", async () => {
    vi.doMock("../ipc/env.js", () => ({ isTauri: () => false }));
    localStorage.setItem("plvs:settings", JSON.stringify({ referenceLufs: -12 }));
    const { settingsStore } = await import("./index.js");
    expect(settingsStore.read()).toEqual({ referenceLufs: -12 });
    localStorage.clear();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/persistence/index.env.test.js`
Expected: FAIL — `index.js` always uses localStorage.

- [ ] **Step 3: Update `index.js` to select the backend**

Replace the backend construction in `src/persistence/index.js`. Old:

```js
import { createLocalStorageBackend } from "./localStorageBackend.js";
import { createDomainStore } from "./createDomainStore.js";

const backend = createLocalStorageBackend();
```

New:

```js
import { createLocalStorageBackend } from "./localStorageBackend.js";
import { createPluginStoreBackend } from "./pluginStoreBackend.js";
import { createDomainStore } from "./createDomainStore.js";
import { isTauri } from "../ipc/env.js";

const backend = isTauri() ? createPluginStoreBackend() : createLocalStorageBackend();
```

(The rest of `index.js` — the two `createDomainStore` calls, `exportAll`, `resetAll` — is unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/persistence/index.env.test.js src/persistence/index.test.js`
Expected: PASS. (`index.test.js` runs under jsdom where `isTauri()` is false → localStorage, unchanged.)

- [ ] **Step 5: Commit**

```bash
git add src/persistence/index.js src/persistence/index.env.test.js
git commit -m "feat(persistence): select plugin-store backend under Tauri"
```

---

## Task 3: Rust — bounds + clamp helpers (`window_state.rs`)

Pure logic, unit-tested in Rust: the persisted bounds shape and the off-screen clamp. No Tauri types here so it tests without a running app.

**Files:**
- Create: `src-tauri/src/window_state.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod window_state;`)

- [ ] **Step 1: Write the failing Rust test + types**

```rust
// src-tauri/src/window_state.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct WindowBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    // JS shape is `isMaximized`; rename so the JS/Rust JSON matches exactly.
    #[serde(rename = "isMaximized", default)]
    pub is_maximized: bool,
}

/// A monitor's visible rectangle (position + size), in physical pixels.
#[derive(Debug, Clone, Copy)]
pub struct MonitorRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// Returns the visible-overlap area (px²) between the window and a monitor.
fn overlap_area(b: &WindowBounds, m: &MonitorRect) -> i64 {
    let bx2 = b.x as i64 + b.width as i64;
    let by2 = b.y as i64 + b.height as i64;
    let mx2 = m.x as i64 + m.width as i64;
    let my2 = m.y as i64 + m.height as i64;
    let ix = (bx2.min(mx2) - (b.x as i64).max(m.x as i64)).max(0);
    let iy = (by2.min(my2) - (b.y as i64).max(m.y as i64)).max(0);
    ix * iy
}

/// If the window is mostly off-screen (less than 1/8 of its area visible on any monitor),
/// re-center it on the first monitor. Otherwise return it unchanged.
pub fn clamp_to_visible(b: WindowBounds, monitors: &[MonitorRect]) -> WindowBounds {
    if monitors.is_empty() {
        return b;
    }
    let area = b.width as i64 * b.height as i64;
    let visible = monitors.iter().map(|m| overlap_area(&b, m)).max().unwrap_or(0);
    if visible * 8 >= area {
        return b;
    }
    let m = monitors[0];
    let x = m.x + ((m.width as i32 - b.width as i32) / 2).max(0);
    let y = m.y + ((m.height as i32 - b.height as i32) / 2).max(0);
    WindowBounds { x, y, ..b }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mon() -> Vec<MonitorRect> {
        vec![MonitorRect { x: 0, y: 0, width: 1920, height: 1080 }]
    }

    #[test]
    fn keeps_a_fully_visible_window() {
        let b = WindowBounds { x: 100, y: 100, width: 1280, height: 800, is_maximized: false };
        assert_eq!(clamp_to_visible(b, &mon()), b);
    }

    #[test]
    fn recenters_a_window_on_a_gone_monitor() {
        let b = WindowBounds { x: 5000, y: 5000, width: 1280, height: 800, is_maximized: false };
        let c = clamp_to_visible(b, &mon());
        assert_eq!(c.width, 1280);
        assert_eq!(c.height, 800);
        assert_eq!(c.x, (1920 - 1280) / 2);
        assert_eq!(c.y, (1080 - 800) / 2);
    }

    #[test]
    fn empty_monitor_list_is_a_noop() {
        let b = WindowBounds { x: 100, y: 100, width: 1280, height: 800, is_maximized: false };
        assert_eq!(clamp_to_visible(b, &[]), b);
    }
}
```

Add to `src-tauri/src/lib.rs` near the other `mod` lines:

```rust
mod window_state;
```

- [ ] **Step 2: Run the Rust test to verify it fails, then passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml window_state`
Expected: compiles and PASSES (3 tests). If `serde` derive is unavailable, confirm `serde = { version = "1", features = ["derive"] }` is in `src-tauri/Cargo.toml` (it is used elsewhere in the crate).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/window_state.rs src-tauri/src/lib.rs
git commit -m "feat(window): add window-bounds clamp helper with tests"
```

---

## Task 4: Rust — read store + inject initial state + restore window (pre-paint)

Build the main window in `setup` with an initialization script carrying the persisted state, start it hidden, apply clamped bounds, then show. The injected object is keyed by domain name so the JS `pluginStoreBackend` cache hydrates directly.

**Files:**
- Modify: `src-tauri/tauri.conf.json` (stop auto-creating the window; it is built in code)
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Remove the auto-created window from config**

In `src-tauri/tauri.conf.json`, set `app.windows` to an empty array (the window is created in Rust):

```json
  "app": {
    "windows": [],
    "security": { ... unchanged ... }
  }
```

- [ ] **Step 2: Verify the Tauri v2 store + window-builder APIs**

Before writing code, confirm against the installed crates:
- `tauri_plugin_store::StoreExt` provides `app.store("plvs-settings.json") -> Result<Arc<Store>, _>` (v2). Confirm with: `cargo doc --no-deps -p tauri-plugin-store` or the crate source under `~/.cargo`. The store's `get(key) -> Option<serde_json::Value>` is used to read `settings`/`workspace`.
- `tauri::WebviewWindowBuilder::new(app, "main", WebviewUrl::default())` with `.initialization_script(&str)`, `.inner_size(f64,f64)`, `.position(f64,f64)`, `.visible(bool)`, `.title(&str)`, `.build()` (v2).
- `window.available_monitors() -> Result<Vec<Monitor>>`, `Monitor::position()/size()`.

Note the exact method names in a comment if they differ; the structure below is stable for Tauri 2.x.

- [ ] **Step 3: Add the setup logic in `lib.rs`**

Add imports near the top of `src-tauri/src/lib.rs`:

```rust
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_store::StoreExt;
use crate::window_state::{clamp_to_visible, MonitorRect, WindowBounds};
```

Inside `.setup(|app| { ... })`, before the device-watch thread, build the window:

```rust
      // --- Persistence: read store, inject initial state, restore window (pre-paint) ---
      let store = app.store("plvs-settings.json").map_err(|e| format!("store load: {e}"))?;

      let settings = store.get("settings").unwrap_or(serde_json::json!({}));
      let workspace = store.get("workspace").unwrap_or(serde_json::json!({}));
      let initial = serde_json::json!({
        "plvs:settings": settings,
        "plvs:workspace": workspace,
      });
      let init_script = format!("window.__PLVS_INITIAL_STATE__ = {};", initial);

      let saved_bounds: Option<WindowBounds> = settings
        .get("windowBounds")
        .and_then(|v| serde_json::from_value(v.clone()).ok());

      let mut builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
        .title("PLVS")
        .resizable(true)
        .visible(false)
        .initialization_script(&init_script);

      if let Some(b) = saved_bounds {
        builder = builder
          .inner_size(b.width as f64, b.height as f64)
          .position(b.x as f64, b.y as f64);
      } else {
        builder = builder.inner_size(1280.0, 860.0);
      }

      let window = builder.build().map_err(|e| format!("window build: {e}"))?;

      // Clamp against the monitors actually present now, then show.
      if let Some(b) = saved_bounds {
        let monitors: Vec<MonitorRect> = window
          .available_monitors()
          .unwrap_or_default()
          .iter()
          .map(|m| MonitorRect {
            x: m.position().x,
            y: m.position().y,
            width: m.size().width,
            height: m.size().height,
          })
          .collect();
        let clamped = clamp_to_visible(b, &monitors);
        if clamped != b {
          let _ = window.set_position(tauri::PhysicalPosition::new(clamped.x, clamped.y));
        }
        if b.is_maximized {
          let _ = window.maximize();
        }
      }
      let _ = window.show();
```

Keep the existing device-watch thread (it uses `app.handle()`), and keep `Ok(())` at the end of `setup`.

- [ ] **Step 4: Build and run the desktop app**

Run: `npm run desktop`
Expected: app launches showing the persisted theme/layout with **no flash**, at the saved size/position. First run (empty store) opens at 1280×860.

- [ ] **Step 5: Manual verification**

- Resize/move the window, fully quit, relaunch → it returns to the same size/position.
- Move it onto a second monitor, quit, unplug/disable that monitor, relaunch → it re-centers on the primary monitor (not off-screen).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/tauri.conf.json src-tauri/src/lib.rs
git commit -m "feat(window): inject persisted state pre-paint and restore window bounds"
```

---

## Task 5: Rust — persist window geometry on move/resize

Write bounds back to `settings.windowBounds` in the store. Debounce by coalescing events through a short-lived flush so rapid drags don't thrash the file.

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/window_state.rs` (add a `save_bounds` helper)

- [ ] **Step 1: Add a save helper in `window_state.rs`**

```rust
use std::sync::Arc;
use tauri::Manager;
use tauri_plugin_store::Store;

/// Read the current outer bounds of the window and write them under settings.windowBounds.
pub fn save_window_bounds<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    let is_maximized = window.is_maximized().unwrap_or(false);
    // When maximized, persist the flag but keep the last normal size/position already on file.
    let store = match window.app_handle().store("plvs-settings.json") {
        Ok(s) => s,
        Err(_) => return,
    };
    let mut settings = store.get("settings").unwrap_or(serde_json::json!({}));
    let prev: Option<WindowBounds> = settings
        .get("windowBounds")
        .and_then(|v| serde_json::from_value(v.clone()).ok());

    let bounds = if is_maximized {
        match prev {
            Some(b) => WindowBounds { is_maximized: true, ..b },
            None => return,
        }
    } else {
        let pos = window.outer_position().ok();
        let size = window.inner_size().ok();
        match (pos, size) {
            (Some(p), Some(s)) => WindowBounds {
                x: p.x,
                y: p.y,
                width: s.width,
                height: s.height,
                is_maximized: false,
            },
            _ => return,
        }
    };

    if let serde_json::Value::Object(ref mut map) = settings {
        map.insert("windowBounds".into(), serde_json::to_value(bounds).unwrap_or_default());
    } else {
        settings = serde_json::json!({ "windowBounds": bounds });
    }
    let _ = store.set("settings", settings);
    let _ = store.save();
    let _: Arc<Store<R>> = store; // keep the Arc type explicit for readers
}
```

> Verify `outer_position`/`inner_size`/`is_maximized`/`maximize`/`set_position` exist on `WebviewWindow` in the installed Tauri 2.x (they are stable v2 APIs). Adjust `Store<R>` generic to the crate's actual signature if needed.

- [ ] **Step 2: Wire a debounced save on window events in `lib.rs`**

After `let _ = window.show();` in `setup`, attach an event handler with a coalescing flush:

```rust
      // Persist geometry on move/resize, debounced via a dirty flag + short flush thread.
      use std::sync::atomic::{AtomicBool, Ordering};
      use std::sync::Arc as StdArc;
      let dirty = StdArc::new(AtomicBool::new(false));
      {
        let dirty = dirty.clone();
        window.on_window_event(move |event| {
          if matches!(event, tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_)) {
            dirty.store(true, Ordering::Relaxed);
          }
        });
      }
      {
        let dirty = dirty.clone();
        let win = window.clone();
        std::thread::Builder::new()
          .name("window-state-flush".into())
          .spawn(move || loop {
            std::thread::sleep(Duration::from_millis(400));
            if dirty.swap(false, Ordering::Relaxed) {
              crate::window_state::save_window_bounds(&win);
            }
          })
          .map_err(|e| format!("window-state thread: {e}"))?;
      }
```

(`Duration` is already imported in `lib.rs`.)

- [ ] **Step 3: Build and verify persistence timing**

Run: `npm run desktop`
Expected: after resizing/moving and waiting ~0.5s, quitting, and relaunching, the new bounds are restored. Maximize, quit, relaunch → reopens maximized.

- [ ] **Step 4: Rust checks**

Run: `npm run rust:check`
Expected: `cargo fmt` clean, `clippy` clean (`-D warnings`), `cargo test` passes.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/window_state.rs
git commit -m "feat(window): persist window geometry on move/resize"
```

---

## Task 6: Full cross-stack verification

**Files:** none.

- [ ] **Step 1: JS suite + lint + build**

Run: `npx vitest run && npm run lint && npm run build`
Expected: all green.

- [ ] **Step 2: Rust suite**

Run: `npm run rust:check`
Expected: green.

- [ ] **Step 3: Production-path smoke**

Run: `npm run desktop`. Verify against `plvs-settings.json` (in the app config dir): theme, reference LUFS, layout, presets, window-pin, and window geometry persist across full quit/relaunch with no first-paint flash. A fullscreened panel does NOT survive relaunch (Plan 2 behavior). Confirm production does not write a `plvs:settings`/`plvs:workspace` localStorage entry (DevTools → Application → Local Storage is empty for these).

- [ ] **Step 4: Packaged-build check (optional but recommended)**

Run: `npm run desktop:build`
Expected: builds; the installed app persists settings to `plvs-settings.json` and restores window geometry.

---

## Deferred (explicitly out of scope for Plan 3)

- **Fold `captureDeviceId` / `clearShortcut` / `clearGlobal` under the `settings` domain object.** They already live in `plvs-settings.json` (single source-of-truth file ✓) as flat keys via `capturePrefs.js` / `clearShortcutPrefs.js`; nesting them under `settings` and removing those two modules is a minor consistency cleanup, plus cleanup of the old flat keys, to be done as a follow-up.
- **User-facing reset / export-import UI** — separate feature (spec "Out of scope").

---

## Self-review notes (Plan 3)

- **Spec coverage:** plugin-store as production single source of truth (Tasks 1-2) ✓; Rust first-paint injection via `window.__PLVS_INITIAL_STATE__` (Task 4) ✓; window geometry persist/restore + off-screen clamp (Tasks 3-5) ✓; no second storage file (geometry lives in `settings.windowBounds`, not a window-state plugin file) ✓. The async-vs-sync tension is resolved by the seeded in-memory cache (Task 1).
- **Type consistency:** the injected object keys (`plvs:settings`/`plvs:workspace`) match the domain-store `name`s and the `pluginStoreBackend` cache keys; `WindowBounds` fields match the JS `windowBounds` shape `{ x, y, width, height, isMaximized }` via serde — the `is_maximized` field carries `#[serde(rename = "isMaximized")]` (in the Task 3 code) so the JSON matches exactly.
- **Version-sensitive APIs:** Task 4/Step 2 enumerates the exact Tauri/plugin-store calls to confirm against `tauri = 2` / `tauri-plugin-store = 2.4.3` before implementing.
- **No placeholders:** every step has concrete code/commands; version-sensitive Rust calls have an explicit confirmation step rather than a guess.
