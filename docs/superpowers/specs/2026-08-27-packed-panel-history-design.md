# Packed Per-Panel History — Design

**Date:** 2026-08-27

**Status:** Implemented on `main`

## Summary

Reduce the WebView memory required by long-running Spectrum, Spectrogram, Vectorscope, Stereo Map,
and Waveform histories without shortening retention, lowering history cadence, removing frequency
bands, or changing the live analysis payload.

The current four-hour shape retains 144,000 main-history rows at 10 Hz and 360,000 visual-history
rows at 25 Hz. On the reporting layout, WebView2 reached 10.2 GB and 37% CPU after an overnight
run. The largest exact retained payloads are one Stereo Map key at 4.379 GB, one primary Spectrum
key at 1.380 GB, and one Vectorscope key at roughly 0.302 GB. This design changes how those rows are
represented in frontend history; it does not change which timestamps or frequency points exist.

The design has four parts:

1. store Spectrum dB history as centi-dB `Int16` values;
2. store Vectorscope pair history as normalized `Int16` values and incrementally maintain Polar
   Max Hold summaries;
3. store only the Stereo Map Modes currently requested by open panels, with shared packed Energy
   history and per-Mode packed values;
4. replace Waveform's object-per-row visual history with columnar typed-array chunks.

All packing happens after the existing live result has been published. Rust DSP output, Tauri IPC,
live panel precision, and the audio callback are unchanged in this design.

## Relationship to earlier designs

This design supersedes only these clauses from earlier documents:

- `2026-07-23-full-resolution-history-performance-design.md` requires Spectrum bands and
  Vectorscope pairs to retain their existing numeric type. The row count, timestamp cadence, band
  grid, and pair count remain exact, but their retained numeric representation becomes fixed-point.
- `2026-07-25-stereo-map-design.md` makes Mode a pure projection of three retained primitive
  planes and promises that any Mode can be reconstructed over the complete retained interval. Mode
  becomes part of frontend history identity instead: a Mode has history only while an open panel
  requests it.

The immutable chunk model, exact timestamp lookup, snapshot as-of boundary, request-key gap
semantics, retention settings, and visual-history eviction rules remain in force.

## Non-negotiable invariants

- History Length remains 30, 60, 120, or 240 minutes as selected by the user.
- Main history remains on its existing 100 ms semantic cadence.
- Visual history remains on its existing 40 ms semantic cadence.
- Every emitted timestamp is retained until normal capacity eviction.
- Spectrum and Stereo Map retain every emitted frequency band; no spatial downsampling is added.
- Vectorscope retains the existing number of emitted pairs per row.
- Live results remain the existing full-precision payloads.
- No allocation, lock, or syscall is added to the audio callback thread.
- Snapshot selection and missing-key resolution continue to use real timestamps.
- Packing must not allocate a decoded full-history copy.

## Baseline

At 240 minutes and the current production widths:

| Family                 |                 Retained shape per key | Current primary bytes |
| ---------------------- | -------------------------------------: | --------------------: |
| Spectrum, one curve    |                360,000 × 958 × Float32 |         1,379,520,000 |
| Spectrum, second curve |                     same, when present |        +1,379,520,000 |
| Vectorscope pairs      |                360,000 × 200 × Float32 |           288,000,000 |
| Stereo Map primitives  |            360,000 × 958 × 3 × Float32 |         4,138,560,000 |
| Stereo Map total       | primitives + timestamps + Hold indexes |         4,378,840,064 |

These figures exclude V8 object overhead, React state, canvas/GPU surfaces, and the shared scalar
and Waveform histories. They therefore explain less than the whole WebView working set but identify
the dominant retained payloads.

## Common packed-history rules

### Encode once, decode at the consumer

Packing occurs directly while a row is appended to its slab. The append path writes into the
destination typed chunk and must not build a temporary packed or decoded row.

