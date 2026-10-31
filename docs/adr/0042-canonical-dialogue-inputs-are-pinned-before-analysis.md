# ADR 0042: Canonical dialogue inputs are pinned before analysis

## Status

Accepted (2026-11-01).

## Context

The dialogue benchmark mixed programme WAVs from 16 kHz FLAC recordings resampled to 48 kHz
by the local FFmpeg. It was repeatable on one machine, but its floating-point resampling paths
produced different PCM bytes across execution environments. Checks compared analyzer results
whose source hashes were already different. Turning off runtime CPU features did not recover
the historical input because the compiler could still fuse multiply/add operations.

A scalar, unfused reconstruction recovers both historical preview input hashes exactly. The
input differences are tiny, but tolerating a changed input hash would weaken the claim that a
fixture comparison exercises the same signal.

## Decision

Commit the four reviewed, pre-resampled mono float32 speech inputs as lossless gzip payloads.
Keep the original FLACs and attribution. The corpus manifest pins original, compressed and raw
hashes, sample rate, frame count and the conversion recipe. It also pins each complete generated
programme WAV. Standard generation uses these samples directly, without a local decoder or
resampler, and rejects an output whose hash differs. The small synthetic mixing step remains
versioned code; its output pin detects runtime or recipe changes.

This stores about 2.5 MB of canonical speech rather than roughly 48 MB of complete programme WAVs.
It preserves the historical signal, preview fixtures and their provenance hashes. Unpinned custom
manifests may still use the decoder-based generation path; the standard corpus cannot silently
fall back to it by dropping a required canonical input or programme pin.

Numerical comparison remains separate from source identity. Final measurement values, speech
state, requests, time and structure remain exact. Only named visual fields and the minute
Float64 loudness-history roundoff have bounded allowances. Near-silence spectral comparison
uses a bounded absolute linear magnitude inside a fixed numerical range, so a large relative
dB difference in negligible FFT residue does not imply an accepted signal-level change.

## Consequences

- Source or recipe changes require deliberate canonical-asset/pin review before preview rebuilding.
  `--write` does not bypass input hashes.
- The normal benchmark tests can verify historical output hashes without an installed decoder.
  Compressed corruption, raw corruption and recipe drift are checked independently.
- Forcing scalar processing globally was rejected: it changes production performance and does not
  establish input identity across compilers. Relaxing source hashes or regenerating every frozen
  fixture was rejected because it silently changes the reference signal and preview provenance.
- Future JavaScript synthesis drift fails the programme hash rather than becoming new test input.
- Existing decoder-based experiments remain possible with explicit custom manifests; they do not
  redefine the standard corpus.
