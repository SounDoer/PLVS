# Local Configuration Profile Implementation Plan

> **For agentic workers:** implement task-by-task. Keep this plan updated with checkbox
> progress if work spans multiple turns.

**Goal:** Add a user-facing local configuration profile flow for PLVS: export a portable
`.plvsconfig` JSON file, import it back into local app storage, and reset configuration,
with import/reset taking effect by reloading PLVS.

**Spec:** `docs/superpowers/specs/2026-06-27-local-configuration-profile-design.md`

**Architecture:** Keep the existing persistence foundation. Add a profile boundary above the
domain stores and Rust-owned sibling keys. Tauri production uses awaitable Rust commands for
authoritative `plvs-settings.json` reads/writes; browser/dev gets a JS fallback over the
existing domain stores. Settings UI calls only the profile API.

---

## Decisions Locked In

- Exported files use the `.plvsconfig` extension and contain JSON.
- `.plvsconfig` is a user-facing backup/transfer format; `plvs-settings.json` remains the
  app's internal live storage.
- Import/reset writes validated configuration, then reloads PLVS. Do not hot-swap every
  live hook/store in the first implementation.
- Export includes `captureDeviceId`; import falls back to `default` when invalid or
  unavailable.
- Export/import includes `windowBounds`; Rust clamps restored bounds to visible monitors.
- `autostart` is not part of the profile.

---

## Profile Shape

