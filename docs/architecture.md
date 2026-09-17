# PLVS — Architecture

> **Purpose**: the technical map of PLVS — stack, directory layout, audio pipeline, frontend/backend communication, theme system.  
> **Audience**: the project author and AI agents. The **implementation on `main`** is authoritative; when this document and the code disagree, the code wins.  
> **Related**: product scope in [`prd.md`](prd.md); UI token details in [`design-tokens.md`](design-tokens.md); architecture decisions in [`adr/`](adr/).

---

## 1. Tech stack

**Tauri 2 + Rust (backend) + React 19 / Vite (frontend)**

| Layer         | Technology                        | Responsibility                                               |
| ------------- | --------------------------------- | ------------------------------------------------------------ |
| Desktop shell | Tauri 2                           | System WebView, process management, platform API bridging    |
| Audio engine  | Rust + cpal / Core Audio          | PCM capture, DSP (peak / LUFS / FFT / vectorscope)           |
| Frontend UI   | React 19 + Vite + Tailwind CSS v4 | Panel rendering, layout, settings                            |
| Components    | shadcn/ui (Radix)                 | Shell and settings controls                                  |
| Tests         | Vitest                            | Frontend unit tests (next to the source, `*.test.js/jsx`)    |

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

Visual Capture keeps the same semantic boundary: React chooses the capture target, waits for a stable
paint and supplies CSS geometry; Rust owns the private artifacts, concurrency and lifecycle. Windows
screenshots use WebView2 and macOS screenshots use the WKWebView snapshot; both capture only the PLVS
WebView content. Windows recording uses Windows Graphics Capture and Media Foundation, macOS
recording uses ScreenCaptureKit and AVAssetWriter. Both reuse Rust's measured-source PCM timeline and
encode H.264/AAC MP4.

---

## 3. Directory layout

This lists only **what each top-level directory is responsible for**, not files. File-level content
changes too quickly and goes stale as soon as it is written down — look at the directory when you
need it. When adding a top-level directory, add a row in the same commit.

**Frontend `src/`**

| Directory | Responsibility |
| --- | --- |
| `ipc/` | ★ The only boundary between the frontend and the Rust audio engine: `invoke`, Channel and Event all go through here |
| `components/` | UI components; `panels/` holds the meter panels, `ui/` the shadcn/ui primitives |
| `workspace/` | Split-tree workspace layout, panel registration and data providers; logic-only code imports only `moduleCatalog.js` |
| `dock/` | Dock mode: the meter strip and accessory WebViews (header / editor) |
| `hooks/` | React hooks and shared contexts |
| `runtime/` | Ownership and derived state of the metering runtime (live measurement owner, runtime context) |
| `analysis/` | Analysis requests derived from panel configuration |
| `lib/` | Engine integration and history storage (FrameIntake, history slabs, etc.) |
| `math/` | Pure functions: history paths, formatting, spectrum and channel-layout calculations |
| `theme/` | Theme V2: built-in themes, Role Registry, compiler, runtime publication, V1 migration |
| `preferences/` | Non-colour interface tuning (layout, fonts, radii, interface size) and applying it to the document |
| `config/` | Static configuration shared with the Rust DSP, such as scale definitions |
| `settings/` | Setting defaults and option lists |
| `persistence/` | Domain-split persistence; choose the domain in `index.js` before adding data |
| `transfer/` | Import and export (packs) of themes, loudness profiles and preset libraries |
| `agentControl/` | Frontend command implementations, schemas and snapshots for Agent Control |
| `data/` | Static data (shortcut definitions) |
| `dev/` | Development-only performance and profiling tools |
| `generated/` | Generated by `npm run theme:generate`; never edited by hand |

**Backend `src-tauri/`**

| Location | Responsibility |
| --- | --- |
| `src/audio/` | Capture layer: cpal, platform backends, macOS tap, device enumeration and identity |
| `src/dsp/` | Peak, loudness, spectrum, vectorscope, VAD, channel layouts and weights |
| `src/engine/` | Orchestration: PCM → metering frames → Channel / Event push |
| `src/file_analysis/` | File mode: ffmpeg probing and decoding, session history |
| `src/ipc/` | Tauri commands, events and binary frame encoding |
| `src/agent_control/` | Agent Control broker, discovery, framing protocol and enablement |
| `src/visual_capture/` | Screenshots and recording (per-platform implementations) |
| `src/cli_*.rs`, `doctor.rs` | `plvs-cli` subcommands and installation diagnosis |
| `src/dock*.rs`, `appbar.rs` | Dock windows and the Windows appbar screen-space reservation |
| Other `src/*.rs` | Single-purpose modules: app entry and state, windows, sidecar, crash reporting, etc. |
| `plvs-cli/` | Standalone lightweight CLI forwarder package |
| `native/macos/` | Objective-C bridge for the Core Audio process tap |
| `capabilities/`, `tauri*.conf.json` | Tauri permission declarations and bundle configuration |

---

## 4. Audio pipeline

### Capture layer (`src-tauri/src/audio/`)

