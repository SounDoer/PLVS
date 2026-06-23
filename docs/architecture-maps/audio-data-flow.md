# Audio Data Flow

This is the most important runtime path in PLVS.

```mermaid
sequenceDiagram
  participant User
  participant App as App.jsx
  participant Hook as useAudioEngine
  participant IPC as src/ipc/commands.js
  participant RustCmd as ipc/commands.rs
  participant Capture as audio/AudioCapture
  participant Pipeline as engine/MeterPipeline
  participant DSP as dsp/*
  participant Intake as FrameIntake
  participant Panels as Meter panels

  User->>App: Click START
  App->>Hook: running = true
  Hook->>IPC: listAudioDevices()
  IPC->>RustCmd: invoke("list_audio_devices")
  RustCmd->>Capture: list devices
  Capture-->>RustCmd: device list
  RustCmd-->>IPC: devices
  Hook->>IPC: startAudioCapture({ deviceId, onFrame })
  IPC->>RustCmd: invoke("audio_start", Channel)
  RustCmd->>Capture: start_session(...)
  Capture->>Pipeline: push PCM chunks
  Pipeline->>DSP: peak/loudness/spectrum/vectorscope
  DSP-->>Pipeline: meter values
  Pipeline-->>RustCmd: AudioFramePayload
  RustCmd-->>IPC: Channel message
  IPC-->>Hook: onFrame(payload)
  Hook->>Intake: pushFrame / pushVisualHistRow
  Intake-->>Panels: history and snapshots
  Panels-->>User: redraw meters
  Hook->>IPC: ackFrames(seq)
```

## Key Timing

```mermaid
flowchart LR
  PCM["PCM chunks from OS audio"] --> Pipeline["MeterPipeline"]
  Pipeline --> Frame["~16 ms frame payload\nlive meter values"]
  Pipeline --> Visual["~40 ms visual history\nwaveform/spectrum/vectorscope history"]
  Pipeline --> Hist["~95 ms loudness history\nM/ST paths and snapshots"]

  Frame --> React["React state update"]
  Visual --> Intake["FrameIntake visual rings"]
  Hist --> Intake
```

## Why FrameIntake Exists

`FrameIntake` keeps high-frequency audio history out of scattered React state.
It owns ring buffers for loudness, waveform, spectrum, vectorscope, channel
metadata, and snapshot lookup. Without it, every panel would need to duplicate
history logic.

## Debugging Tip

When a panel looks wrong, ask which stage is wrong:

1. Rust did not produce the expected value.
2. IPC payload is correct, but frontend intake stored it incorrectly.
3. Intake is correct, but the panel selected the wrong snapshot/request key.
4. Panel rendering math is wrong.
