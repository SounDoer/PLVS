# PLVS — Architecture

> **Purpose**: the technical map of PLVS — stack, directory layout, audio pipeline, frontend/backend communication, theme system.  
> **Audience**: the project author and AI agents. The **implementation on `main`** is authoritative; when this document and the code disagree, the code wins.  
> **Related**: product scope in [`prd.md`](prd.md); UI token details in [`design-tokens.md`](design-tokens.md); architecture decisions in [`adr/`](adr/).

---

## 1. Tech stack

**Tauri 2 + Rust (backend) + React 19 / Vite (frontend)**

| Layer         | Technology                        | Responsibility                                            |
| ------------- | --------------------------------- | --------------------------------------------------------- |
| Desktop shell | Tauri 2                           | System WebView, process management, platform API bridging |
| Audio engine  | Rust + cpal / Core Audio          | PCM capture, DSP (peak / LUFS / FFT / vectorscope)        |
| Frontend UI   | React 19 + Vite + Tailwind CSS v4 | Panel rendering, layout, settings                         |
| Components    | shadcn/ui (Radix)                 | Shell and settings controls                               |
| Tests         | Vitest                            | Frontend unit tests (next to the source, `*.test.js/jsx`) |

**Why Rust + Tauri:** Rust has no GC, which keeps the audio callback thread realtime-safe; Tauri uses the system WebView (no bundled Chromium, an installer of ~10 MB); the existing React components are reused as they are. Electron and JUCE were rejected over size and positioning (see the history of the original architecture.md and the ADRs).

---

## 2. System architecture

```
┌─────────────────────────────────────────────┐
│              Tauri Application               │
│                                              │
│  ┌──────────────┐       ┌─────────────────┐  │
│  │   Frontend   │◄──────│   Rust Backend  │  │
│  │ React + Vite │Channel│                 │  │
│  │              │ ~60Hz │  Audio Engine   │  │
│  │  • Panels    │       │  ┌───────────┐  │  │
│  │  • Controls  │◄──────│  │ cpal /    │  │  │
│  │  • Settings  │ Event │  │ Core Audio│  │  │
│  │              │ ~2Hz  │  └─────┬─────┘  │  │
│  │              │──────►│        ▼        │  │
│  │              │invoke │  DSP Pipeline   │  │
│  └──────────────┘       └─────────────────┘  │
└─────────────────────────────────────────────┘
         ▲
         │ WASAPI Loopback (Windows) / Core Audio Tap (macOS 14.2+)
    System Audio
```

**Data flow:**

1. **Capture**: Rust obtains PCM through cpal (Windows WASAPI Loopback + physical inputs) or the macOS Core Audio Tap.
2. **DSP**: the audio thread computes Peak / True Peak / LUFS / FFT spectrum / correlation in parallel.
3. **Push**: high-rate metrics (~60 Hz) → Tauri Channel; low-rate state (~2 Hz) → Tauri Event.
4. **Render**: React subscribes to the data and updates the panels.
5. **Control**: frontend actions (START/STOP/device switch) → `invoke` a Rust command.

The desktop app also has a low-rate semantic control path: `plvs-cli` Agent Control commands find the
running instance with the same identity through a named pipe with a current-user ACL on Windows and
a private Unix socket on macOS. The Rust broker only handles authentication, rate limiting, timeouts
and request correlation, then routes the request to the main WebView. Workspace validation, revision,
one-shot replacement and persistence completion remain owned by the React frontend; the broker does
not duplicate business state and does not broadcast requests to accessory WebViews.

Transient editor authoring uses a separate mounted-draft registry in the React workbench. Each
adapter is bound to the UI Navigation surface ID for one Theme/Profile editor lifetime and exposes
only owner-provided snapshot, atomic document transaction, history, linked-discard, and explicit Save
functions. Save rechecks the source, uses the normal owner commit, and awaits observed library/editor
state plus durable persistence; other draft actions remain transient.
Its `draftGeneration` is local to that lifetime; it never advances or substitutes for the durable
Agent Control revision. Closing or replacing the editor unregisters the adapter, so an old command
cannot resolve to a later draft.

### Multi-workbench runtime

Each metering workbench is one Tauri process with its own Rust audio engine, React runtime, native
window and single-writer Workspace file. A shared SQLite database in WAL mode owns Library items,
ordering, revisions, global preferences and the ordered restore set. Item and collection writes use
expected revisions; Workspace state never shares a writer and measurement history is never
persisted.

On macOS, LaunchServices sends a reopen event to the running application instead of starting a
second process. A reopen with a visible workbench spawns an ordinary additional process; when all
windows are hidden it only shows the existing workbench.

