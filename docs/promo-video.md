# Video Production Workflow

A reusable workflow for producing videos from application footage. It is independent of visual
style, soundtrack, duration and publication format. Project-specific creative decisions belong
in the production project, not in this guide.

## Tool Responsibilities

| Tool                              | Responsibility                                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------------------------------- |
| PLVS Agent Control                | Inspect and configure the real application; perform supported actions and capture footage.            |
| Node.js orchestration             | Sequence setup, playback, capture, validation and cleanup; retain logs for each take.                 |
| Remotion                          | Compose footage and typography on a frame-based timeline; render still previews and versioned videos. |
| Python, NumPy/SciPy and SoundFile | Measure audio alignment and drift; generate asset metadata.                                           |
| FFmpeg / ffprobe                  | Extract audio and frames, inspect media properties and validate complete output decoding.             |
| Pillow                            | Assemble labeled contact sheets for visual review.                                                    |

These are complementary tools, not a requirement to automate every step. Use the
[CLI reference](user/cli.md) for current capabilities and command syntax, and the
[Agent Control contract](agent-control/README.md) when extending automation. For maintained PLVS
audio fixtures and still capture, see [Marketing screenshots](marketing-screenshots.md).

## 1. Define the Production Contract

Record output dimensions, frame rate, audio source, required application states, permitted asset
sources and approval checkpoints before capture. Define what each shot must demonstrate and what
visible change proves it. Keep these requirements separate from implementation details.

Render a representative composition early. Validate the recording and editing path with a short
take before collecting a full asset library. Resolve product-state and framing questions with
actual screenshots rather than assumptions.

## 2. Capture Reproducible Takes

- Agree on a time window before occupying the user's screen. Keep the pointer away from captured
  content and avoid user interaction, remote-session changes and lock/unlock transitions.
- Discover the target instance and capabilities, inspect its state, and configure it through
  supported application operations. Use revision checks; inspect and reconcile after conflicts.
- Keep capture state separate from the user's normal workspace where supported. Save a preflight
  screenshot and state inspection for each shot, including defaults that must remain unchanged.
- Verify the audio route and actual signal, allow history displays to populate, and test sustained
  recording performance at the intended dimensions and frame rate.
- Validate duration, audio presence, dropped frames and action results before accepting a take.
  Express tolerances relative to take length. Retry diagnosed failures, not an unchanged broken setup.
- Require explicit shot selection for batch capture. Restrict cleanup to verified working paths
  and processes owned by that capture run.

Capture multiple views against the same source audio when continuity between views matters.
Each view can then be selected during editing without restarting the audible track.

## 3. Establish Time Alignment

Keep three clocks distinct: source-media time, recorded-media time and visible application events.

For takes sharing a soundtrack, correlate their recorded audio with the master to estimate the
start offset. Check correlation strength and repeat the measurement in several usable regions to
detect drift. Skip windows beyond a short take's duration. Silence, repetitive passages, channel
cancellation or different mixes may require another alignment reference or manual verification.

For music-driven edits, express cues in bars and beats, then convert to integer frames centrally.
Verify any estimated tempo and downbeat against several musical landmarks; an initial estimate
can fit the opening while drifting later.

Command dispatch is not the visible event. Measure important changes in encoded footage and align
captions to those frames. Do not reuse a fixed latency correction across different capture setups
without checking it. Store audio offsets and visual-event corrections separately.

## 4. Compose from Metadata

Give each take a stable identifier and record its path, dimensions, frame rate, duration, alignment
offset and relevant event frames. Keep machine paths and shot-specific exceptions in configuration.

Centralize timeline conversion, sizing, alignment and text animation in small reusable components.
Preserve footage aspect ratio; make intentional crops explicit. Align typography using visible
glyph metrics rather than assuming the CSS line box matches the letters. Animated clipping boxes
need room for side bearings and descenders throughout the transition.

Render representative stills and short sections before the full movie. Change one unresolved area
at a time and preserve approved sections so revisions remain easy to assess.

## 5. Validate the Delivered File

Use the final encoded file for review, not only editor previews:

1. Inspect resolution, frame rate, duration and audio streams; decode the entire file for errors.
2. Extract stable frames and samples around entrances, exits and state changes. Review contact
   sheets for coverage and full-resolution frames for text, edges and fine detail.
3. Check caption timing against visible application events and footage timing against the audio.
4. Watch the video continuously with sound for pacing, freezes and discontinuities that stills miss.
5. After publication, check the platform-transcoded result at the intended viewing size.

When unchanged audio is required, compare decoded samples or hashes under equivalent encoding
conditions. A compressed-stream hash is useful only when the encoding is expected to be identical.
Record what was checked; sampled-frame review is not exhaustive motion review.

## 6. Archive a Reproducible Version

Render each revision to a new filename. Preserve the approved output with its source revision or
snapshot, dependency lockfile, configuration, asset manifest, validation results and approval status.
Record asset locations and checksums; a source snapshot alone is insufficient if its media is lost.

Keep current decisions separate from superseded experiments. Promote only reusable workflow and
maintained tools into the repository; retain footage, one-off patch scripts and production history
with the production archive. New work should be able to reproduce the accepted state without
replaying the conversation.

## Repository Tools

Run the tools below from the repository root after `npm ci`. Production media and configuration
stay in the external production directory; neither tool starts PLVS or occupies the screen.
They do not change application behavior and do not replace capture smoke tests.

### Check an Encoded Video

```powershell
node scripts/marketing/check-video.mjs "C:/production/film-v10.mp4" --out "C:/production/review-v10" --config "C:/production/review.json"
```