- **Windows**: `cpal_backend.rs` opens WASAPI Loopback through `cpal` — no virtual sound card, it reads the system output PCM directly; physical inputs also go through cpal. Application sources use `ActivateAudioInterfaceAsync` in `windows_process_loopback.rs`; a stable application ID derived from the executable path is resolved to the current PID on every start. Because that interface does not report a mix format, PLVS explicitly requests float32 at the current default output's sample rate and a verified channel layout (mono / stereo / 5.1 / 7.1; other layouts fall back safely to stereo) before entering the same meter pipeline. This path requires Windows build 20348+ and cannot capture ASIO or WASAPI exclusive-mode output that bypasses the system mixer.
- **macOS**: system audio goes through `macos/` (Core Audio process tap, macOS 14.2+); physical inputs go through cpal. Global system output uses a device-specific tap that excludes an empty process list. Application sources keep the running ordinary GUI hosts among the Core Audio process objects, derive a stable application ID from the host bundle, merge helper processes under the same host and capture them with `CATapDescription initWithProcesses`. Pausing does not remove a source, because the HAL may temporarily empty the output device list and a process tap may legitimately stop calling back. Application taps currently follow the default output device and keep that device's native channel layout. Platform dispatch lives in `platform_backend.rs`.
- **Capture health**: a running capture with no callback for longer than `CAPTURE_STALL_TIMEOUT` (5 s) is treated as failed; `engine-state-changed` emits `error`, and the frontend stays in `error` and shows the reason. Windows loopback without a silence stream is excluded from the pure callback-stall check (it does not call back during silence), but still reacts immediately to fatal backend stream errors. Windows `DeviceNotAvailable` / `StreamInvalidated` are reported as a structured `deviceInvalidated` reason; the frontend releases the old stream, re-resolves the current device, clears the interrupted Live measurement and rebuilds once automatically. The next recovery is allowed only after the replacement has produced audio for two seconds, which prevents failure loops. The device monitor thread observes both the device list and the current default output every 2 s; under Automatic, a default output change restarts capture. With an Application selected, it also refreshes the current PID / Core Audio process object set for the stable application ID every 2 s; a changed set rebinds through the same safe restart path, and a vanished target ends the false LIVE state and shows an error. Audio dropped before analysis is reported through `engine-backpressure` and shown as Audio Dropped in the footer until Clear or a new session.

### DSP layer (`src-tauri/src/dsp/`)

| Module               | Computes                                                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `peak.rs`            | Sample peak + True Peak (4× oversampling)                                                                                                |
| `loudness.rs`        | K-weighting → gate → M / S / I / LRA (ITU-R BS.1770 / EBU R128); True Peak Max covers every channel                                      |
| `channel_layouts.rs` | Embeds `shared/channel-layouts.json` and provides layout order, roles and BS.1770-5 weights; shared by live, File and CLI                |
| `channel_weights.rs` | Hot-path auto-detection by channel count for up to 8 channels; unknown layouts fall back to Ch1/Ch2 without allocating in the callback   |
| `spectrum.rs`        | rFFT + Hann window, hop=N/4, 4-frame incoherent averaging; in-band energy integrated over continuous Hz edges and fractional bin overlap (no integer-bin truncation) |
| `vectorscope.rs`     | L/R → XY + correlation coefficient                                                                                                       |

### Orchestration layer (`src-tauri/src/engine/meter_pipeline.rs`)

PCM frames → parallel DSP → pack `MeteringFrame` → Channel (~60 Hz) to the frontend; slow loudness / state → Event (~2 Hz) broadcast.

`shared/channel-layouts.json` is the single layout table for both sides: Rust embeds it at compile time and the frontend imports it directly; contract tests hold the two sides together. The frontend sends a role list over IPC; Rust derives the weights and the report layout name once when the command arrives, so the audio hot path neither looks up the table nor allocates. The standard order is WAVE / ffmpeg; when a source actually uses SMPTE bed order, the user corrects it in the per-channel role editor instead of choosing a duplicate preset.

#### History cadence

**Core contract: source chunk size may affect CPU batching, but never determines history duration.** Three cadences each have their own job; do not mix them:

| Cadence        | Period            | Source                                   | Frontend contract                                                      |
| -------------- | ----------------- | ---------------------------------------- | ---------------------------------------------------------------------- |
| main history   | 100 ms (~10 Hz)   | `MeterHistoryEntry`, one row per 100 ms  | `HIST_SAMPLE_SEC = 0.1` (index-grid positioning)                       |
| visual history | 40 ms (~25 Hz)    | `VisualHistEntry` / `VISUAL_EMIT_MS`     | `VISUAL_HIST_SAMPLE_SEC = 0.04` (spectrogram positions by timestamp)   |
| UI frame       | Delivery cadence  | `FRAME_EMIT_MS = 16`, UI delivery + backpressure only | Not an analysis cadence; must not define history row counts |