An identity-scoped file lock elects one coordinator generation. The coordinator owns the Tray,
global shortcut, Open at Login registration and updater. Every process publishes a heartbeat
descriptor containing its random instance ID, Workspace ID, Source-derived label, capture state,
visibility and focus sequence. Agent Control uses a unique authenticated pipe/socket for each
instance; the identity-wide compatibility endpoint follows the coordinator. Development, Preview
and Release application identifiers therefore produce separate data, lock, registry and endpoint
namespaces.

Commands that affect the complete process set use disk-backed, instance-targeted mailboxes. Update,
configuration replacement and full-app quit have a prepare phase in which every process checks its
blocking editors, stops capture and flushes persistence. Only unanimous acknowledgements allow the
commit phase to close peers; timeout or refusal aborts. A debug-only absolute app-data override
allows real multi-process desktop tests to keep persistence, restore metadata, artifacts and logs
inside a disposable root; packaged builds reject it.

Development-identity builds also enable a closed Agent Control event-fixture layer for deterministic
screenshots of interfaces normally opened by updater, crash, close, or persistence-conflict events.
The layer is not part of the public CLI: it asks the same React owner that handles the real event to
establish or exactly reset a tagged scene, while UI Navigation remains the authority for blocking,
surface identity, inspection, and safe dismissal. Fixture provenance stays outside component props
and is never persisted.

Visual Capture keeps the same semantic boundary: React chooses the capture target, waits for a stable
paint and supplies CSS geometry; Rust owns the private artifacts, concurrency and lifecycle. Windows
screenshots use WebView2 and macOS screenshots use the WKWebView snapshot; both capture only the PLVS
WebView content. Windows recording uses Windows Graphics Capture and Media Foundation, macOS
recording uses ScreenCaptureKit and AVAssetWriter. Both reuse Rust's measured-source PCM timeline and
encode H.264/AAC MP4.

### Frontend state ownership

Application state in the main window is owned by React context providers, one per domain, nested in
`App` (`src/App.jsx`) in dependency order. A provider reads the providers that enclose it and
never one it encloses. The reasons are in
[ADR 0022](adr/0022-ordered-providers-own-frontend-state.md).

| Owner (outermost first) | Owns                                                                                                    | Read through                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Workspace               | Split tree, panels, panel controls, shared axis viewports                                               | `useWorkspaceStore`                                                  |
| MeterRuntime            | Source mode, live and file lifecycle, notices and scrub position, the per-frame assembly                | `useMeterRuntime`, `useMeterDisplayState`, `useMeterRuntimeAssembly` |
| BlockingEditors         | Which draft-style editors are open                                                                      | `useBlockingEditors`                                                 |
| UiNavigation            | Transient navigation intent and the mounted-surface registry                                            | `useUiNavigation`                                                    |
| LoudnessProfile         | Profile library, selection and draft                                                                    | `useLoudnessProfile`                                                 |
| Settings                | Every stored preference, including the view values and the pin                                          | `useAppSettings`                                                     |
| SceneGuard              | The composed rule that refuses scene operations                                                         | `useSceneGuard`                                                      |
| Dock                    | Dock mode, strip layout, enter and exit transitions                                                     | `useDock`                                                            |
| WindowChrome            | Applying pin, decorations, shadow and glass to the window; the view setters                             | `useWindowChrome`                                                    |
| Presets                 | Preset library and the Dock hand-off on apply                                                           | `usePresetLibrary`                                                   |
| Source                  | Device inventory, selected source and its labels                                                        | `useSource`                                                          |
| SourceActions           | Start, stop, clear and the file actions                                                                 | `useSourceActions`                                                   |
| AppLifecycle            | Window visibility, tray, updates, close dialog, crash reports, global shortcuts                         | `useAppLifecycle`                                                    |
| DisplaySnapshot         | What the panels and the transport pill show now, live or at the scrub position; changes per meter frame | `useDisplaySnapshot`                                                 |
| AnalysisSession         | Channel count and labels, analysis requests, their sync to the engine, panel-control clamps             | `useAnalysisSession`                                                 |
| DockAccessories         | When each Dock accessory window is shown, the state published to them, what their actions do            | `useDockAccessories`                                                 |
| AgentControlState       | Whether Agent Control is enabled, platform capture capabilities, the recording state                    | `useAgentControlState`                                               |

`useMeterRuntimeAssembly` and `useDisplaySnapshot` change on every meter frame; only a component
that works per frame should read them. Notices and the scrub position come from
`useMeterDisplayState`, which does not. The analysis session re-renders per frame itself, because
the channel count comes from the displayed frame, and publishes a value that changes only when the
channel count, the labels or the requests do.

`AppContent` is the consumer at the centre: it reads the owners, derives the per-frame data it
hands to the panels, and assembles the props for the shell. It owns no domain state. Agent Control
is mounted as `AgentControlBridge` (`src/agentControl/`), which reads every area from its owner
and takes nothing from `AppContent`.

### Panel settings and the control table

