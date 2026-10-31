# Preview Fixture Comparison Checks

Follow-up implementation to the floating-point investigation on 2026-11-01.

## Change

`preview-fixture-producer.mjs` now compares parsed JSON through
`preview-fixture-compare.mjs`. Narrow absolute limits apply only to named visual arrays;
source hashes, requests, measurements, timestamps, array lengths, keys and unknown fields
remain exact. See `docs/visual-and-capture-validation.md` for the maintained policy.

Comparison reports a mismatch count, up to five field paths and expected/actual values,
plus counts and maximum accepted differences by visual category. It does not overwrite
committed data in check mode. Explicit writes retain full generated precision and reject
non-finite values instead of serializing them to null.

Focused verification covers 33 comparison/write-boundary cases: accepted noise, exceeded
limits, both boundary directions, exact measurement and source changes, shape changes,
unknown fields, non-finite values, bounded diagnostics and unchanged baseline contents.

## Real Generator Verification on Apple Silicon macOS

`npm run homepage:fixture -- --archive /Volumes/xichen/PLVS/assets/audio` passes both
homepage stereo and 7.1.4. The Sharesets command passes its stereo and 5.1 music fixtures.
The 5.1 spectrogram's maximum accepted difference is 0.001746 dB, within the preselected
0.002 dB bound; no allowance was increased to accept it.

The full Sharesets command still fails on its dialogue stereo fixture because the newly
generated input WAV has a different hash from the committed source identity. Tiny changes
also occur in exact measurement fields, and some visual differences exceed the limits.
This is a deliberate refusal, not a reason to broaden visual allowances or rewrite the baseline.

| Generated input                                       | Recorded input SHA-256                                             | Current input SHA-256                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `stereo-antiphase.wav`                                | `e2d11c16394a9a46538d2deeeb06764014b1435d9598be756dea5beeea3a3d6e` | `b214c3788438599cd1432e212884fdd14e3b54a1555291c7383e79e993c67665` |
| `surround-dialogue.wav` before the preview's LFE gain | `bff057f193f46cdf466f00968ac46a3ea6e4a4713ee8ef07d74a232fa8fbb8a5` | `cb31e948862aea121be885fa5cf1e5820d194af8235dcc2b5fbdea38968a04b3` |

The latter is compared against the surround preview's recorded derivation source hash.
Both current hashes were independently generated after the manifest's pinned FLAC hashes
were verified. The benchmark generator decodes/resamples through the platform FFmpeg and
mixes floating-point synthetic layers in JavaScript; precise attribution of the historical
input difference requires its original generated WAV or generation environment. Neither
was recovered here. Source generation was not changed in this patch.

The Sharesets command stops at dialogue stereo, so the dialogue surround analyzer was not
run through that command. Only its base input identity was separately checked. Do not
report that all Sharesets fixture checks pass.

No committed fixture, source audio, published preview or NAS payload was modified. Input
hash evidence is retained locally under the ignored
`artifacts/diagnostics/preview-fixture-checks-20261101/` directory. Windows and Linux native
execution were not exercised. A follow-up to make dialogue input generation reproducible
must address source generation/provenance rather than weaken source identity checks.
