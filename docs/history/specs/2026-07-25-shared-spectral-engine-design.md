# Shared Spectral Engine — Design

**Date:** 2026-07-25  
**Status:** Draft for owner review  
**Precedes:** `2026-07-25-stereo-map-design.md`

## Summary

Introduce one Rust-side frequency-analysis foundation that computes synchronized,
multi-resolution complex STFT frames once per active input channel. Existing Spectrum
requests and the future Stereo Map consume those shared frames through independent
request-keyed accumulators.

This is an internal migration. Spectrum output, controls, IPC payloads, history,
snapshot behavior, file analysis, and visuals must remain unchanged. The old
`MultiResBank` path is removed only after differential correctness and performance
tests prove equivalence.

## Why this precedes Stereo Map

Today every `SpectrumMeter` owns one or two `MultiResBank` instances. Two requests
that inspect the same channels repeat Hann windowing and FFT work. Stereo Map also
needs synchronized L/R complex spectra and cross-power; implementing it as another
independent meter would add more repeated transforms.

The chosen architecture shares expensive transforms while keeping measurement and
display semantics isolated:

```text
PCM block
  -> SharedSpectralEngine
       -> synchronized complex STFT frames by planned signal stream and FFT size
       -> ephemeral auto/cross spectral primitives
            -> Spectrum consumers
            -> Stereo Map consumers
```

The engine is a foundation for requested consumers, not a general plug-in framework.
No other meters move into it in this change.

## Goals

- Run each FFT size at most once per planned physical channel or derived projection
  and aligned time window.
- Preserve the current Spectrum result within explicit numerical tolerances.
- Keep channel transforms synchronized so pair cross-power is meaningful.
- Let different Speed, Smoothing, Tilt, view, and hold settings share transforms
  without sharing their mutable measurement state.
- Keep complex FFT arrays on the meter bridge worker thread and out of IPC/history.
- Use the same path for live capture and file analysis.
- Produce measurable reductions in FFT count for duplicate-channel workloads.

## Non-goals

- Adding the Stereo Map UI or its IPC/history payloads.
- Changing Spectrum controls, defaults, request keys, calibration, grid, or visuals.
- Changing the 40 ms visual-history cadence or retained precision.
- Moving work into the audio callback.
- Precomputing every input channel when no active request needs it.
- Sharing final Spectrum envelopes, peak hold, or display-shaped dB rows.
- Solving frontend IPC, history-memory, or rendering costs.

## Current behavior that is authoritative

The code on `main` is the compatibility target:

- FFT sizes: 16384, 4096, and 1024.
- Overlap factors: 8, 4, and 2 respectively.
- Hann window and real FFT.
- Crossovers at 200 Hz and 2 kHz with a 1/6-octave half-width blend.
- Log grid at 96 points per octave.
- One-sided PSD normalization and `CAL_OFFSET_DB`.
- Speed-controlled per-hop analysis averaging plus the later attack/release envelope.
- Fractional-octave smoothing in linear power.
- Combined and M/S use `0.5 * (L + R)` and `0.5 * (L - R)`.
- Spectrum weighting, Tilt, envelope, peak hold, and SVG path production remain
  consumer-owned.

`docs/architecture.md` still describes an older single-resolution FFT contract in
places. `src-tauri/src/dsp/spectrum.rs` and `spectrum_bank.rs` are authoritative for
this migration.

## Architecture

### Request planning

Before processing a PCM block, `MeterPipeline` derives the channels and pairs needed
by active Spectrum and Stereo Map requests.

The plan contains:

- active physical channel indices;
- any derived mono projections that are cheaper to transform directly;
- requested channel pairs;
- the existing request keys and consumer settings;
- no inactive or speculative channels.

Changing the plan creates or removes only the affected channel transform and
consumer state. An unchanged request key keeps its accumulator warm. A removed key
is pruned under the current no-backfill lifecycle.

Every transform stream is indexed by one pipeline-global sample clock. A stream
added after capture starts initializes its ring position and hop phase from that
clock rather than starting an independent sample-zero timeline. It emits no frame
until its complete longest window is populated.

### Transform layer

`SharedSpectralEngine` owns three synchronized analyzers per planned transform
stream. A stream is either a physical channel or a linear projection such as
`0.5 * (L + R)`. All streams for a given FFT size use the same:

- sample clock;
- ring fill position;
- hop boundary;
- window coefficients;
- FFT plan and normalization.

At a hop boundary the engine exposes an immutable, short-lived complex frame for
that FFT size. Frames are consumed before the next PCM block mutates scratch storage.
They are never cloned into `AudioFramePayload`, visual history, or React state.

The implementation may share FFT plans and window tables globally inside the worker,
but mutable channel rings and scratch spectra remain channel-owned.

The planner keeps the current one-bank fast path for a lone Combined request: when
no consumer needs the pair's individual or cross spectra, it transforms the
time-domain `0.5 * (L + R)` projection directly. It must not replace one existing
transform with two physical-channel transforms.

When an L/R, M/S, or Stereo Map consumer already requires aligned physical-channel
frames, Combined and Mid are derived from those complex frames without an additional
projection FFT. This hybrid rule avoids a near-2x regression for the common single
Combined workload while still sharing transforms in pair-analysis workloads.

Changing between those two paths uses an overlap-and-handoff contract:

1. an existing projection stream continues driving its Spectrum consumer while new
   physical-channel streams warm on the same global sample clock;
2. the physical streams must produce aligned frames at all three FFT sizes before
   they become eligible;
3. the consumer switches sources only at a common hop boundary, without resetting
   its Speed-dependent average, display envelope, or peak hold;
4. the obsolete projection stream is pruned only after the handoff;
5. removing the pair consumer performs the inverse handoff before physical streams
   that are no longer needed are pruned.

This short overlap deliberately performs duplicate transforms during topology
changes. A blank or stale Spectrum frame is not an acceptable way to avoid that
bounded transition cost.

### Consumer accumulation

The current `StftAnalyzer` couples FFT production and Speed-dependent PSD EMA. The
migration separates these responsibilities:

1. the transform layer emits normalized complex bins;
2. each request-keyed consumer applies the same per-hop EMA equation and initialization
   behavior that its old `MultiResBank` used;
3. each consumer samples the three resolutions onto the existing log-grid taps and
   applies the existing crossover blend;
4. frequency smoothing and later display shaping remain in that consumer.

This separation is what lets two requests with different Speed settings share FFTs
without sharing averaged power.

### Exact Spectrum projections

Spectrum signal selection is derived from aligned complex channel bins using the same
linear combinations as the current time-domain path:

```text
Single(c)  = Xc
Combined   = 0.5 * (X + Y)
L curve    = X
R curve    = Y
Mid curve  = 0.5 * (X + Y)
Side curve = 0.5 * (X - Y)
```

Power is computed after the complex combination. This preserves cross terms and is
not equivalent to averaging independent channel powers.

The resulting power then follows the existing PSD normalization, temporal average,
grid interpolation, crossover blend, octave smoothing, dB calibration, Tilt,
weighting, attack/release, and peak-hold order.

### Pair spectral primitives

For a requested pair, Stereo Map will need linear-domain estimates:

```text
PL = E[|XL|^2]
PR = E[|XR|^2]
C  = E[XL * conj(XR)]
```

The shared engine provides aligned complex frames; it does not own these
Speed/Smoothing-dependent averages. A pair consumer accumulates `PL`, `PR`, and
complex `C` with its own request settings. It publishes finite, smoothed `PL`, `PR`,
and real `C` primitives. A non-finite primitive point is canonicalized to the finite
triplet `(0, 0, 0)`, which Stereo Map's energy gate treats as invalid. Stereo Map
derives all first-version metrics from those primitives in the frontend; retaining
the complex term inside the consumer avoids blocking later coherence or phase work.

## Ownership and thread boundaries

- The cpal/Core Audio callback remains unchanged: no FFT, allocation, lock, or syscall
  is added there.
- `SharedSpectralEngine`, all consumer accumulators, and scratch complex frames live
  on the existing meter bridge worker thread.
- File analysis owns a separate `MeterPipeline` on its file worker, but uses the same
  engine and consumer code.
- Frontend components continue to reach the audio engine only through `src/ipc/`.
- A sample-rate or channel-layout change rebuilds affected transform and consumer
  state rather than mixing incompatible grids.

## Migration sequence

### Stage 1 — Extract without changing Spectrum