`src/lib/panelControls.js` holds one row per persisted panel control: its default, the rule that
repairs a stored value, and — for a control that has a settings row — a `ui` face with the tab,
label, widget, order, `aria-label`, tooltip, visibility rule and commit rule. A control shown on
several tabs carries one face per tab. Both settings surfaces draw from these rows with one
renderer (`ControlRows` in `src/components/panel-settings/PanelControlRows.jsx`):

- **A panel's settings popover** draws every row of the panel's tab.
- **The Dock editor** draws the same rows filtered to the controls a Dock module stores
  (`DOCK_MODULE_CONTROL_KEYS` in `src/dock/dockModuleControls.js`), merged with the few rows only
  the strip has, which are declared beside that list in the same row shape.

Adding a control to the table is what puts it on screen; adding its key to the Dock's list is what
puts it in the Dock. Do not restate a label, a bound, a step or a commit-on-release flag in a
settings component.

The renderer reports only the keys a change touches. Each surface merges that patch into its own
record and repairs it by its own rule, because the records differ: a panel's holds every control,
a Dock module's holds a subset plus keys the table does not know.

A row the table cannot draw is a **slot** (`widget: "custom"` or `"customRow"`): the table owns
that the row exists and where it sits, and the surface supplies the control. Slots are for content
the table cannot know — channel choices that come from the device, the layers the active Loudness
Profile offers, the sortable metrics list — not a to-do list.

Agent Control does not read the `ui` faces. Its schema and mapping work from the normalized control
record, so a settings row can move or be relabelled without touching the Agent Control contract.

---

## 3. Directory layout

This lists only **what each top-level directory is responsible for**, not files. File-level content
changes too quickly and goes stale as soon as it is written down — look at the directory when you
need it. When adding a top-level directory, add a row in the same commit.

**Frontend `src/`**

| Directory       | Responsibility                                                                                                       |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| `ipc/`          | ★ The only boundary between the frontend and the Rust audio engine: `invoke`, Channel and Event all go through here  |
| `components/`   | UI components; `panels/` holds the meter panels, `ui/` the shadcn/ui primitives                                      |
| `workspace/`    | Split-tree workspace layout, panel registration and data providers; logic-only code imports only `moduleCatalog.js`  |
| `dock/`         | Dock mode: the meter strip and accessory WebViews (header / editor)                                                  |
| `hooks/`        | React hooks and shared contexts                                                                                      |
| `runtime/`      | Ownership and derived state of the metering runtime (live measurement owner, runtime context)                        |
| `analysis/`     | Analysis requests derived from panel configuration                                                                   |
| `lib/`          | Engine integration and history storage (FrameIntake, history slabs, etc.)                                            |
| `math/`         | Pure functions: history paths, formatting, spectrum and channel-layout calculations                                  |
| `theme/`        | Theme documents, explicit format/semantics migration, typed Role Registry and recipes, compiler, runtime publication |
| `preferences/`  | Non-colour interface tuning (layout, fonts, radii, interface size) and applying it to the document                   |
| `config/`       | Static configuration shared with the Rust DSP, such as scale definitions                                             |
| `settings/`     | Setting defaults and option lists; the settings owner (`SettingsContext.jsx`)                                        |
| `persistence/`  | Domain-split persistence; choose the domain in `index.js` before adding data                                         |
| `transfer/`     | Import and export (packs) of themes, loudness profiles and preset libraries                                          |
| `agentControl/` | Frontend command implementations, schemas and snapshots for Agent Control                                            |
| `data/`         | Static data (shortcut definitions)                                                                                   |
| `dev/`          | Development-only performance and profiling tools                                                                     |
| `generated/`    | Generated by `npm run theme:generate`; never edited by hand                                                          |

**Backend `src-tauri/`**

| Location                            | Responsibility                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------ |
| `src/audio/`                        | Capture layer: cpal, platform backends, macOS tap, device enumeration and identity   |
| `src/dsp/`                          | Peak, loudness, spectrum, vectorscope, VAD, channel layouts and weights              |
| `src/engine/`                       | Orchestration: PCM → metering frames → Channel / Event push                          |
| `src/file_analysis/`                | File mode: ffmpeg probing and decoding, session history                              |
| `src/ipc/`                          | Tauri commands, events and binary frame encoding                                     |
| `src/agent_control/`                | Agent Control broker, discovery, framing protocol and enablement                     |
| `src/visual_capture/`               | Screenshots and recording (per-platform implementations)                             |
| `src/cli_*.rs`, `doctor.rs`         | `plvs-cli` subcommands and installation diagnosis                                    |
| `src/dock*.rs`, `appbar.rs`         | Dock windows and the Windows appbar screen-space reservation                         |
| Other `src/*.rs`                    | Single-purpose modules: app entry and state, windows, sidecar, crash reporting, etc. |
| `plvs-cli/`                         | Standalone lightweight CLI forwarder package                                         |
| `native/macos/`                     | Objective-C bridge for the Core Audio process tap                                    |
| `capabilities/`, `tauri*.conf.json` | Tauri permission declarations and bundle configuration                               |