Consumers must not preserve the old `rowAt() -> materialized Float32Array` convention when doing so
would decode data that they do not read. Packed views expose family-specific indexed readers plus
metadata:

```text
length
version
timestampAt(index)
rowAt(index)                  # lightweight row view, no full-plane copy
storageStats()
freeze()
```

The row view may provide indexed accessors such as `dbAt(band)` or a packed plane plus codec
metadata. A one-row consumer such as Spectrum snapshot path construction may decode its selected
row into reusable scratch. Spectrogram must read only the band values it paints; it must not decode
958 values for every source row when the canvas needs a subset.

### Special values

Each codec reserves explicit integer codes for the non-finite states its source can carry. Finite
values are clamped only outside the codec's documented physical/display domain. Tests must cover
the finite endpoints, invalid values, `-Infinity`, and `+Infinity` where applicable.

### Chunk and snapshot behavior

Sealed packed chunks remain immutable and are shared with snapshots. Freeze copies at most the
active tail and must copy only the tail's used rows, not the full 1,024-row backing capacity. A
later snapshot optimization may seal/rotate the active tail instead; that is compatible with this
design but not required to land packing.

## Spectrum and Spectrogram

### Codec

Spectrum dB values use signed centi-dB:

```text
encode(db) = round(db * 100)
decode(q)  = q / 100
```

`-32768` is reserved for no finite value. Finite values use `[-32767, 32767]`, corresponding to
`[-327.67, +327.67]` dB. The current Spectrum and Spectrogram domains are well inside that range.
The maximum finite quantization error is 0.005 dB.

Primary and optional secondary curves use `Int16Array`. The existing per-row secondary-presence
flag remains explicit so an absent secondary curve is not confused with a curve at the floor.
Band centers remain one shared full-precision grid per compatible slab.

### Consumer behavior

- Live Spectrum continues using the existing live result and path.
- Snapshot Spectrum decodes only the selected row when it constructs a path or hover data.
- Spectrogram paint reads packed values directly by row and band.
- Spectrogram color output may differ by at most one 8-bit LUT step at a quantization boundary.
- Spectrum Max Hold compares encoded integers directly.

### Incremental Spectrum Max Hold

The current first snapshot request for Max Hold builds a prefix table by replaying up to 360,000 ×
958 values. Instead, each Spectrum chunk maintains a per-band encoded maximum as rows append.
Optional checkpoints inside a chunk bound the selected-tail replay. A snapshot query merges complete
chunk maxima and replays only the bounded tail. The partially evicted front chunk is never merged
whole: the query scans its retained suffix, or starts from a checkpoint proven to exclude the
expired prefix. Work is therefore bounded by summaries plus the front and target partial chunks
rather than by the full retained history.

Integer maximum preserves the exact maximum of the retained quantized values. It is not a temporal
or spatial approximation.

### Projected memory

A four-hour primary plane becomes 689,760,000 bytes instead of 1,379,520,000 bytes. Including
timestamps, one primary key is approximately 693 MB before small chunk metadata. A continuously
present secondary curve adds approximately another 690 MB.

## Vectorscope

### Codec

Pairs are finite normalized samples and use a symmetric signed mapping:

```text
encode(x) = round(clamp(x, -1, 1) * 32767)
decode(q) = q / 32767
```

The maximum error is approximately 0.0000153, near -96 dBFS. The panel's signal floor is about
-90 dBFS, and the corresponding coordinate displacement on the 260-unit plot is below 0.005 plot
units. Correlation, side-to-mid, and energy metrics remain in their current scalar type; only the
200 pair values per row are packed.

Lissajous, Persistence, and Polar consumers operate directly over `Int16Array` values with the
shared inverse scale. They must not allocate a decoded pair array per row.

### Incremental Polar Max Hold

Polar Level Max Hold is the per-direction maximum from Clear through a selected time. Maximum is
associative, so the exact result can be maintained incrementally:

1. project each incoming row into the existing 64 Polar bins while appending it;
2. update the current chunk's 64-bin maximum;
3. freeze that summary with the chunk;
4. resolve a historical query by merging complete chunk summaries and scanning only the bounded
   target tail.

As with Spectrum, a partially evicted front chunk contributes only its retained suffix. An expired
pair may never survive through a whole-chunk maximum.

This replaces the first-snapshot replay of up to 72 million pair values. It does not replace or
downsample pair history and does not change Polar output. Even Float32 summaries cost only about
90 KB for one summary per 352 full-size chunks; bounded within-chunk checkpoints keep the total in
the low-megabyte range.

### Projected memory

Four-hour pair storage falls from 288 MB to 144 MB. With current timestamps and scalar metrics, a
complete key is projected at roughly 158 MB before small chunk metadata and Polar summaries,
instead of roughly 302 MB.

## Stereo Map

### Measurement identity and Mode history identity

The Rust analysis key remains:

```text
pair + speed + octave smoothing
```

Mode is not added to the Rust key. All panels sharing those measurement controls continue to share
one live `PL/PR/C` result.

Frontend retained history has a second identity layer:

```text
measurement key + Mode
```

For each measurement key, history stores shared timestamps, band centers, packed Energy, and frame
peak. It stores one packed value plane and one Mode-specific Hold index for each Mode currently
requested by an open Workspace or Dock panel.

### Mode lifecycle and missing history

- Opening a Mode starts its value history on the next matching visual tick.
- Two panels with the same measurement key and Mode share one Mode plane.
- Changing a panel's Mode exits snapshot through the existing control-change behavior, then starts
  the new Mode's history.
- Scrubbing the new Mode to a time before that Mode existed returns Missing even when the shared
  Energy timeline exists there.
- A Mode plane no open panel needs is released when the retained Mode set changes; the measurement
  key itself still follows the existing visual-key eviction grace period.
- A frozen snapshot keeps its Mode plane immutable even if the live plane is later evicted.
- Clear resets shared Energy, every Mode plane, and every Mode Hold summary together.

This deliberately replaces the earlier promise that any Mode can be reconstructed at every
retained timestamp.

### Packed data

Every retained row stores shared:

- Energy per band as centi-dB `Int16`;
- full-grid peak per row as centi-dB `Int16`;
- timestamp at existing precision.

Every active Mode stores one value per band:

| Mode        | Encoding                       | Finite error bound |
| ----------- | ------------------------------ | -----------------: |
| Position    | normalized signed `Int16`      |         ~0.0000153 |
| Correlation | normalized signed `Int16`      |         ~0.0000153 |
| Mono Loss   | mode-specific centi-dB `Int16` |           0.005 dB |
| M/S Ratio   | mode-specific centi-dB `Int16` |           0.005 dB |

Mode-specific codecs reserve distinct invalid and infinite codes where the formula permits
`-Infinity` or `+Infinity`. Their finite domains cover the absolute editable UI ranges: Mono Loss
`[-60, 0]` dB and M/S Ratio `[-96, +48]` dB.

Historical opacity and gate state are reconstructed from packed Energy and the packed frame peak.
Historical hover therefore retains its Energy readout. Y-range changes remain display-only and do
not mint history: unclipped Mode values are stored and projected into the current range on read.

### Hold

Only the retained Mode's extrema are maintained:

- Position: minimum and maximum;
- Correlation: minimum;
- Mono Loss: minimum;
- M/S Ratio: maximum.

Summaries and checkpoints use the Mode's packed representation plus reserved invalid state. Merging
encoded extrema is exact in the quantized domain. No query reconstructs an unretained Mode.

### Multiple active Modes

Shared Energy is stored once. At 958 bands, the primary per-row payload is:

| Active Modes for one measurement key |             Bytes per band | Four-hour primary bytes |
| -----------------------------------: | -------------------------: | ----------------------: |
|                                    1 |  2 (Energy) + 2 (Mode) = 4 |           1,379,520,000 |
|                                    2 | 2 (Energy) + 4 (Modes) = 6 |           2,069,280,000 |
|                                    3 |                          8 |           2,759,040,000 |
|                                    4 |                         10 |           3,448,800,000 |

The current three primitive planes cost 12 bytes per band regardless of how many Modes are open.
The common one-Mode case therefore cuts the primary payload by two thirds. Mode-specific Hold
indexes are also materially smaller than the current all-Mode Float64 summaries. A one-Mode total
is expected around 1.4–1.5 GB instead of 4.379 GB; the benchmark, not this estimate, is the
acceptance authority.

### Live behavior

Live panels continue to derive their Mode from the full-precision live `PL/PR/C` result. Packed
history must not replace that live row. Live Hold may use a small full-precision accumulator keyed
by measurement key and Mode, or the packed incremental Mode summary if differential tests prove the
rendered result equivalent. The choice must not reintroduce a full retained primitive plane.

## Waveform

### Columnar visual history

`visualWaveformHist` stops storing one JS object with several nested arrays per 40 ms row. Compatible
rows are stored in typed-array chunks with columns for:

- timestamps;
- waveform minima and maxima;
- dominant frequency;
- spectral centroid;
- tonality.

Fields originating as Rust `f32` retain Float32 precision; timestamps retain Float64/number
precision. Channel count and row shape are chunk schema. A shape change starts compatible storage
rather than mixing rows.

The 100 ms waveform sub-pair history remains complete. This design does not reduce sub-pair count,
bucket old rows, or disable spectral metadata that was not visible when it arrived.

### Read and snapshot behavior

Waveform's display index continues to answer pixel-bounded min/max queries. Spectral metric slicing
reads the new typed view without materializing rows. Snapshot shares sealed visual Waveform chunks
instead of creating a 360,000-reference array.

Exact memory savings depend on channel count and sub-pair shape, so the first implementation slice
must add `storageStats()` and a production-shape projection before choosing chunk fields.

## Request sharing and eviction

The existing retained-key rules continue to prevent abandoned Spectrum, Vectorscope, and Stereo
Map history from surviving indefinitely. Packing does not weaken them.

Stereo Map needs a frontend Mode-retention set in addition to the Rust measurement request set.
That set is derived from open panels without the four-request cap, Dock squeeze, or live channel
availability gate, matching `deriveRetainedAnalysisKeys`. It must not import
`workspace/registry.jsx`.

Changing a packed codec or incompatible grid clears/rebuilds only that in-memory slab. No persisted
history migration exists because session history is not persisted across app restarts.

## CPU budget and allocation discipline

Packing trades cheap integer conversion for lower memory bandwidth and GC pressure. It is not
acceptable to reduce retained bytes while increasing per-frame allocations.

- Encode directly into the destination chunk.
- Reuse mapping/derivation scratch per key.
- Do not create a packed intermediate row.
- Do not decode a full plane for indexed canvas reads.
- Keep band-center grids shared.
- Max Hold summaries update in the same append pass where practical.
- Benchmark one and four active keys for every family.

The current mixed synthetic workload takes about 2.33 ms per visual tick for four Spectrum and four
Stereo Map keys on the reporting machine (`2,385.6 ms / 1,025 rows`). Packed intake must report
per-family timings so a regression cannot hide inside the aggregate. Wall-clock values are
diagnostic; automated tests assert allocation counts, retained byte formulas, and bounded query
work.

## Snapshot implications

This design removes two snapshot costs while remaining primarily a memory change:

- Waveform visual history no longer expands to a 360,000-reference array.
- Spectrum and Polar Max Hold no longer build their first prefix index by replaying the full
  four-hour history.

The remaining scalar `RingBuffer.toArray()` work in `freezeSnapshot` and the immutable scalar index
work are a separate snapshot-entry design. They should be measured after packed history lands; this
spec does not conceal them behind an unrelated rewrite.

