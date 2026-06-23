# Rust Module Map

```mermaid
flowchart TB
  Main["main.rs / lib.rs\nTauri app setup"] --> State["state.rs\nAppState"]
  Main --> IPC["ipc/"]
  Main --> Audio["audio/"]
  Main --> Engine["engine/"]
  Main --> DSP["dsp/"]

  IPC --> Commands["commands.rs\n#[tauri::command] handlers"]
  IPC --> Types["types.rs\npayload structs"]
  IPC --> Events["events.rs\nevent helpers"]

  Commands --> State
  Commands --> Audio
  Commands --> Engine

  Audio --> Capture["capture.rs\nsession lifecycle"]
  Audio --> Device["device*.rs\ndevice identity and enumeration"]
  Audio --> Cpal["cpal_backend.rs\ncross-platform capture"]
  Audio --> Platform["platform_backend.rs\nplatform dispatch"]
  Audio --> Mac["macos/\nCore Audio tap bridge"]

  Capture --> Engine
  Engine --> Pipeline["meter_pipeline.rs\nPCM -> AudioFramePayload"]
  Pipeline --> DSP

  DSP --> Peak["peak.rs"]
  DSP --> Loudness["loudness.rs"]
  DSP --> Spectrum["spectrum.rs + spectrum_bank.rs"]
  DSP --> Vectorscope["vectorscope.rs"]
  DSP --> Dialogue["dialogue.rs"]
  DSP --> Filters["filters.rs"]
  DSP --> Paths["paths.rs\nSVG path generation helpers"]
```

## Native Runtime Story

1. Tauri starts and registers command handlers.
2. The frontend calls `audio_start`.
3. `commands.rs` creates a capture session and stores it in `AppState`.
4. The capture layer reads PCM from the selected device.
5. `MeterPipeline` converts PCM into `AudioFramePayload`.
6. The payload is sent to the frontend over a Tauri Channel.

## Most Useful Rust Files

| File | Why it matters |
| --- | --- |
| `src-tauri/src/ipc/commands.rs` | The Rust side of frontend commands |
| `src-tauri/src/ipc/types.rs` | Shared payload shapes |
| `src-tauri/src/audio/capture.rs` | Capture session lifecycle |
| `src-tauri/src/audio/cpal_backend.rs` | Device/capture backend |
| `src-tauri/src/engine/meter_pipeline.rs` | Core audio frame assembly |
| `src-tauri/src/dsp/loudness.rs` | Loudness calculation |
| `src-tauri/src/dsp/spectrum.rs` | Spectrum calculation |
| `src-tauri/src/dsp/vectorscope.rs` | Vectorscope calculation |

## Beginner Reading Order

1. `src-tauri/src/ipc/commands.rs`
2. `src-tauri/src/audio/capture.rs`
3. `src-tauri/src/engine/meter_pipeline.rs`
4. `src-tauri/src/ipc/types.rs`
5. One DSP module at a time