---

## 4. Audio pipeline

### Capture layer (`src-tauri/src/audio/`)

- **Windows**: `cpal_backend.rs` opens WASAPI Loopback through `cpal` — no virtual sound card, it reads the system output PCM directly; physical inputs also go through cpal. Application sources use `ActivateAudioInterfaceAsync` in `windows_process_loopback.rs`; a stable application ID derived from the executable path is resolved to the current PID on every start. Because that interface does not report a mix format, PLVS explicitly requests float32 at the current default output's sample rate and a verified channel layout (mono / stereo / 5.1 / 7.1; other layouts fall back safely to stereo) before entering the same meter pipeline. This path requires Windows build 20348+ and cannot capture ASIO or WASAPI exclusive-mode output that bypasses the system mixer.
- **macOS**: system audio goes through `macos/` (Core Audio process tap, macOS 14.2+); physical inputs go through cpal. Global system output uses a device-specific tap that excludes an empty process list. When a global tap starts against a completely idle output device, PLVS briefly opens a zero-filled stream on that same device until the first tap callback arrives; this clocks the aggregate without making the running session hold an unnecessary render stream. Application sources keep the running ordinary GUI hosts among the Core Audio process objects, derive a stable application ID from the host bundle, merge helper processes under the same host and capture them with `CATapDescription initWithProcesses`. Pausing does not remove a source, because the HAL may temporarily empty the output device list and a process tap may legitimately stop calling back. Application taps currently follow the default output device and keep that device's native channel layout. Platform dispatch lives in `platform_backend.rs`.
- **Capture health**: a running capture that stops receiving callbacks for longer than `CAPTURE_STALL_TIMEOUT` (5 s) is treated as failed; `engine-state-changed` emits `error`, and the frontend stays in `error` and shows the reason. macOS global taps first have a separate 30 s startup allowance for the recording-permission prompt and temporary idle-device wake-up; the 5 s running-stream watch begins after their first callback. Windows loopback without a silence stream is excluded from the pure callback-stall check (it does not call back during silence), but still reacts immediately to fatal backend stream errors. Windows `DeviceNotAvailable` / `StreamInvalidated` are reported as a structured `deviceInvalidated` reason; the frontend releases the old stream, re-resolves the current device, clears the interrupted Live measurement and rebuilds once automatically. The next recovery is allowed only after the replacement has produced audio for two seconds, which prevents failure loops. The device monitor thread observes both the device list and the current default output every 2 s; under Automatic, a default output change restarts capture. With an Application selected, it also refreshes the current PID / Core Audio process object set for the stable application ID every 2 s; a changed set rebinds through the same safe restart path, and a vanished target ends the false LIVE state and shows an error. Audio dropped before analysis is reported through `engine-backpressure` and shown as Audio Dropped in the footer until Clear or a new session.

### DSP layer (`src-tauri/src/dsp/`)

| Module               | Computes                                                                                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `peak.rs`            | Sample peak + True Peak (4× oversampling)                                                                                                                            |
| `loudness.rs`        | K-weighting → gate → M / S / I / LRA (ITU-R BS.1770 / EBU R128); True Peak Max covers every channel                                                                  |
| `channel_layouts.rs` | Embeds `shared/channel-layouts.json` and provides layout order, roles and BS.1770-5 weights; shared by live, File and CLI                                            |
| `channel_weights.rs` | Hot-path auto-detection by channel count for up to 8 channels; unknown layouts fall back to Ch1/Ch2 without allocating in the callback                               |
| `spectrum.rs`        | rFFT + Hann window, hop=N/4, 4-frame incoherent averaging; in-band energy integrated over continuous Hz edges and fractional bin overlap (no integer-bin truncation) |
| `vectorscope.rs`     | L/R → XY + correlation coefficient                                                                                                                                   |

### Orchestration layer (`src-tauri/src/engine/meter_pipeline.rs`)

PCM frames → parallel DSP → pack `MeteringFrame` → Channel (~60 Hz) to the frontend; slow loudness / state → Event (~2 Hz) broadcast.

`shared/channel-layouts.json` is the single layout table for both sides: Rust embeds it at compile time and the frontend imports it directly; contract tests hold the two sides together. The frontend sends a role list over IPC; Rust derives the weights and the report layout name once when the command arrives, so the audio hot path neither looks up the table nor allocates. The standard order is WAVE / ffmpeg; when a source actually uses SMPTE bed order, the user corrects it in the per-channel role editor instead of choosing a duplicate preset.

#### History cadence

