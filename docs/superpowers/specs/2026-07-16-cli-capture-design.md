# PLVS CLI Capture - Design

## Problem

PLVS ships two independent audio paths, and only one of them is tested.

```
                    ┌──────────────────────────────┐
 live device ──────▶│  audio/  (~44 KB Rust)       │  no coverage
                    │  cpal_backend, device_enum,  │
                    │  device_id, capture          │
                    └──────────────┬───────────────┘
                                   │ PCM
                                   ▼
 media file ───────▶┌──────────────────────────────┐
 (smoke:file-       │  dsp/  loudness, peak,       │  covered by cargo test
  analysis)         │  gating, spectrum, ...       │  + smoke:file-analysis
                    └──────────────┬───────────────┘
                                   ▼
                            engine/meter_pipeline
```

`npm run smoke:file-analysis` and `plvs-cli analyze` both enter at the DSP layer
and bypass the capture layer entirely. Everything in `src-tauri/src/audio/` —
device enumeration, sample-rate negotiation, channel mapping, the cpal callback,
and the ring-buffer handoff — has **zero automated coverage today**.

This is not an oversight in the test suite. It is structural: GitHub Actions
runners have no sound card, so device enumeration returns an empty list and the
code path is unreachable in CI. No amount of CI work can close this gap.

The failure mode this leaves open is the dangerous kind for a metering tool.
A capture-layer bug (wrong channel map, mis-negotiated sample rate, dropped
blocks under load) produces **wrong numbers while every existing check stays
green**, because the DSP math it feeds is still perfectly correct. Users of a
metering app do not get a crash report from this — they get bad measurements and
may never know.

PLVS is unsigned and has no auto-update, so a bad release cannot be recalled.

## Goals

- Add `plvs-cli capture --json`: run the real live-capture path headlessly for a
  bounded duration and emit machine-readable metrics. "Real" is load-bearing: the
  command must **share** the device resolution, sample-format conversion, buffer
  pool, and drop accounting with the GUI, not reimplement them. A parallel
  capture implementation would test only itself and defeat the purpose.
- Make live-capture correctness **assertable** — a script can play a known signal
  into a loopback device (VB-Cable) and assert the returned numbers.
- Emit periodic samples (`--every`) so slow drift and leaks are observable over
  a multi-hour run.
- Mirror the `analyze` envelope, flag vocabulary, and exit-code contract exactly.

## Implementation Shape

This mirrors the split `file_analysis` already uses: `session.rs` serves the UI
through Tauri, while `summary.rs` (zero Tauri imports) serves `analyze` by driving
`SummaryMeter` over the same `dsp/` primitives. `capture` is the live twin of
`summary.rs`.

The capture layer is already factored for this. In `cpal_backend.rs`, everything
the callback touches is standalone and Tauri-free — `PcmBufferPool`,
`copy_f32_pcm_to_pooled_buffer` / `copy_i16_…` / `copy_u16_…`,
`send_pcm_buffer_or_count_drop` — as is all of `device_enum.rs`. Tauri appears at
exactly one point: `run_meter_pipeline_bridge_thread`, which delivers frames to
the webview. That is the *delivery* layer, which this command explicitly does not
test.

So the work is one surgical extraction, not an architectural change:
parameterize `run_capture_worker` over its `audio_rx` consumer. The GUI passes the
existing bridge; the CLI passes a `SummaryMeter` loop. The device resolution,
sample-format conversion, buffer pool, and drop accounting — the code actually
under test — are shared, not reimplemented.

`SummaryMeter` (not `MeterPipeline`) is the CLI's meter, for the same reason
`analyze` uses it: it is the simpler, already-trusted path, and it keeps the CLI
free of the UI's frame/request machinery.

## Non-Goals

- **Do not test the UI.** `capture` runs the engine without a window. The
  `meter_pipeline → IPC → React` last mile stays uncovered by design; it is
  covered by the author using the app during development.
- Do not add a `devices` listing command (see Device Selection).
- Do not add playback or signal generation — the caller owns the signal source.
- Do not expose waveform, spectrum, spectrogram, or vectorscope data.
- Do not add human-readable output; `--json` only, as with `analyze`.
- Do not add fields without a caller today (see Field Justification).

## Command

One-shot (release smoke gate):

```powershell
plvs-cli capture --device "CABLE Output" --seconds 10 --json
```

Streaming (soak):

```powershell
plvs-cli capture --device "CABLE Output" --seconds 14400 --every 10 --json --out soak.jsonl
```

| Flag | Meaning | Default |
|------|---------|---------|
| `--device <substring>` | Capture device, matched by substring | system default device |
| `--seconds <n>` | Capture duration | required |
| `--every <n>` | Emit a sample line every `n` seconds; switches output to JSONL | off (single report) |
| `--json` | Required, as with `analyze` | — |
| `--out <file>` | Also write output to a file | stdout only |

