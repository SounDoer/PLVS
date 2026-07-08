# PLVS Promo Video — Plan A: "See What You Hear"

Music-driven promo, 60s, no narration (BGM + caption cards). Core concept: the
video's soundtrack IS the signal PLVS is metering — viewers hear the music and
watch the meters react to it in real time.

## Storyboard (60s)

| Time | Shot | Visual | Caption card | Music cue |
|------|------|--------|--------------|-----------|
| 0:00–0:05 | Cold open | Black frame; logo fades/pulses with a single synth note | `PLVS` → `See what you hear.` | Sparse intro: one pulsing note |
| 0:05–0:13 | Full view | Entire app window, all 7 meters alive at once | — | The drop: drums + bass enter |
| 0:13–0:17 | Close-up 1 | Level Meter, peaks punching on kicks | `Per-channel peaks. Instantly.` | Beat-cut on downbeat |
| 0:17–0:20 | Close-up 2 | Loudness panel, LUFS climbing | `ITU-R BS.1770 · EBU R128` | Beat-cut |
| 0:20–0:24 | Close-up 3 | Spectrum, bass shelf rising with sub | `Real-time FFT spectrum` | Beat-cut |
| 0:24–0:27 | Close-up 4 | Spectrogram scrolling, colorful energy | `Frequency over time` | Beat-cut |
| 0:27–0:31 | Close-up 5 | Vectorscope blooming wide on stereo synths | `Your stereo image, at a glance` | Widest-stereo section of track |
| 0:31–0:34 | Close-up 6 | Waveform history scrolling | `Waveform` | Beat-cut |
| 0:34–0:38 | Close-up 7 | Stats panel, numbers updating | `Session stats at a glance` | Beat-cut |
| 0:38–0:44 | Feature 1 | Session history: pause, drag the history scrub backwards — meters replay what just happened | `Missed a peak? Scroll back.` | **Stripped-down bridge — music falls quiet as time rewinds** |
| 0:44–0:48 | Feature 2 | Theme editor: cycle 2–3 themes quickly | `Make it yours.` | Bridge continues |
| 0:48–0:53 | Feature 3 | Layout customization: drag/resize panels, toggle views, snap between 2–3 different workspace layouts | `Your meters, your layout.` | Build-up |
| 0:53–0:56 | Privacy beat | Frame dims, meters glowing | `Local. Read-only. Your audio never leaves your machine.` | Final hit, then decay |
| 0:56–1:00 | End card | Logo + tagline + links | `PLVS — Free & open source` / `Windows + macOS` / `github.com/SounDoer/PLVS` | Clean resolve / silence |

Note: close-up cuts (0:13–0:38) are ~3.5s each on paper; in the edit, cut on
actual beats — exact boundaries will drift and that's fine.

## Recording checklist (shot list)

### Prep (before any take)
- UI in English, pick the best-looking theme, arrange all 7 meters in a clean layout.
- OS Do-Not-Disturb on; hide personal files/notifications; clean desktop if visible.
- Recorder: OBS window capture, native resolution (highest display available),
  60 fps, near-lossless quality (CRF ≤ 16 or CQP ~15). Disk space is cheap; re-shoots aren't.
- Mouse: move slowly and decisively — no hovering circles.
- Sync trick: final BGM file plays through system output, PLVS meters it via
  loopback. Leave 2s of silence before hitting play; the track's first transient
  is the sync point in the editor. Final video uses the original audio file,
  not the recorded system audio.

### Close-up strategy: enlarge the panel, don't crop in post

Close-ups are recorded as dedicated takes with the target panel enlarged to
dominate the window (same window size, same recording canvas) — NOT cropped
out of the master take in post. Reasons:

- In the 7-panel layout a single panel is only ~1/7 of the frame; cropping and
  upscaling it goes soft, even from a 4K recording.
- PLVS meters are vector-rendered in real time: an enlarged panel is *redrawn*
  with more detail (more spectrum resolution, finer vectorscope cloud, crisp
  labels), while a post-zoom only magnifies pixels.
- Sync across takes is a non-issue: every take plays the same BGM file from
  the start; align all takes to the audio waveform in the editor and the
  meters line up frame-perfect.

Close-up framing: don't let the panel fill 100% of the frame — keep a sliver
of neighboring panels / window chrome visible so it still reads as the same app.