**Core contract: source chunk size may affect CPU batching, but never determines history duration.** Three cadences each have their own job; do not mix them:

| Cadence        | Period           | Source                                                | Frontend contract                                                    |
| -------------- | ---------------- | ----------------------------------------------------- | -------------------------------------------------------------------- |
| main history   | 100 ms (~10 Hz)  | `MeterHistoryEntry`, one row per 100 ms               | `HIST_SAMPLE_SEC = 0.1` (index-grid positioning)                     |
| visual history | 40 ms (~25 Hz)   | `VisualHistEntry` / `VISUAL_EMIT_MS`                  | `VISUAL_HIST_SAMPLE_SEC = 0.04` (spectrogram positions by timestamp) |
| UI frame       | Delivery cadence | `FRAME_EMIT_MS = 16`, UI delivery + backpressure only | Not an analysis cadence; must not define history row counts          |

- **Live emits one history row per loudness block**, with no wall-clock gate. Blocks are sample-clocked 100 ms of audio but close whenever PCM is drained; a slow build drains queued callbacks back to back, so the former 95 ms wall-clock gate dropped ~20% of rows in debug builds and compressed index-positioned panels against the timestamp-positioned spectrogram. `HIST_EMIT_MS = 95` remains only as the file-mode media-time checkpoint gate.
- **File mode**: `FilePcmHistoryChunker` (`file_analysis/session.rs`) rectifies ffmpeg PCM of any size into one 100 ms block per call to the pipeline, so history row count depends only on media duration.
- **Known limitation**: file-mode visual history is held at ~10 Hz by the 100 ms blocks (live is ~25 Hz). Because the spectrogram places frames by timestamp, the time axis is still correct, only coarser.
- **Live does not use the chunker**: the capture source runs on the realtime-safe callback thread, which cannot perform the chunker's buffer allocation; live and file share the **contract** above, not the code path.

---

## 5. Frontend/backend communication (IPC)

The **only entry point** for frontend IPC is `src/ipc/`; never call `@tauri-apps/api` directly from a component or hook.

| Path                 | Direction       | Rate           | Purpose                                                              |
| -------------------- | --------------- | -------------- | -------------------------------------------------------------------- |
| **Channel**          | Rust → Frontend | ~60 Hz         | High-rate metric frames (peak, LUFS M/S, spectrum path, vectorscope) |
| **Event**            | Rust → Frontend | ~2 Hz          | Slow loudness (I/LRA), device state, health state                    |
| **invoke (command)** | Frontend → Rust | User-triggered | START/STOP, device switching, settings writes                        |

Rust commands are defined in `src-tauri/src/ipc/commands.rs`; frontend wrappers are in `src/ipc/commands.js`. Layout selection sends a role list through `set_channel_roles`, not weights computed by the frontend; Rust derives the measurement weights and `loudnessLayout` from it.

---

## 6. Theme and token system

First-paint flow (`src/main.jsx`):

1. Read `appearance` (`system`|`fixed`) and `themeId` through `settingsStore` (under Tauri, Rust pre-injects `window.__PLVS_INITIAL_STATE__`; the browser dev environment uses `localStorage`)
2. `resolveThemeId` (with `prefers-color-scheme`) → current `themeId`
3. `themeRegistry` returns the built-in or migrated current authoring document (`formatVersion: 2`, `semanticsVersion: 4`)
4. `compileTheme` validates typed recipe inputs/outputs and compiles Core Colors, Palettes and sparse Advanced overrides into a complete Resolved Theme
5. `themeRuntime` publishes that one result with an increasing revision: CSS is written to the DOM and Canvas subscribes through selectors; `applyLayoutToDocument` handles layout, font size, geometry, and non-Theme product tuning

**Token layers** (see [`design-tokens.md`](design-tokens.md) and ADR 0001/0002/0005/0011/0012/0013/0014/0015):

| Layer            | Output                                                                                                                      | Defined / published in                                                      |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Authoring intent | Versioned Core Colors, Status / Intensity / Frequency / Interface Palettes, sparse Advanced overrides (unused by built-ins) | `builtinThemesV2.js` or a migrated persisted document                       |
| Resolved roles   | Complete `solidColor`, `colorEffect`, `colorScale`, and bounded visual `number` roles                                       | `themeRoleRegistry.js` + `themeRecipes.js` → `compileTheme.js`              |
| CSS / SVG        | `--background`, `--foreground`, `--primary`, and Theme-owned `--ui-*` colour or visual-composition tokens                   | Resolved Theme `css` → `themeRuntime.js`                                    |
| Canvas           | Colour and bounded visual-composition bundles for Waveform, Vectorscope, Stereo Map, Spectrogram, etc.                      | Resolved Theme `canvas` → `themeCanvasSelectors.js` / `useResolvedTheme.js` |
| UI layout        | Product-owned `--ui-*`: font size, spacing, radius, line width, and non-Theme tuning                                        | `data.js` → `applyLayoutToDocument`                                         |

