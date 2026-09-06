# PLVS — Engineering Pitfalls

This is the long-form companion to [`AGENTS.md`](../AGENTS.md). It records counter-intuitive
behaviour, incident context, and the reason behind rules that should stay brief in the agent
entrypoint. The code on `main` remains the source of truth.

## Tests and tooling

### Vitest covers non-frontend contracts

`scripts/tauriSecurityConfig.test.js` and `scripts/tauriDependencyContract.test.js` read Tauri
configuration, Windows configuration, and NSIS hooks. Vitest collects every `*.test.js` in the
repository, so a Tauri or installer change can fail a JavaScript suite. Treat that as a configuration
contract failure; do not weaken the test merely because it is executed by Vitest.

### Vitest defaults to Node

`vite.config.js` sets the default environment to `node`. Tests that render React or use a persistence
store need `/** @vitest-environment jsdom */` as their first line. Without it, `localStorage` is
undefined and the local-storage backend silently no-ops, which often looks like an application bug.

`@testing-library/jest-dom` is not a dependency. Use the repository's existing idioms: a throwing
`getBy*`, `toBeTruthy()`, `queryBy*(...)` with `toBeNull()`, or direct DOM properties such as
`element.disabled`.

### Fresh worktrees need verified sidecars

`src-tauri/binaries/` is gitignored because FFmpeg sidecars are release assets. Run
`npm run ffmpeg:fetch` in a new worktree before building Rust. Do not copy binaries from another
checkout: the fetch script performs checksum verification. A missing sidecar can surface as a
misleading Cargo error about `serde_derive`; inspect build-script output for the missing resource.

## Module loading boundary

`workspace/registry.jsx` binds module metadata to React components and icons, so importing it loads
the entire panel tree. Logic-only modules must import `workspace/moduleCatalog.js` for ids, titles,
and drag minimums. Only rendering code should reach the registry.

Before the catalog split, pure-looking helpers pulled all canvas panels into profile validation,
preset filtering, and the workspace reducer. Nothing was functionally wrong, but test startup grew
until unrelated persistence tests approached Vitest's per-test timeout.

## Windows and dock geometry

### Webview scale is not Rust's monitor scale

On Windows, `devicePixelRatio` combines monitor DPI scaling with Accessibility → Text size, while
Rust's `scale_factor()` reports only the DPI component. A CSS-pixel measurement sent to Rust must be
converted with the frontend-provided ratio, such as `set_dock_accessories`'s `webviewScale`.

Changing Display Scale does not reproduce a Text size bug because both sides move together. Test the
Accessibility Text size slider explicitly. `getComputedStyle` continuing to report the original font
size does not prove that the webview scale is unchanged.

### Persisted geometry uses physical pixels

Window position and size are stored and restored in physical pixels, never logical pixels. Mixing
units causes repeated growth or drift across launches on scaled displays. The governing code and
comments are in `src-tauri/src/lib.rs` and `src-tauri/src/window_state.rs`.

### Apply chrome before geometry

Saved geometry pairs an outer position with an inner size. Decorations and the platform shadow
change the frame between those two measurements, so every restore path must establish chrome before
applying bounds. Boot does this in the window builder, dock exit passes decorations to `exit_dock`,
and preset apply awaits `setWindowDecorations` before `applyWindowBounds`.

React state is too late for this ordering: `setFocusView` schedules the decoration effect for a later
commit. The shadow is Rust-owned—normal windows have it and the docked strip does not—so JavaScript
must not manage it independently.

## Capture verification

### Detached RDP setup can silently record silence

The capture rig works in a detached RDP session only when the RDP client sends audio to the remote
computer. Default redirection exposes only "Remote Audio" to the engine, and disconnecting does not
make VB-Cable reappear. PowerShell can enumerate endpoints that WASAPI cannot use, so verify the rig
with `plvs-cli doctor --json` and inspect `device-enumeration`.

A player started before the RDP session detaches can remain alive while it stops feeding VB-Cable.
Start the player after detaching. A healthy device, active process, and zero dropped chunks are not
enough: reject runs where `integratedLufs` remains `null`. Measurements and the operating protocol
are recorded in `docs/working/perf/protocol.md` §10.3.

### Smoke and soak require the current capture harness

Both commands use the feature-gated `src-tauri/target/release/plvs.exe`. A normal check builds the
debug profile, and a production release build can replace that path with a binary lacking
`capture-harness`. The rig therefore verifies the feature and compares binary mtimes with Rust source
and Cargo manifests. Exit 2 means the rig is unusable, not that capture failed.

When instructed, rebuild explicitly and rerun:

```sh
cargo build --manifest-path src-tauri/Cargo.toml --release --bin plvs --features capture-harness
```

This guard was added after the v0.14.5 preflight and soak both used a binary older than the final DSP
change; the trailing `app.version` was the only visible clue.

## Scene operations and draft editors

Preset apply, save, and update plus dock entry are scene operations. They must call
`assertSceneOperationAllowed` in the business function before any mutation so UI, tray, dock, and
Agent Control entry points share the same refusal.

