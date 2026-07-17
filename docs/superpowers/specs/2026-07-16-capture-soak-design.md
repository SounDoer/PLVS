# Capture Soak - Design

## Problem

`plvs-cli capture --seconds 10` proves the capture path is correct *now*. It says
nothing about what happens after four hours, and four hours is how PLVS is
actually used — the author's colleagues leave it up for a working day.

A whole class of defect is invisible to every check that exists: memory that
grows a few KB per frame, handles opened and never closed, metric values that
creep as error accumulates, chunk drops that only appear once something else on
the machine gets busy. Ten seconds and ten hours are both green until they
aren't. Nothing in `npm run check`, the smoke gate, or CI runs long enough to
see any of it.

## Goals

- Run the real capture path for hours against a known constant signal, sampling
  as it goes, and surface drift and growth as curves rather than a single number.
- Reuse the smoke gate's rig — same signal, same routing, same teardown — so
  there is one way to get audio into PLVS, not two.

## Non-Goals

- **Not a gate.** It never blocks a release. See Why This Is Not A Gate.
- Not CI. No sound card there, and no four-hour jobs.
- Not a GUI test. This measures the CLI process; see What It Does Not Cover.
- No scheduled/cron execution. See Trigger.

## Why This Is Not A Gate

The same reasoning that put the smoke check *in* the release flow keeps soak
out of it.

A leak is introduced by a **commit**, not by a release. Catching it at a
two-week release boundary tells you "something in the last fourteen days
leaks" — then you bisect fourteen days. Catching it the night you land the change
tells you which change.

And it cannot block anyway: a four-hour test cannot sit inside a release. Any
attempt to make it gate would end in a stale ledger recording that a soak once
passed on some ancestor commit — state that can lie, which the smoke gate design
already rejected for the same reason.

So soak is a **diagnostic**, not a gate. It runs when there is a reason to
suspect something, and as hygiene after audio work. If it never runs, nothing is
worse than before it existed. That is an honest description, not a weakness being
excused.

## Trigger

After landing a commit that touches `src-tauri/src/audio/`, `dsp/`, or
`engine/` — the only places a capture-path leak can come from. The author's
recent history is overwhelmingly `refactor(dock)` / `fix(dock)` / `feat(ui)`,
which cannot leak in the audio thread; soaking those would be pure waste.

**Nothing enforces this**, and no scheduled task should. A nightly cron demands
the machine be awake with VB-Cable free; it will fail on its own terms often
enough that its output stops being read, and a check nobody reads is worse than
no check.

What makes the trigger fire is the line in `CLAUDE.md`: it enters every agent
session automatically, so the agent that just landed an audio change reads it at
exactly the moment it matters. That is the enforcement mechanism, and it is more
reliable than the author remembering — by their own account they never type these
commands.

## What Gets Measured

`capture --seconds 14400 --every 10` already emits the series. Soak adds external
process sampling and reads the result.

### Drift — a hard criterion

Integrated loudness is the gated mean over the accumulated blocks. Feed a
**constant** signal and every block is identical, so the mean is
**mathematically independent of how many blocks have accumulated**. Integrated
LUFS should therefore be effectively constant over four hours — not "roughly
stable", but flat to within floating-point summation error.

This makes drift a sharp assertion rather than a judgement call: **any visible
movement is a defect** — accumulation error, or PCM being corrupted somewhere
upstream.

Two caveats:

- **Skip a warmup.** Early on, few blocks exist and BS.1770's relative gate has
  not settled, so the first readings legitimately differ. Ignore the first 60 s.
- The criterion is on the **spread** of the post-warmup series (`max - min`), not
  on agreement with any particular value. Suggested threshold 0.01 dB, to be
  replaced by a figure measured from the first real run.

### Memory — a soft criterion needing a baseline

There is no equivalent mathematical anchor, and one confound must be subtracted
before any growth is called a leak:

**`SummaryMeter` grows on purpose.** It accumulates `integrated_blocks` and
`short_terms` for the whole run — that is how gated integration works, and the
whole-run history is what `finish()` reduces.

The size is computable from the code rather than guessed. `summary_meter.rs:60`
sets `block_size: (sample_rate * 0.1)` — **100 ms blocks**, one push per block
into each vector. (BS.1770's 400 ms gating window is assembled from four of them
via the ring, so it does not change the push cadence.) Four hours is therefore
**144,000 entries**, at `[f64; 2]` = 16 bytes and `f64` = 8 bytes:

```
144,000 × 24 bytes ≈ 3.5 MB steady, ~7 MB peak across Vec reallocation
```

That is the floor, not a leak.