`--every` is the mode switch, and it is named to be self-announcing: passing it
is the caller stating they want a stream. `--sample-interval` was rejected —
"sample" is already bound to PCM samples in this CLI's vocabulary
(`sampleRateHz`, `samplePeakMaxDb`), so the name is ambiguous in an audio tool.

## Device Selection

PLVS already has a stable device-id scheme (`lb-*` for output loopback, `cap-*`
for inputs, plus `default`), and `device_enum::resolve_device` resolves any of
them to a cpal device. `--device` does not replace that: it takes a
case-insensitive **substring of the list label**, resolves it to one of those ids
via `build_device_list()`, and hands the id to the existing resolver. The
resolved id is echoed back as `source.deviceId`.

Exactly one match proceeds; zero or multiple matches are a usage error (exit 2).
Ambiguity is load-bearing here rather than annoying: VB-Cable installs as *two*
rows — "CABLE Input" (an output, captured via loopback) and "CABLE Output" (an
input) — so a bare `--device "CABLE"` is genuinely ambiguous and must not silently
pick one. Capturing the signal under test means matching `CABLE Output`.

There is deliberately **no `plvs-cli devices` command**. Discovery is solved by
the error path, which has to exist anyway:

```
Error: No capture device matches "vb-cable". Available:
  - Microphone (Realtek High Definition Audio)
  - CABLE Output (VB-Audio Virtual Cable)
  - Line In (Realtek High Definition Audio)
```

One wrong guess teaches the caller the name, at the cost of zero new command
surface and zero new contract to maintain.

## JSON Contract

### One-shot report

Reuses the `analyze` envelope verbatim — `schemaVersion`, `command`, `status`,
`app`, `source` — swapping the file `source` for a device `source`.

```json
{
  "schemaVersion": 1,
  "command": "capture",
  "status": "ok",
  "app": { "name": "PLVS", "version": "0.8.1" },
  "source": {
    "deviceName": "CABLE Output (VB-Audio Virtual Cable)",
    "deviceId": "cap-3",
    "sampleRateHz": 48000,
    "channelCount": 2,
    "capturedMs": 10000
  },
  "summary": {
    "integratedLufs": -20.02,
    "samplePeakMaxLDb": -20.01,
    "samplePeakMaxRDb": -26.03
  },
  "health": {
    "droppedChunks": 0,
    "rssMb": 142
  }
}
```

Non-finite metric values serialize to `null`, as in `analyze`.

### Streaming (`--every`)

One JSON object per line (JSONL). Sample lines carry the time offset and the
drift-relevant subset; **the final line is the identical one-shot report above**,
so a caller that only wants the summary reads the last line and shares one parser
with the one-shot mode.

```jsonl
{"t":10,"integratedLufs":-20.01,"droppedChunks":0,"rssMb":142}
{"t":20,"integratedLufs":-20.00,"droppedChunks":0,"rssMb":142}
{"t":14400,"integratedLufs":-19.31,"droppedChunks":7,"rssMb":2870}
{"schemaVersion":1,"command":"capture","status":"ok","app":{...},"source":{...},"summary":{...},"health":{...}}
```

Sample lines carry exactly these fields, and nothing else:

| Field | Meaning |
|-------|---------|
| `t` | Whole seconds elapsed since capture start |
| `integratedLufs` | Integrated value as of `t` |
| `droppedChunks` | Cumulative count since start |
| `rssMb` | Process resident set size at `t` |

A sample line is distinguishable from the final report by the presence of `t`
(equivalently, by the absence of `schemaVersion`).

A single averaged number would hide exactly what a soak exists to find: an
integrated value that reads -20.0 for two hours and -19.0 for the next two
averages to -19.5 and looks fine. Drift is only visible as a series.

## Field Justification

Every field must have a caller today. The two callers are the release smoke gate
and the soak run.

| Field | Caller | Why it earns its place |
|-------|--------|------------------------|
| `deviceId` | smoke | Records which device the substring actually resolved to, so an assertion failure is diagnosable |
| `sampleRateHz` | smoke | Confirms the capture ran at the expected rate; guards test-rig drift (VB-Cable reconfigured) rather than a code bug — see below |
| `channelCount` | smoke | Detects a layout the capture layer got wrong |
| `integratedLufs` | smoke, soak | Level canary; also the drift curve |
| `samplePeakMaxLDb` / `samplePeakMaxRDb` | smoke | Channel-map canary (see below) |
| `droppedChunks` | smoke, soak | Capture-layer health; accumulates only over time |
| `rssMb` | soak | Only source for leak detection |