## Testing

### Codec correctness

- Exhaustive or property tests cover finite endpoints, zero, representative values, and reserved
  states for every codec.
- Spectrum and dB Mode round trips differ by no more than 0.005 dB.
- Normalized round trips differ by no more than `1 / (2 × 32767)` except exact clamped endpoints.
- Non-finite values round-trip to the intended semantic state.

### Visual differential tests

- Spectrum SVG coordinates differ from Float32 reference output by less than 0.02 view-box units at
  the default range.
- Spectrogram color/alpha differs by at most one LUT step at a quantization boundary.
- Vectorscope coordinates differ by less than 0.005 plot units.
- Stereo Map normalized Modes differ by less than 0.005 plot units.
- Stereo Map dB Modes remain within the pixel tolerance established at the narrowest supported
  6 dB viewport.
- Gate, fade, invalid, below-range, above-range, and hover Energy behavior match the reference.

### History and snapshot behavior

- Packed chunks cover wrap, partial eviction, freeze, post-freeze append, Clear, and grid changes.
- Every family retains exactly 360,000 timestamps at four hours.
- Spectrum retains exactly 958 values per emitted curve row.
- Vectorscope retains exactly 200 pair values per emitted row.
- Stereo Map retains exactly 958 Energy and Mode values per available Mode row.
- A Stereo Map Mode requested after capture starts reports Missing before its first row.
- Shared measurement keys do not create duplicate Rust requests for multiple Modes.
- Incremental Spectrum and Polar Max Hold match full reference replay at random selected rows.

### Memory and performance feedback

Extend `benchmark:history` and the developer history harness to report, per family and key:

- allocated and used bytes by plane;
- packed type and codec;
- row, band, pair, and active-Mode counts;
- append time and temporary allocation count;
- frozen shared bytes and copied tail bytes;
- Max Hold query rows scanned and summaries merged.

Structural assertions pin these four-hour targets:

- one primary Spectrum plane is approximately 690 MB plus timestamps, not 1.380 GB;
- one Vectorscope pair plane is 144 MB, not 288 MB;
- one-Mode Stereo Map primary planes are approximately 1.380 GB, not 4.139 GB;
- no row, timestamp, band, or pair count is reduced;
- Max Hold query work is bounded by summaries plus the partial front/target chunk work; it is not
  proportional to retained history length.

Run focused differential suites after each vertical slice, then `npm run check`. Although the Rust
capture layer is unchanged, complete the real four-hour `npm run soak:capture` scenario before
calling the memory objective achieved; RSS plateau and UI responsiveness are the outcome being
fixed, and the synthetic byte model alone cannot validate WebView reclamation or GC behavior.

## Acceptance criteria

- Retention duration, cadence, timestamps, frequency grids, and Vectorscope pair counts are
  unchanged.
- Live panel results remain sourced from the existing full-precision live payload.
- Quantization stays within the numerical and visual tolerances above.
- A single active Stereo Map Mode does not retain `PL/PR/C` history.
- Stereo Map Mode gaps are explicit Missing states, never backfilled from another Mode.
- Identical panels share packed history; multiple Modes share Energy and the Rust measurement
  request.
- No consumer decodes or allocates history proportional to four hours when it needs one row or one
  canvas-sized view.
- Spectrum and Polar Max Hold snapshot lookup no longer starts with a full-history replay.
- Waveform visual snapshot no longer materializes a 360,000-reference array.
- Four-hour projected bytes match the packed formulas and the real soak shows a stable plateau.

## Out of scope

- Shorter panel-specific retention.
- Lower cadence for old or current history.
- Temporal tiers or old-history decimation.
- Reducing the Spectrum or Stereo Map band grid.
- Disk-backed or Rust-owned cold history.
- Changing Rust DSP precision or IPC payload types.
- General React render scheduling and canvas redraw optimization.
- Completing the remaining scalar snapshot-entry refactor.
