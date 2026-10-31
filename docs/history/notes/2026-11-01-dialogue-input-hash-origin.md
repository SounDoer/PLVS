# Dialogue Input Hash Origin

Follow-up to the preview fixture checker work on 2026-11-01. This investigation recovers the
historical dialogue input hashes and resolves the source-generation uncertainty in the earlier
records. No production code, fixture baseline or comparison policy is changed here.

## Confirmed Cause

`scripts/dialogue-benchmark-fixtures.mjs` verifies the four original 16 kHz LibriSpeech FLAC
files, then asks the platform FFmpeg to decode and resample them to 48 kHz float32. JavaScript
mixes these samples with synthetic layers and writes the programme WAVs.

All four original FLAC hashes match their committed manifest. Decode-only float32 output at
16 kHz is identical between the bundled FFmpeg's default and `-cpuflags 0` modes. Differences
first appear during the 16-to-48 kHz resampling operation. They change PCM payload samples,
not merely WAV headers. The complete programme WAV headers, durations and channels match.

Different multiply/add grouping and fused multiply-add in this resampling step produce the
hash differences. This attribution is backed by exact reconstruction of both historical input
hashes, not only by similar numerical error sizes.

## Controlled Reconstruction

The official FFmpeg 7.1.5 source archive was verified against the SHA-256 already pinned in
`.github/workflows/build-ffmpeg-sidecars.yml`:
`de668509caf9e35e3cd162473441fdb29538c6d96ed080292b3cf9e6fc5d558f`.

A standalone diagnostic binary was built outside the repository and was never installed over
the bundled sidecar. It disables assembly and compiler vectorization and uses
`-ffp-contract=off`. Running the unchanged benchmark generator against it reproduces both
historical hashes exactly:

| Programme              | Historical and reconstructed SHA-256                               |
| ---------------------- | ------------------------------------------------------------------ |
| Stereo antiphase       | `e2d11c16394a9a46538d2deeeb06764014b1435d9598be756dea5beeea3a3d6e` |
| Base surround dialogue | `bff057f193f46cdf466f00968ac46a3ea6e4a4713ee8ef07d74a232fa8fbb8a5` |

A second build changes only the float `resample_common` function's contraction policy with a
scoped `#pragma clang fp contract(fast)`. This produces the exact same full programme hashes as
the bundled binary with `-cpuflags 0`. The filter coefficients, source data, synthetic-layer code,
normalization and WAV writer are unchanged in that comparison.

| Resampling path                  | Stereo hash prefix | Base surround hash prefix |
| -------------------------------- | ------------------ | ------------------------- |
| Scalar, separate multiply/add    | `e2d11c16394a`     | `bff057f193f4`            |
| Scalar, fused multiply-add       | `65b239e9cddd`     | `daae1d41bf33`            |
| Bundled default accelerated path | `b214c3788438`     | `cb31e948862a`            |

The full hashes are in local evidence. Turning off runtime CPU features alone does not disable
compiler-emitted fused operations; consequently `-cpuflags 0` is insufficient to recover the
historical output on this Mac. The bundled FFmpeg 7.1.5 and Homebrew FFmpeg 9.0.2 produce the same
two programme hashes for their corresponding default/scalar modes, so changing FFmpeg version
is not a sufficient explanation for these inputs.

This identifies a numerical path that reproduces the historical output. It does not establish
the old machine's hostname or exact toolchain retrospectively.

Relevant upstream implementation:

- [Scalar resampling template](https://raw.githubusercontent.com/FFmpeg/FFmpeg/n7.1.5/libswresample/resample_template.c)
- [AArch64 NEON resampling](https://raw.githubusercontent.com/FFmpeg/FFmpeg/n7.1.5/libswresample/aarch64/resample.S)

The latter uses fused multiply-add and a different accumulator grouping. The local scoped
contraction experiment isolates the additional compiler effect in the scalar path.

## Magnitude and Measurement Impact

The original programme WAVs were reconstructed and compared sample by sample with the current
bundled-default outputs. Headers are byte-identical in both cases.

| Programme | Changed interleaved samples | Maximum sample error      | Peak error level | Signal-to-difference ratio |
| --------- | --------------------------- | ------------------------- | ---------------- | -------------------------- |
| Stereo    | 201,658 of 1,536,000        | 0.00000011920928955078125 | -138.47 dBFS     | 145.12 dB                  |
| Base 5.1  | 230,374 of 5,760,000        | 0.00000008940696716308594 | -140.97 dBFS     | 164.12 dB                  |

An exact hash is deliberately sensitive to any changed byte, regardless of audibility. There
is no evidence of lost, substituted or corrupted original speech files. The new stereo input
changes its final True Peak by about 0.000000232 dB and its final dialogue Integrated by about
0.00000000132 LUFS. These changes do not alter displayed readings or final speech coverage/
active-state decisions for this sample. No listening test or universal VAD claim is made.

Reanalyzing both reconstructed inputs with the actual production offline pipeline restores
`measurementFrame` exactly, including dialogue fields. The reconstructed surround preview also
matches its committed final input hash after the existing LFE gain step. Surround loudness
history is exactly equal; stereo has one Short-term history value differing by
0.00000000000000355 LUFS. Timestamps, frame counts and speech selection are unchanged.

## Remaining Checker Differences

Recovering source identity does not make every floating-point result bit-identical across
execution environments. The checker still correctly reports that one exact stereo history value
and some visual bins differ from its policy. Some of these bins are near numerical silence:
for example, a final-spectrum value around -177 dB differs by about 0.24 dB. A relative dB
change at that tiny absolute power must not be described as a comparable error in programme level.

The complete reconstructed-input comparisons are retained in local evidence. This investigation
does not broaden comparison limits, round measurements or regenerate committed fixtures to
silence these remaining differences.

## Structural Repair Direction

The current benchmark test generates twice on the same machine and compares the two results.
It proves local repeatability, not cross-platform byte identity, so it cannot detect this issue.

For a durable source-identity contract, use one canonical, hash-pinned set of pre-resampled speech
samples or complete dialogue inputs across all checking machines. Keep the original FLACs and
record the conversion recipe/provenance. Avoid synthesizing the reference input afresh through
hardware-dependent resampling during an analyzer comparison. Validate the canonical hashes in
tests; do not weaken source hashes, force all production resampling to scalar, or replace the
installed/bundled FFmpeg with this diagnostic build.

Local ignored evidence: `artifacts/diagnostics/dialogue-input-origin-20261101/`, including
reconstructed WAVs, binary controls, the scoped source patch, source-decode/programme comparisons,
measurement differences and build evidence. The standalone tools are diagnostic artifacts, not
supported production commands. No NAS data or installed application was changed.
