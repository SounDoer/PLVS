# PLVS Promo Video — Design

## Goal

Produce a first promo video for PLVS using [hyperframes](https://github.com/heygen-com/hyperframes) — an
open-source framework (HTML/CSS/animation → deterministic MP4 via headless Chrome + FFmpeg) with a set of
agent skills for building videos from code. This is a first experiment with this workflow, not a committed
production pipeline.

## Scope

- One primary cut: 16:9, ~60 seconds, for landing page hero and YouTube. Other aspect ratios / channel-specific
  cuts (social vertical, shorter clips) are explicitly out of scope for this first pass — they can be derived
  later once the main cut exists.
- Audio: background music + key-phrase captions overlaid at the right moments. No voiceover, no narration,
  no digital avatar.
- Visual content is a **stylized reinterpretation** of the PLVS UI, not a pixel-accurate clone and not a
  screen recording of the real app. Existing landing page screenshots/assets are considered stale and are not
  reused as source material.

## Narrative

Two selling points, in this order:

1. Real-time audio metering (loudness / level / spectrum panels — precision and responsiveness)
2. Multichannel support / workflow flexibility (panel layout, multiple channels)

## Scene structure (60s)

| Time | Content | Point |
|---|---|---|
| 0–5s | Logo + title card | Brand open |
| 5–27s | Loudness/level/spectrum panel animation — values ticking, peak flashes, spectrum bars moving | Real-time metering |
| 27–50s | Single-channel panel "splitting" into a multichannel grid layout | Multichannel / workflow flexibility |
| 50–60s | Logo close + key caption (e.g. "PLVS — Real-time Audio Metering") | CTA |

Captions are short key phrases tied to each segment, not word-by-word dialogue captions.

## Visual style

Hand-built HTML/CSS/GSAP scenes that evoke the PLVS look without reproducing the real React component tree.
Reuse actual token values from `docs/design-tokens.md`:

- Background `#131110`, primary/brand `#fb923c`
- Meter gradient: clip `#f97373`, warning `#fbbf24`, safe `#34d399`

Meter/waveform/spectrum data is synthetic (JS-generated sine/random-walk values), not driven by the real audio
engine.

## Project location

New self-contained directory `promo/` at the repo root, scaffolded via `npx hyperframes`. It has its own
`package.json` and is **not** part of the root npm workspace or the `npm run check` pipeline — it's a
one-off asset-production tool, not shipped product code. Rendered MP4 output is not committed to git; the
source HTML/CSS/JS scene files are.

## Workflow

Use hyperframes' installable agent skills so the coding agent (Claude) writes the scene HTML/CSS/GSAP code
directly in `promo/`, using the local preview loop to iterate, then `hyperframes render` to produce the
final deterministic MP4.

## Open inputs needed from the user

- A background music track (file or licensed source) — hyperframes does not generate music.

## QA

No automated tests. Each of the 4 scenes is previewed locally for timing/color correctness before final
render; run hyperframes' lint before the final render. Acceptance is visual review, not test coverage.