First-paint placeholder variables are written by `npm run theme:generate` to `src/generated/theme-fallbacks.css` (from the same source as the default dark semantics).

The Theme settings owner distinguishes the shared Library, the workbench's applied document
snapshot, and a temporary editor preview. Peer Library refreshes update the list without replacing
the applied snapshot or the preview. Local saves update the applied snapshot; selection changes
resolve a new one. Save/Cancel releases the preview, and Cancel restores the applied selection even
when the editor was previewing an unselected Library item. The effective document also supplies the
native appearance, so a draft's Dark/Light change follows the same publication lifecycle.

Ordinary surface content inherits `interface.text.primary`; content on solid semantic actions has
its own roles. Visual Review and Theme Gallery share the final-role contrast and separation checks
from `themeVisualAnalysis.js`, rather than checking only the upstream Core colours. These findings
remain advisory. The current built-in output snapshots are independent of frozen V1 migration
fixtures; changing a default design does not rewrite compatibility history.

Semantics 3 made ordinary Border opaque, aliased Input Border to it, and derived Grid from Panel
Surface independently. Semantics 2 documents preserve their authored Border and inherited Grid
appearance while migrating through that boundary; see
[ADR 0017](adr/0017-opaque-interface-borders-and-independent-grids.md).

Semantics 4 aligns automatic data-state and interface relationships: Loudness Momentary and
Short-term use Primary and Secondary Data, transport Live uses Status Critical, transport Snapshot
uses Primary Snapshot, and Interface feedback inherits its Interface Palette seed directly.
Semantics 1, 2, and 3 documents migrate at the existing persistence/import ingress. Explicit
Advanced overrides survive; automatic roles adopt the current relationships. Portable themes
retain format 1 and now emit semantics 4. See
[ADR 0021](adr/0021-align-automatic-theme-role-semantics.md).

Theme colour roles resolve to opaque colours. Chart fill opacity is fixed product composition,
shared by panels, Dock, and Theme Preview through `src/lib/chartFill.js` (ADR 0019). The
separate View setting `surfaceOpacity` publishes
`--surface-opacity` and is applied only where PLVS composes structural fills: the Workspace, normal
shell surfaces, panels, fullscreen, file-summary shell, and Dock shell. Borders, controls, text,
focus/state marks, and Canvas/SVG measurement data do not inherit that opacity. Floating overlays
use opaque Raised surfaces; editors and dialogs use opaque Modal surfaces. Persisted `panelOpacity`
values are migrated to the renamed field when Settings, Presets, or configuration profiles are
read. Rust owns the native shadow policy: on macOS a normal window disables its shadow exactly at
zero surface opacity because AppKit otherwise derives a fragmented shadow from the remaining opaque
content; Dock remains shadowless, and Windows retains its normal-window shadow.

The old `builtinThemes.js`, `buildThemeTokens.js` and `legacy/resolveV1Theme.js` are not part of the
runtime theme pipeline; they are kept only for the frozen V1 migration, fixtures and regression tests.
New consumers must not import them.

### Portable Theme boundary

The persisted authoring document, portable sharing document, and compiled result are separate
contracts (ADR 0009). A portable `plvs-theme` document contains only stable authoring meaning:
name, Dark/Light scheme, literal Core and Palette colours, and explicit public Advanced color, reference, and effect overrides.
It has its own `formatVersion` and `semanticsVersion` and never contains a local Theme ID, palette
preset provenance, recipes, dependencies, resolved roles, CSS variables, Canvas keys, or native
bindings.

`src/theme/portableTheme.js` is the pure conversion and validation boundary shared by desktop and
Agent Control transfer. It canonicalizes normalized fields and sorted overrides; SHA-256 over that
canonical UTF-8 JSON is the content identity. Theme Pack V2 uses the shared Pack V2 envelope
(`app`, `kind`, `version`, optional `createdWith`, non-empty `items`, and an empty `dependencies`
list); each item is the portable document plus its local `id`, which only merge handling reads and
content identity excludes. Import converts the portable document back to the current
persisted shape with palette preset IDs set to `null`, then the normal compiler/registry validation
still applies. A standalone `plvs-theme` document (clipboard or community download) has no ID, so
import matches it by content identity against the whole custom library and mints a fresh local ID
for new content; Theme Pack items keep the ID-based merge rules. Theme Pack V1 remains readable
through the legacy migration path, but no invalid Theme entry is silently discarded.

### Portable Preset boundary

