# Preview Fixture Floating-Point Differences

## Finding

The post-storage-migration fixture checks failed because `writeOrCheckFixture` compares the
complete formatted JSON string, including every floating-point digit. Regenerating on this
Apple Silicon Mac produces small differences in visual DSP output, while core measurements
remain exactly equal to the checked-in results. This is independent of the NAS path change:
the source stems and arranged WAV match their pinned hashes.

The observed pattern is consistent with platform/math/FFT floating-point variation. A controlled
accelerated-versus-scalar FFT experiment reproduces differences of the same scale on the same
input. The historical fixtures do not record the host, toolchain or FFT implementation, so the
exact historical execution path cannot be attributed conclusively. Do not describe a Windows
versus macOS comparison as having been performed.

No engine code, committed fixture, checker policy or published image was changed in this
investigation. No tolerance was added to make the failing checks pass.

## Environment and Inputs

- Baseline: `69f92c42f1848bda2770ee835aba7f79ba892818` on `main`.
- Host: `aarch64-apple-darwin`; Rust 1.99.1, LLVM 23.1.1; Node 24.19.0.
- Source library: `/Volumes/xichen/PLVS/assets/audio`.
- Arranged stereo WAV SHA-256:
  `3ebf579ffeedbb6ed8b47fd4f89b4bab991c20b8e2463d38fde7270224dfe707`.
- Window: 15–75 seconds, using the real offline file-analysis pipeline and the production
  preview producer, not a synthetic meter implementation.
- Existing homepage and Sharesets music fixtures were last changed in `b9573409`.
  Production DSP, engine and file-analysis source did not change between that commit and
  this investigation; dependencies did change and were examined separately below.

The strict checks can be reproduced without overwriting data:

```sh
npm run homepage:fixture -- --archive /Volumes/xichen/PLVS/assets/audio
npm run sharesets:fixture -- --archive /Volumes/xichen/PLVS/assets/audio
```

They fail first on `homepageStereoV1.json` and `sharesetsPreviewStereoV1.json`, respectively.
Their error message calls any text difference "stale"; it does not distinguish algorithm
changes, formatting changes and small numerical differences.

## Repetition and Measurement Results

Two independent new homepage stereo analyses exactly match one another and the earlier
migration-time analysis as parsed JSON. There is no observed run-to-run drift on this host.

Three layouts were regenerated to temporary files: homepage stereo, Sharesets stereo and
homepage 7.1.4. All retain identical source metadata, requests, clock, channel/sample-rate
metadata, complete `measurementFrame` and complete `loudnessHistory` compared with their
committed fixtures. There are no key, array-length or nonnumeric differences.

For homepage stereo, the unchanged values include:

| Measurement | Value                    |
| ----------- | ------------------------ |
| Momentary   | -11.294376816006329 LUFS |
| Short-term  | -10.781912159731705 LUFS |
| Integrated  | -12.869052979207398 LUFS |
| LRA         | 14.65137229082365 LU     |
| True Peak   | -0.7147283839017059 dBTP |
| Correlation | 0.5396014960522691       |

Sample peak, RMS, dialogue readings and max-hold measurement fields also remain exactly
identical. Therefore Profile status decisions receive the same inputs for these samples.

Differences are confined to visual data:

| Layout / field                                      | Largest absolute difference             |
| --------------------------------------------------- | --------------------------------------- |
| Homepage stereo spectrogram                         | 0.00133 dB, at approximately -113.48 dB |
| Homepage stereo final spectrum                      | 0.000026 dB                             |
| Homepage stereo waveform spectral centroid          | 0.0003 Hz                               |
| Homepage stereo Stereo Map power/cross-power fields | 0.0000000003                            |
| Homepage stereo frequency grid                      | 0.0000000000000071 Hz                   |
| Sharesets stereo spectrogram                        | 0.00043 dB, at approximately -107.30 dB |
| Sharesets stereo final spectrum                     | 0.000026 dB                             |
| Sharesets stereo waveform spectral centroid         | 0.0003 Hz                               |
| Homepage 7.1.4 waveform spectral centroid           | 0.001 Hz                                |

