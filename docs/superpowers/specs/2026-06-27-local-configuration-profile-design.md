# Local Configuration Profile - Persistence Boundary and Import/Export Foundation

**Date:** 2026-06-27
**Status:** Draft
**Spec depends on:**

- `2026-06-17-persistence-unification-design.md`
- `2026-06-18-presets-redesign-design.md`

## Summary

PLVS already has a reasonable persistence foundation: frontend-owned configuration is split
across domain stores, Tauri production writes to the owned `plvs-settings.json` file, Rust
injects first-paint state before the WebView runs, and Rust owns window geometry.

This spec does not replace that foundation. It adds a formal **local configuration profile**
boundary above the existing stores so export, import, and reset can treat app-owned
configuration as one coherent user concept without making Settings UI manually stitch
together unrelated keys.

## Current model

The current runtime model is broader than the original two-domain persistence spec:

| Store key                      | Owner                       | Holds                                                                                                                                       |
| ------------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `plvs:settings`                | frontend settings hooks     | App preferences such as appearance, theme id, reference LUFS, focus view, panel opacity, channel label overrides, and theme-editor position |
| `plvs:workspace`               | workspace context/reducer   | Current workspace layout, panel instances, panel order, per-panel controls, and pinned panels                                               |
| `plvs:presets`                 | presets orchestration hook  | User-created view snapshots and the active preset id                                                                                        |
| `plvs:themes`                  | custom theme repository     | Custom theme records and display order                                                                                                      |
| `windowBounds`                 | Rust window state module    | Window position, size, and maximized state                                                                                                  |
| `captureDeviceId`              | capture prefs IPC helper    | Preferred capture device                                                                                                                    |
| `clearShortcut`, `clearGlobal` | clear shortcut prefs helper | Clear shortcut combo and system-wide shortcut toggle                                                                                        |

In Tauri, these keys live in the single app-owned `plvs-settings.json` file. In browser/dev
mode, the domain stores use localStorage.

## Assessment

The existing framework is sound and should be extended, not rewritten.

- Domain stores give each frontend area an explicit persistence boundary.
- A backend seam lets dev/browser use localStorage while the shipped app uses plugin-store.
- Rust first-paint injection keeps theme/layout hydration synchronous.
- Keeping `windowBounds` as a Rust-owned sibling key is intentional. If it lived inside
  `plvs:settings`, frontend settings writes could re-persist stale boot-time geometry and
  clobber Rust's latest window save.
- Presets correctly sit above the pure workspace reducer because they capture both workspace
  view state and window/app view preferences.

The main gap is the lack of a single profile-level API. Today `exportAll()` and `resetAll()`
cover the four frontend domains, but do not represent the full local configuration set:
`windowBounds`, capture-device preference, and clear-shortcut preferences are sibling keys.

## Product concept

A **configuration profile** is a versioned snapshot of PLVS-owned local configuration.
It is a user-portable file, not the app's live storage file.

It should include app-owned data that a user reasonably expects to move, back up, or reset:

```js
{
  version: 1,
  settings: {},
  workspace: {},
  presets: {},
  themes: {},
  windowBounds: null,
  captureDeviceId: "default",
  clearShortcut: "CmdOrCtrl+K",
  clearGlobal: false
}
```

The exported file extension is `.plvsconfig`. The file contents are JSON so users can open
and inspect or edit it with a code editor, but the custom extension makes the file's purpose
clear and lets PLVS distinguish it from arbitrary JSON.

Relationship to app storage:

```txt
Daily use:
PLVS <-> plvs-settings.json

Export:
plvs-settings.json -> validated profile snapshot -> my-config.plvsconfig

Import:
my-config.plvsconfig -> validate/normalize -> write plvs-settings.json -> reload PLVS
```

`plvs-settings.json` remains the app's internal live storage. `.plvsconfig` is the
user-facing backup/transfer format. The profile should include identifying metadata such as
`app: "PLVS"` and `kind: "configuration-profile"` so import can reject unrelated files.

`autostart` is excluded from the profile truth model. It is an OS-managed registration, not
application data. A future import UI may optionally ask whether to re-enable autostart, but
that must call the OS-backed autostart plugin rather than writing a stored field.

## Architecture decision

Add a profile boundary above the existing persistence stores:

```txt
Settings UI
  -> profile API: exportProfile / importProfile / resetProfile
    -> Tauri: Rust command reads/writes plvs-settings.json authoritative keys
    -> Browser/dev: JS reads/writes domain stores plus local fallbacks
      -> existing domain stores and validators
```

The Settings UI should never hand-assemble a profile from individual stores. It should call
the profile API and render success/failure/reload states.

## Normalization and validation

Import must not blindly trust JSON. Before data becomes active:

- Settings fields should use the same normalization as `settings/defaults.js`.
- Workspace data should be validated against known panel/module ids and current workspace
  shape.
- Presets should reuse the existing known-module and panel-control normalization.
- Custom themes should pass through the custom theme normalizer.
- Window bounds should be validated/clamped on the Rust side.
- Capture device and clear shortcut fields should fall back to their current defaults when
  absent or invalid.

Some of this logic currently lives in hooks. Any hook-only normalization needed by import
should be extracted into pure helpers before building import.

## Reliability requirements

Profile export/import/reset are explicit user actions and must be reliable:

- Do not rely on fire-and-forget plugin-store writes for these operations.
- Tauri production should use awaitable Rust commands that read/write `plvs-settings.json`
  authoritatively.
- Import/reset should write the validated profile to `plvs-settings.json`, then reload the
  WebView so PLVS re-enters the existing first-paint startup path and all settings take
  effect together. Do not hot-swap every live hook/store in the first implementation.
- Corrupt, future-version, or partial profiles should fail gracefully or import only known
  validated fields.

## User-facing scope

The first UI surface should live in Settings under a configuration/local-data section:

- Export configuration
- Import configuration
- Reset configuration

Do not call this operation **Clear**. PLVS already uses Clear for meter/history data, so
configuration reset needs distinct wording.

## Decisions from discussion

- Import/reset uses the reload approach: write the local store, then reload PLVS.
- Export includes `captureDeviceId`; import falls back to `default` if the id is invalid or
  unavailable on the current machine.
- Export/import includes `windowBounds` by default; Rust clamps restored bounds to visible
  monitors.
- The user-facing file is `.plvsconfig` containing JSON, not a raw backup of
  `plvs-settings.json`.

## Out of scope

- Sync/cloud storage.
- Multiple named profiles inside the app.
- OS-level autostart migration.
- Reworking the current domain-store backend model.
- Moving `windowBounds` into `plvs:settings`.

## Testing notes

- Unit-test profile shape normalization with full, partial, corrupt, and future-version
  inputs.
- Test Tauri profile commands against the expected plugin-store keys.
- Test browser/dev fallback against localStorage domain stores.
- Test import/reset reload behavior from Settings.
- Verify export includes `plvs:settings`, `plvs:workspace`, `plvs:presets`, `plvs:themes`,
  `windowBounds`, `captureDeviceId`, `clearShortcut`, and `clearGlobal`.
