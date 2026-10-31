# PLVS — Glossary

The user-facing terms PLVS uses, what each one means, and the one Chinese form used for them in
subtitles and voice-over. The English term is the label the app shows; when this file and the UI
disagree, the UI on `main` wins and this file is corrected.

## Rules

- A new user-visible concept gets its term here in the same commit that adds the label. Reuse an
  existing term before inventing a synonym; the **Avoid** column lists words that have been used
  for the same thing and should not come back.
- English labels follow the Title Case convention in `AGENTS.md`.
- Subtitles and voice-over both use the **Chinese** column. The first time a term appears in a
  video, the subtitle adds the English label in brackets, for example 预设（Preset）, because the
  interface on screen stays English. Later appearances use the Chinese alone.
- Terms in [Kept in English](#kept-in-english) are never translated, in subtitles or voice-over;
  their **Chinese** cell repeats the English term.

## Core concepts

| Term               | Meaning                                                                                             | Chinese      | Avoid                       |
| ------------------ | --------------------------------------------------------------------------------------------------- | ------------ | --------------------------- |
| Workbench          | One running PLVS measurement unit with its own Source, Workspace and measurement; several can run   | 工作台       | window, instance (CLI only) |
| Main Workbench     | The Workbench that owns application-wide work such as updates                                       | 主工作台     |                             |
| Workspace          | The panels in the window, their arrangement and each panel's settings                               | 工作区       | layout                      |
| Preset             | A saved Workspace that can be switched back to                                                      | 预设         | scene, saved layout         |
| Panel              | One meter placed in the Workspace; the same meter can be added more than once                       | 面板         | module                      |
| Panels             | The toolbar menu that adds, renames and removes panels                                              | 面板菜单     | Modules                     |
| Panel Settings     | A panel's own analysis and display options                                                          | 面板设置     |                             |
| Source             | What PLVS measures: system playback, a physical input, an application, or a file                    | 信号源       | device, input               |
| Sources            | The toolbar menu that chooses the Source, in the window and in the Dock                             | 信号源菜单   | Device                      |
| Automatic          | The Source that follows the default system output                                                   | 自动         |                             |
| Live               | Metering the current signal as it arrives                                                           | 实时         |                             |
| Snapshot           | Every meter frozen at one moment chosen from history; capture continues behind it                   | 快照         | inspect mode, freeze        |
| File Mode          | Measuring a local audio file instead of a live Source                                               | 文件模式     |                             |
| Start / Stop       | Starts or stops Live capture                                                                        | 开始 / 停止  |                             |
| Clear              | Discards the current measurement data and begins a fresh measurement                                | 清空         | reset                       |
| Loudness Profile   | A set of reference lines and warning thresholds for a delivery target                               | 响度配置     | target, spec                |
| Dock               | A slim, always-on-top meter strip parked at the top or bottom edge of the screen                    | Dock         |                             |
| Views              | The toolbar menu for window presentation: Always on Top, Hide Window Frame, opacity, Dock placement | 视图         | Focus View (CLI only)       |
| Always on Top      | Keeps the PLVS window above other windows                                                           | 窗口置顶     | pin                         |
| Hide Window Frame  | Removes the system title bar and window frame                                                       | 隐藏窗口边框 | Hide Chrome, borderless     |
| Auto-hide Controls | Hides the toolbar until the pointer moves over the window                                           | 自动隐藏控件 |                             |
| Surface Opacity    | Transparency of Workspace, panel and Dock fills; text and data stay opaque                          | 背景不透明度 |                             |
| Glass              | The translucent macOS window material                                                               | 毛玻璃       |                             |
| Theme              | The colours of the interface and of every meter                                                     | 主题         | skin                        |
| Saved Items        | Settings for exporting and importing Loudness Profiles, Presets and Themes                          | 已保存项目   | library                     |
| Sharesets          | The website where users share Themes, Presets and Loudness Profiles                                 | Sharesets    |                             |
| Item               | One shared entry on Sharesets                                                                       | 条目         |                             |
| Quick Tour         | The ten-step introduction offered after first launch and from Settings                              | 快速导览     | onboarding, tutorial        |
| Settings           | Application preferences                                                                             | 设置         |                             |

## Panels

| Term        | Meaning                                                 | Chinese     |
| ----------- | ------------------------------------------------------- | ----------- |
| Level Meter | Per-channel level bars                                  | 电平表      |
| Loudness    | Momentary and Short-term loudness history               | 响度        |
| Stats       | Configurable numeric readouts                           | 统计        |
| Spectrum    | FFT-based real-time analyzer                            | 频谱        |
| Spectrogram | Time-frequency history                                  | 声谱图      |
| Vectorscope | Phase and correlation of a channel pair                 | Vectorscope |
| Stereo Map  | Stereo image across the frequency spectrum              | Stereo Map  |
| Waveform    | Per-channel amplitude envelope over the session history | 波形        |

Spectrogram is 声谱图 rather than 频谱图 so it cannot be confused with Spectrum.

## Readings

| Term                       | Meaning                                                                      | Chinese      |
| -------------------------- | ---------------------------------------------------------------------------- | ------------ |
| Integrated                 | Loudness of the whole measurement, gated per BS.1770                         | 综合响度     |
| Momentary                  | Loudness over a 400 ms window                                                | 瞬时响度     |
| Short-term                 | Loudness over a 3 s window                                                   | 短期响度     |
| Loudness Range             | Spread of Short-term loudness across the measurement (LRA)                   | 响度范围     |
| True Peak                  | Inter-sample peak level                                                      | 真峰值       |
| Peak                       | Sample peak level                                                            | 峰值         |
| Max Hold                   | Keeps the highest value reached on screen; Spectrum's Hold option does this  | 最大值保持   |
| Playback Max               | Level Meter readout showing the latest playback max while the bar stays live | 播放最大值   |
| Correlation                | Phase correlation of a channel pair, from −1 to +1                           | 相关度       |
| Channel Pair               | The two channels a stereo panel reads                                        | 声道对       |
| Dialogue-Gated Loudness    | The family of readouts based on detected speech                              | 对白门控响度 |
| Dialogue Detection         | The on-device voice detector those readouts depend on                        | 对白检测     |
| Dialogue Loudness          | BS.1770 loudness over detected dialogue (DL)                                 | 对白响度     |
| Loudness-to-Dialogue Ratio | Programme loudness minus Dialogue Loudness (LDR)                             | 响度对白比   |
| Dialogue Coverage          | Detected dialogue duration as a share of measurement time                    | 对白覆盖率   |
| Dialogue Range             | Variation of dialogue loudness across the measurement                        | 对白范围     |

Compact surfaces abbreviate readings. The abbreviation always maps to exactly one term above:

| Shown   | Term                       |
| ------- | -------------------------- |
| M Max   | Momentary Max              |
| ST Max  | Short-term Max             |
| TP Max  | True Peak Max              |
| DL      | Dialogue Loudness          |
| LDR     | Loudness-to-Dialogue Ratio |
| Dlg Cov | Dialogue Coverage          |
| Dlg Rng | Dialogue Range             |
| Corr    | Correlation                |

## Kept in English

PLVS, Dock, Vectorscope, Stereo Map, Sharesets, Agent Control, `plvs-cli`, LUFS, LU, dBFS, dBTP,
FFT, RTA, L/R, M/S, LFE, EBU R 128, ITU-R BS.1770, ATSC A/85, Silero VAD, FireRedVAD, Lissajous.