**Why per-channel peaks are not redundant.** `capture` verifies the capture
layer, not the DSP — and a capture layer feeding bad PCM shifts *every* metric at
once, so one canary would normally suffice. There is one exception, and it
matters: **any permutation among equal-weight channels integrates to a
bit-identical LUFS value.** Per the weight table in `dsp/loudness.rs`, a manual
5.1 layout weighs FL/FR/C at `1.0`, LFE at `0.0`, and SL/SR at
`SURROUND_LOUDNESS_WEIGHT` — so an L↔R swap in stereo, an FL↔FR↔C permutation, or
an SL↔SR swap are all completely invisible to `integratedLufs`. Only a swap
involving LFE (weight `0.0`) shifts it. Per-channel peaks catch the rest: play
asymmetric levels (L = -20, R = -26) and assert both.

**There is no rate negotiation to verify.** An earlier draft carried a
`requestedSampleRateHz` / `actualSampleRateHz` pair to catch a mis-negotiated
rate. That bug class cannot occur here: `run_capture_worker` builds its
`StreamConfig` with `sample_rate: supported.sample_rate()`, i.e. it adopts the
device's own default config rather than requesting a rate, and `MeterPipeline` is
constructed from the same values. Requested and actual are equal by construction,
so the pair would assert a tautology. A single `sampleRateHz` remains, reusing
`analyze`'s vocabulary; it earns its place by catching **test-rig drift** (VB-Cable
silently reconfigured to 44.1k), not by catching a code bug.

**`droppedChunks` already exists.** `cpal_backend.rs` maintains
`dropped_chunks: Arc<AtomicU64>` and increments it in the callback when the
cpal→meter queue is full. Exposing it costs nothing and adds no realtime risk.
Note this is a *different* counter from the `dropped_frames` UI-backlog warning
in the same file — that one tracks the webview failing to consume frames, is
meaningless with no UI attached, and must not be conflated with capture health.

**Deliberately excluded**, with the reasoning recorded so the decision can be
revisited rather than re-argued:

| Field | Why not |
|-------|---------|
| `lra` | Needs a long window; noise in a 10 s gate |
| `mMaxLufs` / `stMaxLufs` | Adds DSP coverage, which file mode already owns; adds no capture-layer coverage |
| `truePeakMaxDbtp` | Same — DSP-layer concern, already covered from files |
| `xruns` | Not a concept in this codebase. `cpal_backend.rs` has no xrun counter and cpal does not surface device-level xruns; the term was imported from ALSA/JACK vocabulary to name something that already has a name here. Use `droppedChunks`. |
| `callbackMaxUs` | No caller today, and `droppedChunks` already answers the same question as a *result* metric: a callback slow enough to matter backs the queue up and drops chunks. It is also not instrumented today, so it is new work for no consumer. (Not excluded on realtime-safety grounds — `Instant::now()` on Windows resolves through `KUSER_SHARED_DATA` without a kernel transition, so the cost is tens of nanoseconds and the `realtime-safe` guidance in `docs/architecture.md` §7 is not implicated. If a caller ever appears, this field is viable.) |

Adding a field later when a caller appears is cheap. Removing one that shipped
breaks a contract. The asymmetry sets the default: exclude.

## Exit Codes

Matches `analyze`:

| Code | Meaning |
|------|---------|
| 0 | Capture completed; report status `ok` |
| 1 | Capture produced a valid report with status `error` (e.g. device vanished mid-run) |
| 2 | Invalid usage, or CLI failure before a valid report (unknown/ambiguous device, device open failure) |

## Consumers

`capture` is the foundation for two separate pieces of work, both out of scope
here and both blocked on it:

1. **Release smoke gate** — a step inside `plvs-release`, between preflight and
   tagging. Installs the RC build, plays a known asymmetric signal into
   VB-Cable, runs `capture --seconds 10`, asserts the numbers, and also runs
   `analyze` against the *installed* app to prove packaged sidecar wiring. Fully
   automated; blocks the tag; no human confirmation step.
2. **Soak run** — `capture --seconds 14400 --every 10` on a machine with
   VB-Cable, triggered after commits that touch `src-tauri/src/audio/`, `dsp/`,
   or `engine/`. Explicitly **not** a release gate: leaks are introduced by
   commits, not by releasing, and catching them at a two-week gate means bisecting
   two weeks of history. Cannot run in CI (no sound card).

Both are usage patterns of this one command, not separate machinery.

## Platform Note

Windows only in practice. The author develops on Windows, so the macOS capture
path (`audio/macos/`) stays CI-verified only — CI cannot exercise it either.
This gap is real, known, and not closed by this work.

## Follow-on Work

- Update `plvs-agent.json` and the agent-discovery surface (`npm run agent:generate`).
- Document the command in the CLI help topics alongside `doctor` / `analyze` /
  `analyze-batch` / `report`.