`src/transfer/portablePreset.js` converts saved Presets into strict `plvs-preset` documents built
from the public Workspace, Panel, Axis, presentation and Dock vocabulary. Portable documents use
artefact-local panel keys and exclude local panel IDs, window and monitor geometry, device/source
selection, measurements, history contents and offsets, active/dirty state, and editor drafts.
Import compiles the document back into the current persisted Preset shape with newly allocated
panel IDs; it adds Library content without applying it.

Import stays strict: an unknown control or field rejects the Item. Forward compatibility comes from
the export side instead. A panel's `controls` object carries only the public controls that differ
from their defaults, because import fills every omitted control with its default. A build that adds
a public control therefore still produces files an older build can read, unless the author actually
changed that control, which the older build could not honour anyway. The consequences are:

- Adding a public control, or an optional field whose absence keeps the old behaviour, needs no
  version change.
- Changing the default or the meaning of an existing control changes what older files mean, so it
  requires a `semanticsVersion` bump.
- Adding a required field or changing the document structure requires a `formatVersion` bump.

Preset Pack V2 carries referenced Loudness Profiles in its single `loudness-profile` dependency
group. Dependencies are validated before primary Presets, then normal library merge planning
allocates or reuses local Profile IDs and rewrites each imported Preset reference to that result.
Pack V1 remains readable through the legacy normalization path.

### Screen-space sizes (CSS px vs device px)

Every visual size PLVS specifies (stroke-width tokens such as `--ui-spectrum-stroke-width`, grid
and guide lines, point radii, paddings) is **CSS px, meaning the final size on screen**. It must
look the same at any `devicePixelRatio`. `devicePixelRatio` combines the display scale and, in
WebView2, the Windows text scale. Interface Size swaps typography and iconography tokens only; it
changes neither DPR nor line widths.

How each renderer meets the rule:

| Renderer                                                             | How a CSS-px length reaches the screen                                                                                                                                                                                                   |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SVG in a stretched viewBox (`preserveAspectRatio="none"`)            | every stroke sets `vector-effect="non-scaling-stroke"`; `stroke-width` and `stroke-dasharray` are then CSS px                                                                                                                            |
| CSS borders                                                          | CSS px. At fractional DPR, Chromium floors border widths to whole device pixels, so a 1px border and a 1px SVG stroke can differ very slightly                                                                                           |
| Canvas 2D                                                            | draws in backing-store (device) pixels under the identity transform and multiplies each length by the canvas's own scale; `ctx.scale(dpr)` is not used                                                                                   |
| Canvas 2D with per-axis scales (Waveform: width capped, height full) | paths in backing pixels, strokes through `strokeCssWidth` (`src/lib/canvasCssScale.js`), which scales only the pen so it stays round on screen                                                                                           |
| WebGL (Spectrogram 3D Surface)                                       | framebuffer and viewport in device pixels; a CSS-px width arrives as a device-px uniform. `gl.LINES` is always one device pixel, so lines with a specified width are extruded into quads (see the floor in `spectrogram3dGlRenderer.js`) |

Rules:

- Derive the scale from the canvas itself (`canvas.width / canvas.clientWidth`, per axis), never
  from `window.devicePixelRatio` inside draw code. A capped backing store makes the global wrong.
- Name constants with their unit (`*_CSS_PX`). A device-px value is a local derived at draw time.
- Every 2D and WebGL canvas sizes its backing store through `useCanvasBackingStore`
  (`src/hooks/useCanvasBackingStore.js`), which measures the canvas's own box. Where the browser
  reports `devicePixelContentBoxSize` (Chromium, WebView2) the backing store takes exactly the
  physical pixels the element covers, so it maps 1:1 onto the screen and is not resampled.
  Elsewhere (WebKit) it falls back to `round(fractional CSS size x DPR)`, which can be a pixel off
  and blur 1 px lines slightly. A capped axis always uses `round(CSS size x cap)`.
- Backing stores re-measure when the box changes **and** when DPR changes with the box
  unchanged (`watchDevicePixelRatio`), for example after the window is dragged to a monitor with a
  different scale.
- Waveform buckets are one per backing column, so the bucket count is the lane canvas's reported
  backing width, never a width measured separately.
- A DPR cap for performance may lower resolution; it must never change visual stroke weight.
- Visual density (how many ridges, sample points or decimation buckets a panel shows) is set per CSS
  px, so a panel looks the same at every DPR and a scaled display does not multiply the drawing
  cost. Only raster resolution (heatmap pixels, per-pixel sampling) follows device pixels.
- WebGL canvases use `premultipliedAlpha: true` and shaders write premultiplied colour. Otherwise
  every translucent pixel, including every antialiased edge, is multiplied by alpha twice, and a thin
  line renders darker than its background.
- Grids, axes and guides are 1 CSS px. Selection markers use `--ui-loudness-selection-stroke-width`
  in every panel.