Blocking is based on a draft-style editor being open, not on whether it is currently dirty. Scene
replacement destroys the editing context, and a clean draft can become dirty between a check and a
commit. Never discard a draft to let a scene operation proceed. Register new draft / preview / save /
cancel editors with `useBlockingEditor`, and test both the refusal and absence of pre-refusal mutation.

## Analysis history

### Request keys allocate history slabs

`FrameIntake` stores visual history one slab per analysis request key. At four-hour retention, a
Spectrum slab is about 1.38 GB and a Stereo Map slab about 4.37 GB, so rapid key churn is expensive.
Controls that remain part of a request key, currently Spectrum Speed and Stereo Map Speed, commit on
pointer release. Spectrum Tilt was removed from the key and no longer needs that workaround.

Retained keys come from `deriveRetainedAnalysisKeys`, not the Rust request list. The request list is
capped, reordered by dock state, and conditional on the live frame shape; using it for retention
would erase history during device blips or dock changes. Apply the retained set to every intake that
ingests frames (`ingestingIntakes`), not merely the displayed `intakeRef`.

### Exact history fixtures must respect Float32

History columns use Float32 storage through `FrameIntake` slabs, `RaggedFloatColumn`, and
`PowerOfTwoMinMaxIndex`. Use exactly representable fixture values such as `0.25`, `0.5`, and `0.875`,
or write the expected values with `Math.fround`. For example, stored `-0.4` becomes
`-0.4000000059604645`.

Do not paper over an exact storage assertion with a broad tolerance. A range query can combine raw
rows and summary buckets with different representations, so imprecise fixtures can turn an indexing
test into an accidental floating-point test. Use per-element `toBeCloseTo` only when the domain truly
cannot provide exact values.

## Dock preset asymmetry

`captureSnapshot` records dock strip layout fields unconditionally, but `applyDockPreset` restores
them only when the preset enables dock mode. This is deliberate. A windowed preset's strip fields
reflect whatever happened to be in `workspaceStore` when it was saved; they were not authored for
that preset because strip editors exist only while docked. Restoring them later would invisibly
overwrite a hand-tuned strip.

Dock-enabled presets still round-trip their strip layout. Treat the fields in a dock-disabled preset
as dead snapshot data, not as a missing restore branch. This behaviour was investigated and retained
on 2026-09-05.

## Persistence

### Pick the correct domain

Persistence is split into domains with distinct export, reset, and migration behaviour. Read
`src/persistence/index.js` before adding a key. The deprecated `plvs.ui` adapter is not a fallback;
it exists only in `cleanupLegacyKeys.js`.

### External writers must notify the React owner

Writing a domain store outside the React state that owns it does not update the visible list in the
same context. The desktop backend's subscription is a no-op, and the browser `storage` event fires
only in other documents. An external writer such as `transfer/libraryAdapters.js` must call
`store.notifyLocal()` after writing, and the test must render the owner and assert the visible result.

Do not enable `notifySameContext` globally as a shortcut. `plvs:settings` uses coalesced writes during
interactions such as opacity dragging, and global same-context notification would make subscribers
reread on every write. Ordinary owner hooks should continue updating their own React state directly.

### `plvs-settings.json` is the shared store

Despite its name, `plvs-settings.json` contains all four frontend domains—settings, workspace,
presets, and themes—plus Rust-owned siblings such as window bounds, capture preferences, shortcuts,
and the Agent Control permission. Renaming it requires a boot-time Rust migration before the first
store read, downgrade semantics, locked-file and permission handling, and real installation testing.
Do not treat a filename cleanup as a mechanical refactor.

Profile import inserts selected domain and sibling keys rather than replacing the file. In
particular, `agentControlEnabled` is intentionally excluded so a shared profile cannot transfer a
local permission to another machine.

### Vite reload rewinds the desktop persistence cache

`pluginStoreBackend` reads from a synchronous cache seeded by `window.__PLVS_INITIAL_STATE__` and
does not reread disk. Rust creates that initialization script once during application setup; a Vite
page reload reruns the original boot script, replacing the cache with the boot snapshot. The next
write can persist that stale snapshot over newer disk data.

Production's profile-change path relaunches Tauri so Rust recomputes the snapshot, and profile import
suspends plugin-store persistence before reloading. The hazard is the desktop development reload.
Never use a manual check spanning HMR or a Vite reload as proof that persistence reached disk. Restart
the app and inspect `plvs-settings.json` itself.

Do not attempt to refresh the snapshot from Tauri's `on_page_load`. The approach was measured on
2026-09-06: WebView2 `ExecuteScriptAsync` landed 6–26 ms after the earliest inline script on every
trial. Dev appeared safe only because Vite's module graph added roughly 700 ms before consumers read
the value. A production bundle has no such margin, and the three independent consumers
(`pluginStoreBackend.js`, `useDockMode.js`, and `agentControl/appSnapshot.js`) could observe different
generations if an asynchronous update landed mid-load.