- **`HIST_EMIT_MS = 95`** is a wall-clock **tolerance gate** for live (it lets a nominal 100 ms block emit when slightly under 100 ms), not a semantic period.
- **File mode**: `FilePcmHistoryChunker` (`file_analysis/session.rs`) rectifies ffmpeg PCM of any size into one 100 ms block per call to the pipeline, so history row count depends only on media duration.
- **Known limitation**: file-mode visual history is held at ~10 Hz by the 100 ms blocks (live is ~25 Hz). Because the spectrogram places frames by timestamp, the time axis is still correct, only coarser.
- **Live does not use the chunker**: the capture source runs on the realtime-safe callback thread, which cannot perform the chunker's buffer allocation; live and file share the **contract** above, not the code path.

---

## 5. Frontend/backend communication (IPC)

The **only entry point** for frontend IPC is `src/ipc/`; never call `@tauri-apps/api` directly from a component or hook.

| Path                 | Direction       | Rate           | Purpose                                                          |
| -------------------- | --------------- | -------------- | ---------------------------------------------------------------- |
| **Channel**          | Rust → Frontend | ~60 Hz         | High-rate metric frames (peak, LUFS M/S, spectrum path, vectorscope) |
| **Event**            | Rust → Frontend | ~2 Hz          | Slow loudness (I/LRA), device state, health state                |
| **invoke (command)** | Frontend → Rust | User-triggered | START/STOP, device switching, settings writes                    |

Rust commands are defined in `src-tauri/src/ipc/commands.rs`; frontend wrappers are in `src/ipc/commands.js`. Layout selection sends a role list through `set_channel_roles`, not weights computed by the frontend; Rust derives the measurement weights and `loudnessLayout` from it.

---

## 6. Theme and token system

First-paint flow (`src/main.jsx`):

1. Read `appearance` (`system`|`fixed`) and `themeId` through `settingsStore` (under Tauri, Rust pre-injects `window.__PLVS_INITIAL_STATE__`; the browser dev environment uses `localStorage`)
2. `resolveThemeId` (with `prefers-color-scheme`) → current `themeId`
3. `themeRegistry` returns the built-in or migrated custom V2 authoring document
4. `compileTheme` compiles Core Colors, Palettes and sparse Advanced overrides into a complete Resolved Theme
5. `themeRuntime` publishes that one result with an increasing revision: CSS is written to the DOM and Canvas subscribes through selectors; `applyLayoutToDocument` handles only layout / font size / geometry / non-colour variables

**Token layers** (see [`design-tokens.md`](design-tokens.md) and ADR 0001/0002/0005):

| Layer            | Output                                                                                                            | Defined / published in                                                      |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Authoring intent | Core Colors, Status / Intensity / Frequency / Interface Palettes, sparse Advanced overrides (unused by built-ins) | `builtinThemesV2.js` or a persisted V2 document                             |
| Resolved roles   | Complete interface, instrument, effect and native roles                                                           | `themeRoleRegistry.js` → `compileTheme.js`                                  |
| CSS / SVG        | `--background`, `--foreground`, `--primary` and `--ui-*` color tokens                                             | Resolved Theme `css` → `themeRuntime.js`                                    |
| Canvas           | Colour bundles for Waveform, Vectorscope, Stereo Map, Spectrogram, etc.                                           | Resolved Theme `canvas` → `themeCanvasSelectors.js` / `useResolvedTheme.js` |
| UI layout        | Non-colour `--ui-*`: font size, spacing, radius, line width                                                       | `data.js` → `applyLayoutToDocument`                                         |

First-paint placeholder variables are written by `npm run theme:generate` to `src/generated/theme-fallbacks.css` (from the same source as the default dark semantics).

The old `builtinThemes.js`, `buildThemeTokens.js` and `legacy/resolveV1Theme.js` are not part of the
runtime theme pipeline; they are kept only for the frozen V1 migration, fixtures and regression tests.
New consumers must not import them.

---

## 7. Key terms

| Term                | Definition                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **WASAPI Loopback** | Native Windows API that reads an output device as an input, with no virtual sound card                             |
| **Core Audio Tap**  | Native system-audio capture on macOS 14.2+ (the equivalent of WASAPI Loopback)                                     |
| **realtime-safe**   | The audio callback thread does not allocate, lock or make syscalls                                                 |
| **Channel**         | Tauri's high-rate one-way push channel (~60 Hz metric frames)                                                      |
| **plvs:settings**   | Persisted global preferences: `appearance`, `themeId`, `referenceLufs`, panel label overrides, etc.                |
| **plvs:workspace**  | Persisted workspace layout tree and each panel's control state                                                     |
| **plvs:presets**    | Persisted user-saved workspace presets                                                                             |
| **plvs:themes**     | Persisted custom themes                                                                                            |
| **windowBounds**    | Top-level key in `plvs-settings.json`; Rust maintains window geometry separately so JS settings writes cannot overwrite it |
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

| Platform | System audio path                                                  | Minimum version                                                                    |
| -------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Windows  | WASAPI Loopback (cpal); Application Process Loopback               | Windows 10+; per-application capture needs build 20348+ (in practice Windows 11)   |
| macOS    | Core Audio process tap (global or per-application process objects) | macOS 14.2+ (required for taps)                                                    |

Fallback behaviour on macOS below 14.2 or without tap support is defined by the code. User guidance on unsigned-install friction (Gatekeeper / SmartScreen) is in `README.md`.