- Optional chart grids use the current normalized axis tick models and discard boundary ticks, so
  labels and guides stay aligned through pan and zoom without repainting the plot frame. Waveform
  has no centre reference line and Stereo Map has no unconditional zero line. SVG grid lines are
  not snapped: `shape-rendering="crispEdges"` was measured to drop 1 px lines entirely.
- Icons and illustrative thumbnails that scale uniformly are exempt. Their stroke scales with the
  graphic by design.

Declared exceptions (device px on purpose):

- **Spectrogram 3D Lines ridges**: 1 device px (`RIDGE_LINE_WIDTH`). Anything wider leaves the
  renderer's hairline fast path, and the measured GPU cost is a cliff. On a scaled display the ridges
  are therefore thinner than 1 CSS px.

---

## 7. Key terms

| Term                | Definition                                                                                                                               |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **WASAPI Loopback** | Native Windows API that reads an output device as an input, with no virtual sound card                                                   |
| **Core Audio Tap**  | Native system-audio capture on macOS 14.2+ (the equivalent of WASAPI Loopback)                                                           |
| **realtime-safe**   | The audio callback thread does not allocate, lock or make syscalls                                                                       |
| **Channel**         | Tauri's high-rate one-way push channel (~60 Hz metric frames)                                                                            |
| **plvs:settings**   | Persisted global preferences: `appearance`, `themeId`, `referenceLufs`, panel label overrides, etc.                                      |
| **plvs:workspace**  | Persisted workspace layout tree and each panel's control state                                                                           |
| **plvs:presets**    | Persisted user-saved workspace presets                                                                                                   |
| **plvs:themes**     | Persisted custom themes                                                                                                                  |
| **windowBounds**    | Top-level key in `plvs-settings.json`; Rust maintains window geometry separately so JS settings writes cannot overwrite it               |
| **dockState**       | Top-level key in `plvs-settings.json` (maintained by Rust): dock enabled / edge / display; windowBounds stops being written while docked |

### Dock three-window boundary

The Dock form consists of three native windows: `main` is the meter strip, 56-160 logical px and 56 px
by default; `dock-header` is a full-width 44 logical px transient toolbar; `dock-editor` is a
right-aligned single-column editor. On Windows only `main` registers as an AppBar; with Reserve
screen space enabled only the meter strip is reserved, and header/editor always overlay the adjacent
work area, so hovering never reflows maximized windows.

Rust's `dock.rs` / `dock_accessories.rs` own physical-pixel geometry and window lifecycle. The main
React root owns the runtime, workspace, presets and Dock persistence; the two accessory roots receive
only serialisable snapshots and send actions/pointer events back through semantic Tauri events,
without mounting audio intake or a persistence store owner. Dock panel display controls live in
`workspaceStore.dock.controlsByPanelId`, separate from the normal workspace's `panelControlsById`; the
old `controlsByModuleId` is kept only as a compatibility field. The measurement runtime and channel
label semantics are still shared.

### Dock live interaction boundary (deliberately minimal)

Dock reuses only a subset of the normal panels' live interactions; the rest is **deliberately left out**, not missing — for finer adjustment or browsing history, switch to normal mode / snapshot. Do not keep re-checking this against the code; the current state is:

Dock has:

- **TP-max reset** (`DockLevel`: click the readout to reset the true-peak maximum)
- **Vectorscope peak-hold reset** (`DockVectorscope` polarLevel: click the plot to reset peak hold)
- **Time-window zoom** (`DockWaveform` / `DockLoudness` / `DockSpectrogram`: wheel zoom + right double-click reset + window-seconds HUD). It is a reduced subset of the normal `useHistoryInteraction`, implemented separately in `useDockHistoryViewport`, with window width only, no time offset, and zoom not anchored at the cursor.

Dock deliberately lacks:

- **Value-axis zoom/pan** (normal mode's `useAxisInteraction` provides axis zoom for Level/Spectrum/Spectrogram/Loudness) — the dock strip is too narrow to have a grabbable axis.
- **Panning the time axis into history / scrub selection** — the dock is a live-only viewport; history belongs to snapshot.
- **Spectrum press-and-hold curve freeze** and **Vectorscope hold-slow trails** — both "hold" gestures; the first is feasible but low value, and half of the second is already covered by the dock's always-on correlation smoothing while the other half (Lissajous phosphor) is costly for little return. Both were evaluated and dropped.

---

## 8. Platform notes

| Platform | System audio path                                                  | Minimum version                                                                  |
| -------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Windows  | WASAPI Loopback (cpal); Application Process Loopback               | Windows 10+; per-application capture needs build 20348+ (in practice Windows 11) |
| macOS    | Core Audio process tap (global or per-application process objects) | macOS 14.2+ (required for taps)                                                  |

Fallback behaviour on macOS below 14.2 or without tap support is defined by the code. User installation guidance, including Windows SmartScreen and macOS Gatekeeper verification, is in `docs/user/getting-started.md`.