Accumulation caveat: LUFS integrated and Stats accumulate from monitoring
start, so **every take must play the track from the beginning** — never start
mid-track, or close-up readings won't match the full-view shot.

### Takes
- **T1 — Master take** (full view): the 7-panel layout, play the entire final
  BGM once, record the whole app window from idle → meters animating. Used for
  the 0:05–0:13 full-view shot and as a fallback. Record 2–3 passes, pick the best.
- **T1a–T1g — Close-up takes** (one per meter, or fewer): rearrange the layout
  so the target panel dominates the window, replay the full track, record the
  whole window. A good layout can serve two adjacent panels per take, so 7
  close-ups may need only 4–5 takes.
- **T2 — Theme switch** (~15s): open theme picker/editor, snap through 2–3 themes
  (with BGM playing so meters stay alive under the theme change).
- **T3 — Layout customization** (~30s): with meters running, drag/resize panels,
  toggle views on/off, and switch between 2–3 prepared workspace layouts.
  Prepare the layouts beforehand so on camera it's just clean, decisive switches.
- **T4 — History scrub** (~25s): let the track play well past the chorus so the
  session history is rich, then pause and drag the history scrub backwards —
  one slow deliberate drag, then one decisive jump. The meters replaying past
  data is the money shot; make sure the panel layout shows several meters
  reacting to the scrub at once.
- **T5 — B-roll spares**: long spectrogram accumulation on a colorful section;
  vectorscope during the widest-stereo passage.

## Suno prompt

Custom mode, instrumental. Style field:

> Japanese city pop, instrumental, upbeat and breezy, 104 BPM. Sparse intro:
> a lone chorused electric guitar riff over soft hi-hats. Full band kicks in
> with a round funky slap bass, tight punchy drums, sparkling Rhodes electric
> piano, bright synth brass stabs and shimmering chorus guitars. Stripped-down
> bridge with just bass and light percussion, then a bigger final chorus,
> ending cleanly on one last chord hit. Warm 80s analog feel, very wide stereo
> image, punchy transients, clear dynamic contrast between quiet and full
> sections, no vocals.

Lyrics field (structure tags only):

```
[Intro]
[Groove]
[Chorus]
[Bridge]
[Final Chorus]
[End]
```

### Variations

**V1 — City pop, longer intro** (double the `[Intro]` tag in the lyrics field):

> Japanese city pop, instrumental, upbeat and breezy, 104 BPM. Long sparse
> intro: a lone chorused electric guitar playing a gentle riff over soft
> brushed hi-hats, unhurried, letting the space breathe before anything else
> enters. The full band then kicks in with a round funky slap bass, tight
> punchy drums, sparkling Rhodes electric piano, bright synth brass stabs and
> shimmering chorus guitars. Stripped-down bridge with just bass and light
> percussion, bigger final chorus, ending cleanly on one last chord hit.
> Warm 80s analog feel, very wide stereo image, clear dynamic contrast, no vocals.

**V2 — Future funk** (heavy sidechain pumping = meters visibly breathe on every beat):

> Future funk, instrumental, energetic and joyful, 118 BPM. Sparse filtered
> intro like a dusty vinyl loop fading in, then a hard-hitting drop: heavy
> sidechain-pumping bass and chords, funky chopped guitar samples, sparkling
> electric piano, punchy disco drums with crisp claps. Stripped-down bridge,
> then a triumphant final chorus, clean abrupt ending. Strong sidechain
> compression pumping on every beat, very wide stereo image, bright and
> glossy, no vocals.

**V3 — Jazz-funk fusion** (organic, "audio-professional" texture):

> Instrumental jazz-funk fusion, groovy and laid-back, 108 BPM. Quiet intro:
> solo fingered electric bass groove with soft ride cymbal. Band enters with
> crisp live drums, percussive slap bass, warm Rhodes piano comping, clean
> funky guitar chops and occasional bright horn section stabs. Dynamic
> arrangement with a quiet breakdown bridge, then a full final chorus, tight
> clean ending. Natural dynamics, punchy transients, wide stereo image, no vocals.

Selection criteria when auditioning generations:
- Big dynamic contrast (quiet intro vs. loud drop) — a brickwalled track makes
  the LUFS meter a flat boring line.
- A prominent, groovy bassline — makes the Spectrum's low shelf move visibly.
- Wide/panning stereo elements — makes the Vectorscope bloom.
- A clean sharp first transient — the sync point for editing.