A real leak dwarfs this. The failure being hunted is KB-per-frame at ~10 frames
per second — hundreds of MB over four hours, not single digits. So the criterion
is coarse and that is fine; precision is not needed to tell 3 MB from 3 GB.

**Do not hardcode a threshold before measuring one.** Run the soak once on known
good code, record the number here, and compare future runs against it. An
invented threshold either cries wolf until it is ignored, or is loose enough to
miss the thing.

Sample RSS externally against the PID (`Get-Process ... | WorkingSet64`). The
`rssMb` field was deliberately cut from the CLI's contract: self-reporting would
mean a new dependency to tell the caller something it can already read, and the
external number measures the whole process rather than what the process believes
about itself.

### Dropped chunks

`droppedChunks` is cumulative and should stay 0. A non-zero value late in a run
means the callback fell behind — the result metric that made a separate
`callbackMaxUs` field unnecessary.

## What It Does Not Cover

**This measures `plvs-cli`, not the desktop app.** They share `audio/`, `dsp/`,
and `engine/` — which is where a capture-layer leak would live, so the coverage
is real — but the GUI additionally runs `MeterPipeline`, the IPC channel, and a
React frontend, none of which this touches. A leak in the webview or in the
frame bridge is invisible here.

Worse, the two processes' memory profiles are **not comparable**: the CLI's
`SummaryMeter` accumulates without bound by design, while the GUI's history is
bounded by the configurable retention setting. Do not read a CLI soak number as a
prediction of GUI memory.

## Rig — Shared With The Smoke Gate

Same signal (1 kHz, 60 s, L at -20 dBFS / R at -26 dBFS, looped), same VLC →
VB-Cable routing via an MMDevice endpoint id, same teardown. The asymmetry that
matters for the smoke gate's channel-map canary is irrelevant here, but a second
signal definition would be a second thing to keep correct for no gain.

This is the interface constraint the two specs share: **the rig is a shared unit**
— synthesize signal, resolve endpoint, start player, stop player — used by both
`smoke:capture` and `soak:capture`. Whichever is implemented first must factor it
out rather than inline it, or the second one duplicates it.

Rig failures exit `2` and code failures exit `1`, matching the smoke gate and the
CLI's existing contract. Teardown must run on every exit path: a VLC left looping
into a virtual cable is silent, so it would go unnoticed while poisoning the next
run.

## Reading The Result

Soak produces a JSONL file plus RSS samples. There is no pass/fail banner beyond
the drift criterion, and that is deliberate: **an agent reads this**, and an agent
can interpret a curve. What it cannot do is invent a baseline it was never given
— which is why the measured figures must be recorded here after the first run.

Expected shape of a healthy report:

```
Ran 4h. integratedLufs flat at -22.03 (spread 0.00x dB after warmup).
RSS 142 MB → ~14x MB, consistent with SummaryMeter accumulation.
droppedChunks 0.
```

## First Measurements (90 s, 2026-07-17)

A short run on known-good code, pending a real four-hour baseline:

```
Samples        : 18 (7 after the 60 s warmup)
integratedLufs : spread 0.0027 dB after warmup
droppedChunks  : 0
RSS            : 8.6 MB -> 8.6 MB
```

**The drift figure contradicts this spec's theory, and the theory was too clean.**
It argued integrated loudness must be flat to within floating-point error over a
constant signal. Observed spread is 0.0027 dB — orders of magnitude above float
error, and it is not a defect. Integrated loudness is a *cumulative* mean, so the
start-up transient is diluted as blocks accumulate: the value climbs
**monotonically toward its limit** rather than sitting still. What the spread
measures at 90 s is mostly that convergence tail.

This makes `max - min` the wrong statistic: it **conflates convergence (expected,
monotone, front-loaded) with drift (a defect)**. It is kept for now because it is
honest about what it measures and no data yet justifies anything cleverer.

**Consequences to settle with a real run, not by tuning:**

- `DRIFT_LIMIT_DB = 0.01` has only ~3.7× headroom over the 90 s figure.
- Over four hours the settled window spans t=60..14400, and the early samples
  carry more of the transient than a 90 s run's do — **the spread may be larger,
  not smaller, and could cross the limit on healthy code.**
- If it does, the fix is a longer warmup or a trend-based statistic (compare late
  halves), **not** a widened threshold. Widening it to fit an observation is how a
  check stops being one.

## Follow-on

- Run a real four-hour soak on known-good code and record the post-warmup spread
  and RSS start/end here. Until that exists, `DRIFT_LIMIT_DB` is a guess with a
  known risk of false-alarming, which is the one part of this spec that is not yet
  honest.
- **macOS** — unreachable from this rig; still unverified.
