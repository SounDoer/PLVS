# Frontend Module Map

```mermaid
flowchart TB
  Main["main.jsx\nReact mount and first-paint theme"] --> App["App.jsx\napp shell"]

  App --> Hooks["hooks/"]
  App --> Workspace["workspace/"]
  App --> Components["components/"]
  App --> Preferences["preferences/"]
  App --> Theme["theme/"]

  Hooks --> AudioHook["useAudioEngine\nnative capture lifecycle"]
  Hooks --> SettingsHook["useSettings\nsettings persistence"]
  Hooks --> PresetsHook["usePresets\nlayout/view presets"]
  Hooks --> SnapshotHook["useSnapshot\nhistory scrubbing"]
  Hooks --> FocusHook["useFocusViewWindow\nwindow shell behavior"]

  AudioHook --> IPC["ipc/\ncommands and events"]
  AudioHook --> Lib["lib/\nFrameIntake, tauriFrameApply,\naudioEngineCommands"]

  Workspace --> Registry["registry.jsx\npanel id -> component"]
  Workspace --> Reducer["reducer.js\nworkspace tree state"]
  Workspace --> Split["SplitLayout.jsx\nresizable tree"]
  Workspace --> Leaf["LeafView.jsx\ntabs and panel hosts"]

  Registry --> Panels["components/panels/"]
  Panels --> Level["LevelMeterPanel"]
  Panels --> Loudness["LoudnessPanel"]
  Panels --> Stats["StatsPanel"]
  Panels --> Spectrum["SpectrumPanel"]
  Panels --> Spectrogram["SpectrogramPanel"]
  Panels --> Vectorscope["VectorscopePanel"]
  Panels --> Waveform["WaveformPanel"]

  Preferences --> Persistence["persistence/\nstorage backends"]
  Theme --> Generated["generated/theme-fallbacks.css"]
```

## Folder Roles

| Folder | Role |
| --- | --- |
| `components/` | Reusable UI and panel components |
| `components/panels/` | The actual meters the user sees |
| `hooks/` | Lifecycle and side effects |
| `ipc/` | The only frontend path into Tauri |
| `lib/` | Shared runtime helpers and frame/history logic |
| `math/` | Pure display math |
| `preferences/` | UI preference parsing and application |
| `persistence/` | Storage backend abstraction |
| `theme/` | Built-in/custom theme definitions and token derivation |
| `workspace/` | Split-pane layout, panel instances, and tab routing |

## Beginner Reading Order

1. `src/App.jsx`
2. `src/workspace/registry.jsx`
3. `src/hooks/useAudioEngine.js`
4. `src/lib/FrameIntake.js`
5. One panel, such as `src/components/panels/LoudnessPanel.jsx`

Do not try to read every panel at once. They share patterns.