```js
{
  app: "PLVS",
  kind: "configuration-profile",
  version: 1,
  exportedAt: "2026-06-27T00:00:00.000Z",
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

Unknown top-level fields are ignored on import. Known fields are normalized before writing.

---

## Task 1: Add Pure Profile Normalization

**Files:**

- Create `src/persistence/profileShape.js`
- Create `src/persistence/profileShape.test.js`
- Optionally extract helpers from hooks into pure modules if tests expose hook-only logic.

- [ ] Add constants:
  - `PROFILE_APP = "PLVS"`
  - `PROFILE_KIND = "configuration-profile"`
  - `PROFILE_VERSION = 1`
  - `PROFILE_EXTENSION = "plvsconfig"`
- [ ] Implement `buildProfileSnapshot(raw, { exportedAt = new Date().toISOString() } = {})`.
- [ ] Implement `normalizeImportedProfile(raw)` returning a normalized profile object or
      throwing a user-safe error for non-PLVS / unsupported files.
- [ ] Normalize:
  - `settings` as a plain object, with field-level normalization for known settings where
    pure helpers already exist.
  - `workspace` as a plain object; preserve only object-shaped data in this first task.
  - `presets` as `{ list: [], activeId: null }` when absent/invalid.
  - `themes` as `{ themes: {}, order: [] }` when absent/invalid.
  - `windowBounds` as `null` or an object with finite `x`, `y`, `width`, `height`, boolean
    `isMaximized`.
  - `captureDeviceId` as `"default"` unless it matches `"default"` or the current id shape.
  - `clearShortcut` as a non-empty string, defaulting to `DEFAULT_CLEAR_SHORTCUT`.
  - `clearGlobal` as boolean.
- [ ] Tests:
  - full valid profile round-trips;
  - missing fields fill defaults;
  - unrelated JSON is rejected;
  - future version is rejected with a clear error;
  - invalid `captureDeviceId` falls back to `"default"`;
  - invalid `windowBounds` becomes `null`.

**Verification:**

```bash
npx vitest run src/persistence/profileShape.test.js
```

---

## Task 2: Add Tauri Profile Commands

**Files:**

- Create `src-tauri/src/profile.rs`
- Modify `src-tauri/src/lib.rs`
- Add Rust unit tests in `profile.rs`

- [ ] Add Rust structs matching the profile shape where useful, or use
      `serde_json::Value` with small typed validators for fields that Rust owns.
- [ ] Add commands:
  - `export_profile() -> Result<serde_json::Value, String>`
  - `import_profile(profile: serde_json::Value) -> Result<(), String>`
  - `reset_profile() -> Result<(), String>`
- [ ] `export_profile` reads from `plvs-settings.json`:
  - `plvs:settings`
  - `plvs:workspace`
  - `plvs:presets`
  - `plvs:themes`
  - `windowBounds`
  - `captureDeviceId`
  - `clearShortcut`
  - `clearGlobal`
- [ ] `import_profile` writes the normalized keys back to the same store keys and saves
      synchronously/awaitably before returning.
- [ ] `reset_profile` removes those same keys and saves before returning.
- [ ] Keep `windowBounds` as the top-level Rust-owned sibling key.
- [ ] Register commands in `tauri::generate_handler!`.
- [ ] Rust tests should cover key mapping and window-bounds normalization/clamping helpers
      where they are pure.

**Verification:**

```bash
cargo test --manifest-path src-tauri/Cargo.toml profile
```

---

## Task 3: Add Frontend Profile API

**Files:**

- Create `src/persistence/profile.js`
- Create `src/persistence/profile.test.js`
- Modify `src/ipc/commands.js`

- [ ] Add invoke wrappers in `src/ipc/commands.js`:
  - `exportProfileCommand()`
  - `importProfileCommand(profile)`
  - `resetProfileCommand()`
- [ ] Implement `exportProfile()`:
  - Tauri: call Rust `export_profile`, then pass result through `buildProfileSnapshot`.
  - Browser/dev: collect `settingsStore`, `workspaceStore`, `presetsStore`, `themesStore`
    and local fallback values, then build a profile.
- [ ] Implement `importProfile(raw)`:
  - normalize with `normalizeImportedProfile`;
  - Tauri: call Rust `import_profile`;
  - Browser/dev: write existing stores and local fallback values.
- [ ] Implement `resetProfile()`:
  - Tauri: call Rust `reset_profile`;
  - Browser/dev: reset the four stores and fallback local keys.
- [ ] Implement `reloadAfterProfileChange()`:
  - first version can call `window.location.reload()`;
  - keep it behind a named function so a later desktop restart path can replace it.
- [ ] Tests mock `isTauri()` and command wrappers to verify both Tauri and browser paths.

**Verification:**

```bash
npx vitest run src/persistence/profile.test.js src/persistence/profileShape.test.js
```

---

## Task 4: Add Profile File Dialog Helpers

**Files:**

- Modify `src/ipc/fileDialog.js`
- Add or update tests if this module has test coverage added nearby.

- [ ] Add `pickConfigurationProfileFile()` using `@tauri-apps/plugin-dialog.open`.
- [ ] Add `saveConfigurationProfileFile(defaultPath?)` using `@tauri-apps/plugin-dialog.save`.
- [ ] Use filter `{ name: "PLVS Configuration", extensions: ["plvsconfig"] }`.
- [ ] Return `string | null`, matching the existing `pickMediaFile()` style.

**Verification:**

```bash
npx eslint src/ipc/fileDialog.js
```

---

## Task 5: Settings UI - Configuration Section

**Files:**

- Modify `src/components/SettingsPanel.jsx`
- Modify `src/components/SettingsPanel.test.jsx`
- Modify `src/App.jsx` or the settings composition site if profile actions live there.

- [ ] Add props to `SettingsPanel`:
  - `onExportConfiguration`
  - `onImportConfiguration`
  - `onResetConfiguration`
  - `configurationBusy`
  - `configurationStatus`
- [ ] Add a compact Settings section labelled `Configuration`.
- [ ] Add three actions:
  - Export
  - Import
  - Reset
- [ ] Use icons from `lucide-react` for action buttons.
- [ ] Reset must use `InlineConfirm`.
- [ ] Do not use the word `Clear` for configuration reset.
- [ ] Show concise status/error text only when needed.
- [ ] Keep the section visually consistent with the existing dense Settings rows.

**Verification:**

```bash
npx vitest run src/components/SettingsPanel.test.jsx
```

---

## Task 6: Wire Export/Import/Reset Orchestration

**Files:**

- Modify `src/App.jsx`
- Modify or add tests near `App` / settings integration as practical.

- [ ] Export flow:
  - call `exportProfile()`;
  - serialize pretty JSON;
  - save as `.plvsconfig`.
- [ ] Import flow:
  - open `.plvsconfig`;
  - parse JSON;
  - call `importProfile(parsed)`;
  - reload PLVS on success.
- [ ] Reset flow:
  - confirm in Settings;
  - call `resetProfile()`;
  - reload PLVS on success.
- [ ] In Tauri, use dialog/file APIs for picking/saving. If the existing app lacks file
      read/write helpers, add small wrappers rather than importing Tauri APIs directly in UI.
- [ ] In browser/dev, support a minimal fallback:
  - export via object URL download;
  - import via hidden file input or mark import unavailable if fallback would add too much
    UI complexity for this slice.
- [ ] Surface user-safe failures such as invalid file, write failure, or cancelled dialog.

**Verification:**

```bash
npx vitest run src/App.toolbar.test.js src/components/SettingsPanel.test.jsx
```

---

## Task 7: Cross-Stack Verification

**Files:** none.

- [ ] Run profile and persistence tests:

```bash
npx vitest run src/persistence/ src/components/SettingsPanel.test.jsx
```

- [ ] Run the full local gate:

```bash
npm run check
```

- [ ] Manual desktop smoke:
  - change theme, layout, presets, custom themes, window size/position, capture device, clear
    shortcut;
  - export `.plvsconfig`;
  - reset configuration;
  - confirm PLVS reloads to defaults;
  - import the exported file;
  - confirm PLVS reloads with theme, layout, presets, custom themes, window bounds, device
    fallback behavior, and clear shortcut restored.
- [ ] Confirm no profile operation writes `autostart`.
- [ ] Confirm imported off-screen `windowBounds` is clamped by Rust on next launch/reload.

---

## Follow-Up Candidates

- Add file association for `.plvsconfig`.
- Add an "Import without window position" option if users find cross-machine restores
  surprising.
- Add a profile schema/migration table when version 2 is needed.
- Consider moving capture/shortcut prefs under `plvs:settings` only if a future refactor can
  preserve Rust/JS ownership safety.
