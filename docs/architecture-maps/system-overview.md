# System Overview

PLVS is a desktop audio metering app. The user sees React panels, but the actual
audio capture and DSP work happen in Rust through Tauri.

```mermaid
flowchart TB
  subgraph Frontend["src/ React frontend"]
    App["App.jsx\nshell, toolbar, app state"]
    Workspace["workspace/\nsplit tree, tabs, panel routing"]
    Panels["components/panels/\nLevel Meter, Loudness, Spectrum,\nSpectrogram, Vectorscope, Waveform"]
    Hooks["hooks/\nuseAudioEngine, useSettings,\nusePresets, useSnapshot"]
    Intake["lib/FrameIntake.js\nlive frame history and snapshots"]
    FrontendIPC["ipc/commands.js + ipc/events.js\nsingle frontend IPC entrypoint"]
  end

  subgraph Boundary["Tauri boundary"]
    Invoke["invoke commands\nfrontend -> Rust"]
    Channel["Channel frames\nRust -> frontend, high rate"]
    Events["events\nRust -> frontend, low rate"]
  end

  subgraph Backend["src-tauri/ Rust backend"]
    Commands["ipc/commands.rs\nTauri command handlers"]
    State["state.rs\nshared app state"]
    Capture["audio/\ncpal, WASAPI loopback, Core Audio"]
    Engine["engine/meter_pipeline.rs\nPCM -> metering frames"]
    DSP["dsp/\npeak, loudness, spectrum, vectorscope"]
  end

  App --> Workspace
  Workspace --> Panels
  App --> Hooks
  Hooks --> FrontendIPC
  Hooks --> Intake
  Panels --> Intake

  FrontendIPC --> Invoke
  Invoke --> Commands
  Commands --> State
  Commands --> Capture
  Capture --> Engine
  Engine --> DSP
  DSP --> Engine
  Engine --> Channel
  Commands --> Events
  Channel --> FrontendIPC
  Events --> FrontendIPC
  FrontendIPC --> Hooks
```

## Read This As A Story

The UI does not capture audio directly. It asks Rust to start capture through
`src/ipc/commands.js`. Rust owns the capture session, computes meter frames,
and pushes those frames back to the frontend. The frontend stores recent frames
in `FrameIntake`, and panels render from that shared history.

## First Files To Open

- `src/App.jsx`: top-level app state and wiring.
- `src/hooks/useAudioEngine.js`: start/stop and frame subscription lifecycle.
- `src/ipc/commands.js`: frontend command names.
- `src-tauri/src/ipc/commands.rs`: Rust command handlers.
- `src-tauri/src/engine/meter_pipeline.rs`: core PCM-to-metering conversion.
- `src/lib/FrameIntake.js`: frontend history buffers.