Homepage stereo has 397,004 differing numeric leaves because the spectrogram contains many
history rows and bins; the count does not imply 397,004 independent measurement failures.

## Controlled Numerical Experiments

The production spectral transform uses `RealFftPlanner<f32>`. Its underlying RustFFT planner
selects a hardware-accelerated implementation where available. On this host NEON is available.
The frequency grid and Hann window also use standard-library transcendental functions.

A temporary standalone probe used the actual input WAV and the production Hann-window formula
at the production FFT sizes. Identical windowed samples were processed through accelerated and
scalar complex FFTs. These are mechanism controls, not a reconstruction of the unknown historical
machine or a direct scalar replacement for the production real-FFT pipeline.

| FFT size | Accelerated/scalar differing complex bins | Largest magnitude difference above -120 dBFS |
| -------- | ----------------------------------------- | -------------------------------------------- |
| 1024     | 947                                       | 0.001080018 dB                               |
| 4096     | 3946                                      | 0.000888934 dB                               |
| 16384    | 15950                                     | 0.000621294 dB                               |

Repeating the accelerated FFT gives zero differing bins. Comparing realfft 3.5.0 with 3.5.1 on
this host also gives zero differing bins for all three sizes; their `src/lib.rs` files are
byte-identical. Serializing those output float vectors with serde_json 1.0.151 versus 1.0.154
gives identical strings. These controls do not support blaming those dependency upgrades for
the observed discrepancy, but they do not prove equivalence for every possible input.

Upstream references:

- [RustFFT planner source](https://docs.rs/rustfft/6.4.1/src/rustfft/plan.rs.html): hardware-dependent planner selection.
- [Rust f64 powf precision](https://doc.rust-lang.org/std/primitive.f64.html#method.powf): precision is not guaranteed to be identical across platforms or Rust versions.

## Rendered Impact

The actual application panels were rendered offline in the existing headless Chromium homepage
renderer. Each old/new pair used the same renderer build, viewport, recipe settings and browser.
No published images were replaced. This exercises the website/preview rendering path; it is not
a native live-capture acceptance run.

| Image               | Dimensions  | Differing pixels | Largest 8-bit color-channel difference |
| ------------------- | ----------- | ---------------- | -------------------------------------- |
| Homepage overview   | 1600 x 1000 | 0                | 0                                      |
| History             | 1590 x 880  | 12 of 1,399,200  | 3 of 255                               |
| Full-range spectrum | 1590 x 438  | 0                | 0                                      |
| 7.1.4 workspace     | 1590 x 795  | 0                | 0                                      |

The 12 history pixels are on antialiased spectrum curves. All eight renders report no browser
errors. The measurements and rendering comparisons show no meaningful user-visible impact for
the tested inputs. They do not establish mathematical identity across all hardware, all audio
or threshold-adjacent future inputs.

## Scope and Follow-up

The direct impact is the maintenance check: it reports these tiny numerical differences as a
hard "stale" failure. There is no evidence here of corrupted media, unstable analysis or a
changed loudness/peak result. Existing website images and Sharesets previews continue using the
unchanged committed data.

Do not automatically regenerate the frozen fixtures to silence the error: their hashes are part
of preview provenance. A future checker change should distinguish exact source/structure/clock/
measurement requirements from carefully bounded visual-field numerical comparisons, report the
location and size of differences, and retain meaningful regression detection. A single blanket
JSON tolerance or rounding every field is not justified by this investigation.

Future generation provenance should include the host target, Rust version and relevant DSP
library versions. The current evidence cannot identify the original host retrospectively.

Windows/Linux native execution, live capture hardware, Sharesets 5.1 and dialogue fixture
regeneration were not exercised. Capture code was not modified.

Local, ignored evidence is under `artifacts/diagnostics/preview-fixture-floats-20261101/`:
`summary.json`, numerical comparisons, eight rendered PNGs, render report and diagnostic sources.
The scripts retain this machine's temporary diagnostic paths and are investigation records,
not new supported maintainer commands. Temporary audio and full regenerated fixture files remain
outside Git; they are not production assets or NAS working backups.
