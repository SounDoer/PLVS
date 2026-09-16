# Per-process audio capture spike

Status: Windows proof of concept works; macOS real-device validation is still pending.

This spike intentionally does not add a source picker or persistence. Its first job is to prove
that process isolation preserves PLVS meter readings before the source identity becomes a product
contract.

## Windows probe

`src-tauri/src/audio/windows_process_loopback.rs` activates
`VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK` with
`AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK` and
`PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE`. It requests an explicit 48 kHz, stereo,
32-bit float shared-mode format and feeds the returned PCM into the existing `SummaryMeter`.

Run it against a process that is currently rendering audio:

```powershell
cargo run --manifest-path src-tauri/Cargo.toml --example process_loopback_probe -- <pid> 10
```

Run the repeatable two-process isolation check on the Windows capture rig:

```powershell
npm run spike:capture:process
```

The activation payload uses stable heap storage until the asynchronous activation callback
completes. Its `PROPVARIANT` borrows that storage, so automatic `PropVariantClear` is deliberately
suppressed; allowing it to run would free Rust-owned memory.

## 2026-09-16 Windows result

Host: Windows 11 build 22631, VLC rendering the repository capture-rig signal to VB-Cable.

Signal: 1 kHz, left peak -20 dBFS, right peak -26 dBFS. A second independent VLC process played
the same signal to the same endpoint as interference.

| Reading       |  Target only | Target + other-process interference |
| ------------- | -----------: | ----------------------------------: |
| Integrated    | -22.038 LUFS |                        -22.038 LUFS |
| True Peak     | -19.999 dBTP |                        -19.999 dBTP |
| Sample Peak L | -19.999 dBFS |                        -19.999 dBFS |
| Sample Peak R | -26.002 dBFS |                        -26.002 dBFS |
| Silent frames |            0 |                                   0 |

Both VLC processes remained alive throughout the interference run. The unchanged readings prove
that the process-loopback stream excluded the unrelated renderer on this machine. The requested
format also preserved the stereo source within the existing smoke tolerances.

The same probe accepted 44.1, 48, and 96 kHz Float32 stereo requests. Relative to 48 kHz, the
largest Integrated or Peak difference after Windows conversion was below 0.04 dB. The API also
accepted standard 5.1-side (6ch) and 7.1-surround (8ch) `WAVEFORMATEXTENSIBLE` requests and returned
the requested frame widths. With the stereo VLC fixture, channels 1/2 carried the source and every
additional channel was silent.

This confirms explicit multichannel transport but does not prove a real 5.1/7.1 renderer's channel
mapping. Process loopback has no useful native mix format here: PLVS must choose an explicit format
and the Windows audio engine converts into it. The path also cannot capture ASIO or WASAPI
exclusive-mode rendering because those paths bypass the shared audio engine.

## Remaining spike work

1. Add a real Windows multichannel renderer/device fixture and verify 5.1/7.1 channel mapping rather
   than only the accepted transport width.
2. Compare the existing system-loopback smoke and process probe against the same file-analysis
   ground truth in one report. The two-player process-isolation check is now automated.
3. On macOS, pass resolved Core Audio process object IDs to `CATapDescription`'s inclusive process
   initializer, then repeat the meter-parity and interference tests.
4. On macOS, repeat with output devices exposing multiple stereo pairs to test the reported
   attenuation behavior.
5. Only after those checks, design application identity/rebinding, unsupported-mode messaging, and
   the source-selection UI.
