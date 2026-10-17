# Cross-platform desktop-performance acceptance design

**Date:** 2026-10-18

**Status:** Approved for implementation

**Spike:** `docs/history/notes/2026-10-18-macos-desktop-performance-observability-spike.md`

## Purpose

Give Windows and macOS the same automated answer to the product-level questions already exercised
by the Windows desktop-performance tools:

- does the visible desktop keep consuming UI frames during live capture;
- does a bounded renderer stall produce bounded, accounted backpressure instead of unbounded work;
- does the UI recover after the stall while capture remains healthy;
- do default and heavy workspaces complete a soak without UI-frame or audio-chunk drops;
- what resource trend and browser diagnostics were observable on this platform?

The adapters do not need identical browser-engine counters. They must produce the same shared
claims, carry explicit capability metadata, and never substitute a guessed zero for an unsupported
measurement.

## User-facing form

The existing commands remain the entry points on both platforms:

```text
npm run verify:ui-backpressure
npm run soak:desktop -- --scenario default
npm run soak:desktop -- --scenario heavy
```

`verify:ui-backpressure` is the short pass/fail acceptance. It runs normal, deliberately stalled
and recovered phases for both the default and heavy workspaces, writes one shared performance
evidence receipt, and exits nonzero when a shared claim fails or cleanup is incomplete.

`soak:desktop` is deliberately longer diagnostic evidence. It writes periodic JSONL samples and a
final summary for one selected workspace. Its shared hard failures remain UI-frame drops and
audio-chunk drops. Resource growth, JavaScript heap, long tasks and animation-frame gaps remain
diagnostic signals requiring interpretation in platform context.

## Shared acceptance claims

Each default and heavy short run has three phases:

1. `normal`: live capture is running, native sent-frame count advances, animation-frame data is
   fresh, and neither UI-frame nor audio-chunk drops increase.
2. `stalled`: a fixed development-only action blocks the renderer main thread for a bounded time,
   native in-flight work reaches its limit, and accounted UI-frame drops increase while
   audio-chunk drops do not.
3. `recovered`: native sent frames advance again, animation-frame data becomes fresh, current
   in-flight work returns below its limit, and capture remains live without new audio drops.

The heavy scenario must also prove that its settled workspace has at least eight visible leaf
panels and contains Stereo Map. This preserves the current Windows protection against accidentally
measuring a lightweight layout.

The runner records fixed scenario ids:

- `performance.default.normal`
- `performance.default.stalled`
- `performance.default.recovered`
- `performance.heavy.normal`
- `performance.heavy.stalled`
- `performance.heavy.recovered`

All six must pass for complete short-run evidence. A missing prerequisite is `rigUnavailable`; an
unsupported optional metric is represented in capabilities and does not make a shared scenario
incomplete.

## Normalized diagnostic snapshot

Every adapter returns this shared core:

- native sent UI frames;
- native dropped UI frames;
- native audio-dropped chunks;
- current, maximum and limit for in-flight UI frames;
- renderer animation-frame count, maximum observed gap and latest-frame age;
- DOM node count;
- sample timestamp and adapter capabilities.

Capabilities name each optional measurement as supported or unsupported. Optional fields include
JavaScript heap, browser long tasks or long animation frames, and process groups such as host,
renderer, network, utility and GPU. Unsupported values are `null` with a reason; they are never
zero-filled.

The frontend installs a continuous animation-frame probe at application mount. Snapshot requests
read it synchronously and therefore still answer when animation frames have become stale. The
external runner owns a hard timeout for every request.

## Fixed development control surface

The optimized dev identity gains two private Agent Control methods and matching hidden dev-CLI
grammar:

- a read-only performance snapshot;
- a bounded renderer-main-thread stall.

They follow the existing development-fixture precedent: compiled only for the dev identity and
absent from the public manifest, capability list, generated reference, help, completion and
packaged CLI grammar. The frontend accepts a closed request shape, validates the maximum stall
duration, and exposes no arbitrary script evaluation.

The snapshot calls the production `get_ui_frame_diagnostics` command and combines it with the
continuous renderer probe. The stall returns only after its bounded interval. Because a stalled
request cannot itself report the mid-stall state, the runner compares the first post-stall native
snapshot with the pre-stall state to prove that the native producer reached its bound and accounted
drops while the renderer was unavailable.

## Platform adapters

### Windows

Keep the existing release dev-identity launch, WebView2 CDP attachment, PowerShell process-tree
sampling, JavaScript heap and long-task telemetry. Route those values through the normalized
adapter without changing current verdict semantics.

The fixed Agent Control methods replace arbitrary CDP evaluation for product assertions. CDP may
remain an observation transport for Windows-only optional metrics.

### macOS

Launch the optimized dev identity with isolated application data and an isolated Agent Control
registry. Require exactly one PLVS dev instance and reject unrelated PLVS processes before timing
begins.

Use the private Agent Control methods for shared UI and audio diagnostics. Use public `ps` data for
the PLVS host and ordinary children. Attribute WebContent and Networking processes only when
`lsof` finds PLVS-owned WebKit cache or website-data paths.

WKWebView does not expose JavaScript heap, long-task or long-animation-frame telemetry on the
tested host. Its shared WebKit GPU process cannot be safely attributed to PLVS without privileged
or private process-coalition APIs. The adapter reports those measurements as unsupported and does
not request elevation.

## Rig and scenario isolation

Both adapters reuse the current cross-platform live-capture rig: VB-Cable on Windows, BlackHole 2ch
on macOS, VLC as the targeted player, and the shared rig lease. The test never changes the user's
default output, volume or mute state.

The optimized app uses a temporary data root populated only with the scenario under test. The
runner must focus and visually expose the PLVS window before a timing phase. A hidden, minimized or
occluded surface is a rig failure because browsers are allowed to throttle animation frames in
that state.

## Evidence

The short runner writes the shared acceptance envelope with domain `performance`, an exact clean
source SHA, the six scenario results, capabilities, phase snapshots, artifact hashes, warnings and
cleanup observations. The unified acceptance report gains a Windows/macOS performance row only
when this producer lands.

Soak JSONL keeps raw periodic samples and ends with a normalized summary that includes scenario,
duration, sample count, shared drop totals, peak in-flight work, animation-frame freshness, process
attribution and optional resource trends. A soak file is not silently promoted to short-run
acceptance evidence and multiple soaks do not create ambiguous domain receipts.

Missing Windows or macOS evidence remains advisory under the already approved cross-platform
acceptance policy. A produced failed receipt remains a real failure and is never downgraded because
the other platform is unavailable.

## Cleanup and failure handling

Cleanup is part of the verdict. On every exit path the runner:

- stops live capture through Agent Control when possible;
- restores automatic device selection;
- stops only the VLC and PLVS processes it created;
- closes CDP or socket connections;
- proves that the isolated Agent Control registry is empty;
- removes or trashes only its own temporary data;
- releases the shared capture lease.

The original test failure remains primary, with cleanup failures appended and preserved in the
evidence receipt. A hard timeout kills only runner-owned processes and still attempts the remaining
cleanup steps.

## Non-goals

- defining one cross-platform CPU, memory or GPU threshold;
- treating resource growth during history retention fill as proof of a leak;
- exposing performance controls in the stable app or public Agent Control schema;
- adding arbitrary JavaScript evaluation to Agent Control;
- requiring private macOS APIs, administrator access or unsafe process attribution;
- replacing the capture soak, history benchmark or panel rendering pixel checks.
