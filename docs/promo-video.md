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