- Separate transform output from Speed-dependent accumulation.
- Add the shared request planner and per-channel transform ownership.
- Implement a Spectrum consumer over shared frames.
- Keep the legacy `SpectrumMeter` available to tests as a reference.
- Do not change the public Spectrum IPC result or frontend code.

### Stage 2 — Differential validation

Run legacy and shared implementations from identical PCM fixtures and compare:

- band centers;
- primary and secondary smooth rows;
- peak-hold rows;
- readiness and request reset timing.

Coverage includes silence, impulse, bin-aligned and non-aligned tones, deterministic
white noise, independent L/R, hard-panned signals, in-phase and anti-phase pairs,
Combined/L/R/M/S, single channels, all Speed/Smoothing/Tilt combinations used by the
UI, multiple sample rates, and varied PCM chunk boundaries.

### Stage 3 — Pipeline cutover

- Route production Spectrum requests through the shared engine.
- Keep the same request validation, cap, result map, visual-history row, and file path.
- Record FFT invocation counts and CPU/memory baselines before removing the old path.
- Delete the legacy path only after the full gate passes.

## Failure and lifecycle behavior

- A request receives no stale result while a new channel transform warms up.
- An unchanged Spectrum request remains continuously available while the planner
  changes between projection and physical-channel sources.
- Removed request keys stop accumulating immediately and are not backfilled.
- Invalid channel selections continue to be clamped before reaching Rust.
- A transform/consumer error must surface through existing meter-health behavior; it
  must not silently reuse another key's result.
- Clear resets consumer averages and holds and reinitializes transform history in the
  same observable way as the current Spectrum reset.
- Backpressure continues to drop delivery work under the existing policy; the engine
  does not interpolate missing analysis frames.

## Testing

### Rust correctness

- Unit tests for aligned channel hop boundaries and transform readiness.
- Complex-projection tests proving shared Combined and M/S match time-domain mixing.
- Differential tests against legacy `SpectrumMeter` for all fixtures above.
- Pair tests for in-phase, anti-phase, 90-degree, independent-noise, and single-sided
  inputs.
- Lifecycle tests for request add/remove, sample-rate change, Clear, and file timing.
- Topology-transition tests add and remove a Stereo Map pair while a Combined
  Spectrum request runs, asserting continuous output, aligned handoff, preserved
  consumer state, and eventual pruning of the obsolete streams.

Numerical tolerances must be set from measured floating-point ordering differences,
not widened until tests pass. Exact equality is required for band centers and payload
shape.

### Performance

Add deterministic counters/benchmarks that demonstrate:

- one transform per planned physical channel or projection/FFT-size/hop;
- one projection transform, not two physical transforms, for a lone Combined request;
- duplicate pair requests do not duplicate transforms;
- different Speed/Smoothing consumers still reuse transforms;
- a representative Spectrum + Stereo Map workload reduces FFT calls;
- a mixed four-Spectrum plus four-Stereo-Map workload stays within the accepted
  CPU, scratch-memory, and IPC budgets;
- CPU and memory for a lone Combined Spectrum stay within an agreed small migration
  overhead because the projection fast path preserves one transform bank.

### Repository and desktop verification

- Run targeted Rust DSP and pipeline tests.
- Run `npm run check`.
- Run the real capture smoke test before release because `dsp` and `engine` change.
- After the migration, run `npm run soak:capture` (four hours by default) to look for
  leaks and metric drift; its current drift threshold is diagnostic, not a verdict.

## Acceptance criteria

- Existing Spectrum request keys and serialized payloads are unchanged.
- Existing Spectrum visuals and history behavior are unchanged.
- Differential fixtures pass at justified tolerances.
- Combined/M/S projections preserve the current `0.5` scaling and calibration.
- Planned physical channels and projections share synchronized transforms; inactive
  signals consume no FFT.
- A lone Combined request still uses one transform stream per FFT size.
- Adding or removing a pair consumer never blanks or resets an unchanged Combined
  Spectrum request.
- Different consumer settings share transforms but not mutable averages/envelopes.
- Live and file analysis use the same shared implementation.
- No callback-thread realtime-safety regression is introduced.
- Benchmarks prove reduced FFT invocation for duplicate-channel workloads.
- `npm run check` passes, and capture smoke/soak follow-up is recorded.