The output directory must not exist; its parent must exist. FFmpeg and ffprobe must be on PATH,
or supplied with `--ffmpeg PATH` and `--ffprobe PATH`. No Python environment is required. A review
configuration is optional; without one, the tool requires an audio track and samples three frames.
Example configuration (times are seconds):

```json
{
  "width": 1920,
  "height": 1080,
  "fps": 60,
  "duration": 74.688,
  "durationTolerance": 0.1,
  "requireAudio": true,
  "samples": [1.3, 24.7, 50, 69, 71.5],
  "transitions": [48.92, 50.85, 66.23],
  "transitionOffsets": [-0.1, 0, 0.1]
}
```

The tool checks expected properties, decodes all video/audio streams with error detection, and
produces original-size PNGs plus labeled contact sheets (12 images per sheet). It accepts at most
200 samples; out-of-range requests fail rather than silently disappearing. `samples: []` disables
ordinary samples, and `requireAudio: false` permits silent footage. Frame-rate comparison uses
the first non-cover video stream's average rate; it does not prove constant frame cadence.

`report.json` records the media metadata, checks, requested sample times, errors and outstanding
manual review. Exit code 0 means automated checks passed, not that typography or pacing was
approved. Exit code 1 means failure; an existing output directory is never reused. A failed run
retains its report and any completed images. FFmpeg operations have a 30-minute timeout each.

Use `--reference-audio "C:/production/film-v9.mp4"` to compare the first audio tracks exactly.
The tool hashes decoded signed 32-bit PCM and compares sample rate, channel count and channel
layout without trimming or resampling. This suits revisions expected to retain identical audio.
Lossy re-encoding, codec padding or comparison with a WAV master can produce a mismatch even
when they sound alike; this is not a perceptual audio comparison or a proof of picture/audio sync.

### Plan, Copy and Verify an Archive

```powershell
node scripts/marketing/archive-production.mjs plan "C:/production-config/archive.json" --out "C:/production-config/archive-plan.json"
node scripts/marketing/archive-production.mjs apply "C:/production-config/archive-plan.json"
node scripts/marketing/archive-production.mjs verify "C:/archives/PLVS-promo-v10"
```

The first command only inventories and hashes files, writing a new plan. Inspect that plan before
running `apply`. Example configuration for a Remotion project:

```json
{
  "source": "C:/production/plvs-promo",
  "destination": "C:/archives/PLVS-promo-v10",
  "rules": [
    { "path": "video/node_modules", "action": "omit" },
    { "path": "video/out", "action": "keep", "to": "history/outputs" },
    { "path": "recorder-duplicates", "action": "keep", "to": "history/raw", "deduplicate": true }
  ]
}
```

Source/destination paths are relative to the configuration file unless absolute. Rule paths and
`to` paths are source-relative, use forward slashes, and match an exact file or directory subtree;
there are no globs. Omit rules skip the entire matching tree without hashing it. Every rule must
match an existing entry, so remove example rules that do not apply. Rules cannot overlap. Unknown
files are preserved at their existing relative paths and marked `unclassified-preserved` in the
plan. Empty directories are not materialized. Normal `video/src`, `video/public`, configuration and
lockfile paths consequently remain usable together inside the archive's `files/` directory.

Deduplication is opt-in for extra recording pools, never implicit for project assets. It compares
SHA-256 contents within deduplication-enabled rules and maps duplicates to their retained file.
Do not enable it on assets referenced by path: it removes duplicate paths, not just duplicate
storage. Same-named files with different contents are kept separately; remapping collisions,
including case-only or file/directory collisions, fail before copying. Symlinks/junctions are
refused unless explicitly omitted; source and destination must be separate, non-nested trees.

The plan must be saved outside both trees. `apply` requires a new destination with an existing
parent. It regenerates the plan before copying, uses exclusive file creation, checks copied bytes
and source contents, and inventories the source again afterward. Changed inputs, edited plans or
copy errors fail the operation. An interrupted archive is retained with a non-complete
`archive-report.json`; do not treat it as a backup or reuse its directory for another attempt.
Use a fresh destination and regenerate the plan after resolving the failure.

A completed archive contains:

- `files/`: preserved content, with mappings recorded in `archive-plan.json`.
- `SHA256SUMS.json`: checksums and sizes for retained payload files.
- `archive-report.json`: completion status and copied source paths.
- `README.md`: archive structure and verification command.

`verify` checks payload hashes and reports missing, modified or additional payload files. It refuses
incomplete archives; exit code 0 means verification passed, and 1 means failure. Archive metadata
is not covered by the payload manifest; checksums detect accidental changes, not malicious
replacement of both files and manifest. Stop other writers during planning and copying: the
before/after checks detect changes but are not an atomic filesystem snapshot.

Neither command deletes, moves or cleans the source. After verifying the archive, independently
install dependencies and render a representative section before considering manual cleanup.
Recursive moves can stop partway when a file is locked; do not use a move as a substitute for
copy-and-verify. Historical snapshots require their media and lockfile as well as source files.

### Tests

```powershell
npm run test:marketing
```

The marketing suites are excluded from `npm test` and `npm run check`; run this command after
changing anything under `scripts/marketing/`.

Archive tests use temporary files and cover collisions, stale plans, interrupted copies, links,
source changes and damaged payloads. Media integration tests generate tiny temporary clips and
run when both FFmpeg and ffprobe are on PATH; otherwise they are explicitly skipped. Configuration
tests always run. No production footage or generated media fixtures are committed.
