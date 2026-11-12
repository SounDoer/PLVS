# PLVS — Pitfalls

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

`src-tauri/binaries/` is gitignored because FFmpeg sidecars are release assets. Initialize a new
linked worktree with `npm run worktree:setup`; its `npm ci` lifecycle restores checksum-verified
sidecars from the machine cache. Supported npm Rust and desktop commands self-prepare too. Do not
copy binaries from another checkout or use bare Cargo as the first command in an unprepared
worktree: a missing sidecar can surface as a misleading `serde_derive` error while the real cause is
buried in build-script output.

## Module loading boundary

`workspace/registry.jsx` binds module metadata to React components and icons, so importing it loads
the entire panel tree. Logic-only modules must import `workspace/moduleCatalog.js` for ids, titles,
and drag minimums. Only rendering code should reach the registry.

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

### Windows will not put a background window back on top

`SetWindowPos(HWND_TOPMOST)` from a process that is not in the foreground returns success and does
nothing once the window has left the topmost band. Tauri's `set_always_on_top` also skips a call that
matches its own flag, so it cannot repair the state either. The Dock strip therefore never leaves
the topmost band for a full-screen window: it hides instead
([ADR 0045](https://github.com/SounDoer/PLVS/blob/421b7333059d94f36a41197ae9c7a0de11c96a66/docs/adr/0045-dock-full-screen-fills-the-edge-and-hides-instead-of-lowering.md)). Verify
topmost changes with the window in the background, as it is when a full-screen window closes; a
command typed while PLVS has focus passes either way.

## Capture verification

### Detached RDP setup can silently record silence

The capture rig works in a detached RDP session only when the RDP client sends audio to the remote
computer. Default redirection exposes only "Remote Audio" to the engine, and disconnecting does not
make VB-Cable reappear. PowerShell can enumerate endpoints that WASAPI cannot use, so verify the rig
with `plvs-cli doctor --json` and inspect `device-enumeration`.

A player started before the RDP session detaches can remain alive while it stops feeding VB-Cable.
Start the player after detaching. A healthy device, active process, and zero dropped chunks are not
enough: reject runs where `integratedLufs` remains `null`.

### Smoke and soak require the current capture harness

Both commands use the feature-gated `src-tauri/target/harness/plvs.exe`, built with the dedicated
`harness` Cargo profile (inherits `release`). A normal check builds the debug profile, so nothing
rebuilds the harness on the way to a run. The rig therefore verifies the feature and compares binary
mtimes with Rust source and Cargo manifests. Exit 2 means the rig is unusable, not that capture
failed.

Rebuild the harness after source or Cargo manifest changes, or when the rig reports exit 2 and
names a stale binary. Release acceptance builds it before running capture smoke.

```sh
cargo build --manifest-path src-tauri/Cargo.toml --profile harness --bin plvs --features capture-harness
```

### Soak runs are the drift baseline

Compare complete capture soaks after warmup with reviewed references from the same platform and
measurement contract. See [baseline verification](../fixtures/capture-soak-baselines/README.md).
An interrupted capture run cannot establish a baseline. Desktop soaks measure dropped frames and
chunks and have their own verdict.

A constant-tone run should have Max M and Max S consistent with Integrated. A sustained jump of
about 6.02 dB on the Windows rig can indicate two identical players feeding the cable in phase.
Run only through commands that hold the [machine-wide rig lease](visual-and-capture-validation.md).

## Scene operations and draft editors

Preset apply, save, and update plus dock entry consult `assertSceneOperationAllowed` in the business
function before any mutation. Editors with shared normal/Dock presentation explicitly register Dock
transferability; only Dock entry can pass those registrations. Unknown editors and every preset
operation remain blocked. Agent Control planning reads the same live blocker policy.

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

Retained keys come from `deriveRetainedAnalysisKeys`, not the Rust request list. The request list
depends on dock state and on the live frame shape, so using it for retention would erase history
during device blips or dock changes. Apply the retained set to every intake that
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
as dead snapshot data, not as a missing restore branch.

## Rendering changes

### A renderer migration must match the old pixels, not just the old shapes

Changing how a panel is drawn (CPU raster to WebGL, SVG to Canvas, one Canvas pattern to another)
can change colour, alpha and line weight without changing a single visible shape. Unit tests cannot
see it: jsdom has no WebGL, and Canvas tests mock the context. Screenshots viewed by eye miss it too,
because the usual result is "a little softer", which reads as a style rather than a fault.

Match the shader's output and blend equation to the WebGL compositing mode. The 3D Surface
regression test checks this because a mismatched premultiplied-alpha path can apply alpha twice.

When a change alters how something is rendered:

1. Before and after, capture the same panel and state with
   `npm run desktop:control -- visual screenshot --target panel --panel-id <id>`. A completed FILE
   analysis gives repeatable data.
2. Compare pixel values at a few fixed points: a grid line, a translucent fill, an antialiased edge.
   Also compare against a sibling renderer that should match, as Lines matches Surface for the floor.
3. Treat any pixel that comes out darker than both its background and its ink as a compositing
   error, never as a style.

Screen-space size rules for every renderer are in `docs/architecture.md` ("Screen-space sizes").

## Persistence

Choose the domain in [the persistence entry point](../src/persistence/index.js). The live desktop
backend uses the [multi-workbench storage boundary](architecture.md#multi-workbench-runtime):
Workspace state has a single writer and shared Library items and global preferences use revisioned
SQLite writes. `plvs-settings.json` is a legacy migration input.

An external writer must use the domain's write path and notify the React owner where the write does
not already do so. Follow `transfer/libraryAdapters.js` and test what the owning view displays.
Avoid enabling same-context notification on coalesced domains as a shortcut.

For a persistence check, let writes settle, restart the application and verify the restored data
under the relevant identity and Workspace. Vite reload can replay the original boot snapshot.
Keep the pre-paint hydration boundary in Rust; a later page-load injection can race first reads.

Keep Agent Control consent local to the identity. Profile transfer must not carry the permission
to another machine.
