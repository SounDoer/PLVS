# PLVS Promo Video Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a ~60s, 16:9 promo video for PLVS using hyperframes (HTML/CSS/GSAP → deterministic MP4), with stylized (not pixel-accurate) animated recreations of the metering and multichannel UI, driven by synthetic data, with BGM + key-phrase captions.

**Architecture:** A self-contained hyperframes project under `promo/` (own `package.json`, not part of the root npm workspace). One composition file holds the entire 60s timeline as a set of timed `clip` elements (`data-start`/`data-duration`/`data-track-index`), per hyperframes' data-attribute model. Four content blocks (intro, metering, multichannel, outro) are built as separate absolutely-positioned clip groups scheduled at different `data-start` offsets within that single file.

**Tech Stack:** hyperframes CLI (`npx hyperframes`), headless Chrome + FFmpeg (bundled by hyperframes), GSAP for eased motion, plain CSS for PLVS color tokens.

Reference spec: `docs/superpowers/specs/2026-07-01-promo-video-design.md`

---

### Task 1: Scaffold the hyperframes project and locate the composition entry file

**Files:**
- Create: `promo/` (via `npx hyperframes init`)

- [ ] **Step 1: Confirm prerequisites**

Run: `node --version && ffmpeg -version`
Expected: Node reports `v22.x` or higher; FFmpeg prints a version banner. (Already confirmed once in this session — re-check only if the environment changed.)

- [ ] **Step 2: Scaffold the project**

Run (from repo root):
```bash
npx hyperframes init promo
```
Expected: a new `promo/` directory is created with its own `package.json` and a starter composition.

- [ ] **Step 3: Inspect the generated structure**

Run: `ls -R promo` (or `find promo -maxdepth 3` if `-R` output is too long)
Find the HTML file that contains a `data-composition-id` attribute (this is the entry composition file). Record its exact path — every later task in this plan refers to it as **`<COMPOSITION_FILE>`**. Based on the hyperframes example structure, expect something like `promo/src/index.html` or `promo/compositions/main.html`; use whatever path is actually generated.

- [ ] **Step 4: Install the hyperframes agent skills locally**

Run (from `promo/`):
```bash
npx skills add heygen-com/hyperframes --all
```
Expected: command completes without error; skills are installed for use in this project.

- [ ] **Step 5: Verify the default scaffolded scene renders**

Run (from `promo/`):
```bash
npx hyperframes render
```
Expected: an MP4 file is produced (path printed by the command) with no errors. This validates the whole toolchain (headless Chrome + FFmpeg) works before any custom content is written.

- [ ] **Step 6: Commit the scaffold**

```bash
git add promo/
git commit -m "chore(promo): scaffold hyperframes project"
```

---

### Task 2: Set up PLVS color tokens and the 1920x1080 stage

**Files:**
- Modify: `<COMPOSITION_FILE>`
- Create: `promo/styles/tokens.css`

- [ ] **Step 1: Write the token stylesheet**

`promo/styles/tokens.css`:
```css
:root {
  --plvs-bg: #131110;
  --plvs-fg: #f5f0ea;
  --plvs-primary: #fb923c;
  --plvs-panel: #1e1b17;
  --plvs-meter-clip: #f97373;
  --plvs-meter-warn: #fbbf24;
  --plvs-meter-safe: #34d399;
}

body {
  margin: 0;
  background: var(--plvs-bg);
  color: var(--plvs-fg);
  font-family: -apple-system, "Segoe UI", sans-serif;
}
```

- [ ] **Step 2: Link the stylesheet and set stage dimensions in `<COMPOSITION_FILE>`**

Ensure the root stage element has:
```html
<div id="stage" data-composition-id="plvs-promo" data-start="0"
     data-width="1920" data-height="1080">
```
Add in `<head>`:
```html
<link rel="stylesheet" href="../styles/tokens.css">
```
(Adjust the relative path to actually match where `<COMPOSITION_FILE>` lives relative to `promo/styles/`.)

- [ ] **Step 3: Preview**

Run (from `promo/`): `npx hyperframes preview`
Expected: browser preview opens showing a plain dark (`#131110`) 1920x1080 stage with no errors in the console.

- [ ] **Step 4: Commit**

```bash
git add promo/styles/tokens.css <COMPOSITION_FILE>
git commit -m "feat(promo): add PLVS color tokens and stage setup"
```

---

### Task 3: Intro block (0–5s) — logo + title card

**Files:**
- Modify: `<COMPOSITION_FILE>`
- Create: `promo/styles/intro.css`

- [ ] **Step 1: Add the intro markup to `<COMPOSITION_FILE>`**

Inside `#stage`:
```html
<div class="clip intro" data-start="0" data-duration="5" data-track-index="0">
  <div class="intro-logo">PLVS</div>
  <div class="intro-title">Real-time Audio Metering</div>
</div>
```

- [ ] **Step 2: Style and animate it**

`promo/styles/intro.css`:
```css
.intro {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24px;
}
.intro-logo {
  font-size: 96px;
  font-weight: 700;
  color: var(--plvs-primary);
  opacity: 0;
  animation: intro-fade-scale 1.2s ease-out forwards;
}
.intro-title {
  font-size: 32px;
  color: var(--plvs-fg);
  opacity: 0;
  animation: intro-fade-scale 1.2s ease-out 0.6s forwards;
}
@keyframes intro-fade-scale {
  from { opacity: 0; transform: scale(0.85); }
  to   { opacity: 1; transform: scale(1); }
}
```
Link `intro.css` from `<COMPOSITION_FILE>`'s `<head>` the same way as `tokens.css`.

- [ ] **Step 3: Preview the first 5 seconds**

Run: `npx hyperframes preview`
Expected: logo fades/scales in around t=0-1.2s, title follows at t=0.6-1.8s, both remain visible until t=5s.

- [ ] **Step 4: Commit**

```bash
git add promo/styles/intro.css <COMPOSITION_FILE>
git commit -m "feat(promo): add intro logo/title block (0-5s)"
```

---

### Task 4: Metering block (5–27s) — loudness/level/spectrum animation

**Files:**
- Modify: `<COMPOSITION_FILE>`
- Create: `promo/styles/metering.css`
- Create: `promo/scripts/metering.js`

- [ ] **Step 1: Add the metering markup to `<COMPOSITION_FILE>`**

```html
<div class="clip metering" data-start="5" data-duration="22" data-track-index="0">
  <div class="meter-panel">
    <div class="meter-bar-track"><div id="meter-fill" class="meter-bar-fill"></div></div>
    <svg id="spectrum" viewBox="0 0 400 120" preserveAspectRatio="none"></svg>
  </div>
</div>
```

- [ ] **Step 2: Style the panel**

`promo/styles/metering.css`:
```css
.metering {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.meter-panel {
  width: 800px;
  padding: 40px;
  background: var(--plvs-panel);
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  gap: 32px;
}
.meter-bar-track {
  height: 28px;
  border-radius: 6px;
  background: rgba(255,255,255,0.06);
  overflow: hidden;
}
.meter-bar-fill {
  height: 100%;
  width: 0%;
  background: linear-gradient(
    90deg,
    var(--plvs-meter-safe) 0%,
    var(--plvs-meter-warn) 70%,
    var(--plvs-meter-clip) 92%
  );
}
#spectrum rect { fill: var(--plvs-primary); }
```

- [ ] **Step 3: Drive synthetic data with a deterministic script**

hyperframes renders are frame-accurate, so the animation must be deterministic (no `Math.random()` without a fixed seed). Use a simple deterministic pseudo-random function seeded by a constant:

`promo/scripts/metering.js`:
```js
function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function initMetering() {
  const fill = document.getElementById('meter-fill');
  const spectrum = document.getElementById('spectrum');
  const barCount = 32;
  const rand = seededRandom(42);

  for (let i = 0; i < barCount; i++) {
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', String(i * (400 / barCount) + 1));
    rect.setAttribute('width', String(400 / barCount - 2));
    rect.setAttribute('y', '0');
    rect.setAttribute('height', '0');
    spectrum.appendChild(rect);
  }
  const bars = Array.from(spectrum.querySelectorAll('rect'));

  // hyperframes exposes the current composition time in seconds on
  // `window.__hyperframesTime` per its render hook; fall back to
  // performance.now() for local preview outside that hook.
  function frame() {
    const t = window.__hyperframesTime ?? (performance.now() / 1000);
    const level = 55 + 35 * Math.abs(Math.sin(t * 1.3)) * (0.6 + 0.4 * rand());
    fill.style.width = `${Math.min(level, 100)}%`;

    bars.forEach((bar, i) => {
      const h = 20 + 90 * Math.abs(Math.sin(t * 2 + i * 0.4)) * (0.5 + 0.5 * rand());
      bar.setAttribute('height', String(h));
      bar.setAttribute('y', String(120 - h));
    });

    requestAnimationFrame(frame);
  }
  frame();
}

document.addEventListener('DOMContentLoaded', initMetering);
```

Link both `metering.css` and `metering.js` (as `<script src="../scripts/metering.js"></script>`) from `<COMPOSITION_FILE>`.

- [ ] **Step 4: Preview the metering segment**

Run: `npx hyperframes preview`, scrub to t=5s–27s.
Expected: the level bar and spectrum bars animate continuously and never freeze or throw console errors.

- [ ] **Step 5: Commit**

```bash
git add promo/styles/metering.css promo/scripts/metering.js <COMPOSITION_FILE>
git commit -m "feat(promo): add real-time metering animation block (5-27s)"
```

---

### Task 5: Multichannel block (27–50s) — single panel splitting into a grid

**Files:**
- Modify: `<COMPOSITION_FILE>`
- Create: `promo/styles/multichannel.css`
- Create: `promo/scripts/multichannel.js`

- [ ] **Step 1: Add the multichannel markup to `<COMPOSITION_FILE>`**

```html
<div class="clip multichannel" data-start="27" data-duration="23" data-track-index="0">
  <div id="channel-grid" class="channel-grid">
    <div class="channel-panel"></div>
  </div>
</div>
```

- [ ] **Step 2: Style base + grid states**

`promo/styles/multichannel.css`:
```css
.multichannel {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.channel-grid {
  width: 900px;
  height: 500px;
  display: grid;
  gap: 12px;
  grid-template-columns: 1fr;
  grid-template-rows: 1fr;
  transition: grid-template-columns 1s ease-in-out, grid-template-rows 1s ease-in-out;
}
.channel-grid.split-2 { grid-template-columns: 1fr 1fr; }
.channel-grid.split-6 { grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(2, 1fr); }
.channel-panel {
  background: var(--plvs-panel);
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.06);
}
```

- [ ] **Step 3: Script the split sequence keyed off composition time**

`promo/scripts/multichannel.js`:
```js
function initMultichannel() {
  const grid = document.getElementById('channel-grid');
  let state = 'single';

  function panelCount(n) {
    while (grid.children.length < n) {
      const p = document.createElement('div');
      p.className = 'channel-panel';
      grid.appendChild(p);
    }
  }

  function tick() {
    const t = window.__hyperframesTime ?? (performance.now() / 1000);
    const local = t - 27; // seconds since this block started

    if (local >= 4 && state === 'single') {
      state = 'split-2';
      panelCount(2);
      grid.classList.add('split-2');
    } else if (local >= 10 && state === 'split-2') {
      state = 'split-6';
      panelCount(6);
      grid.classList.remove('split-2');
      grid.classList.add('split-6');
    }
    requestAnimationFrame(tick);
  }
  tick();
}

document.addEventListener('DOMContentLoaded', initMultichannel);
```

Link both files from `<COMPOSITION_FILE>`.

- [ ] **Step 4: Preview the multichannel segment**

Run: `npx hyperframes preview`, scrub to t=27s–50s.
Expected: a single panel at t=27s, splits to 2 panels around t=31s, splits to a 3x2 grid around t=37s, holds until t=50s.

- [ ] **Step 5: Commit**

```bash
git add promo/styles/multichannel.css promo/scripts/multichannel.js <COMPOSITION_FILE>
git commit -m "feat(promo): add multichannel split animation block (27-50s)"
```

---

### Task 6: Outro block (50–60s) + captions across all blocks

**Files:**
- Modify: `<COMPOSITION_FILE>`
- Create: `promo/styles/outro.css`
- Create: `promo/styles/captions.css`

- [ ] **Step 1: Add the outro markup**

```html
<div class="clip outro" data-start="50" data-duration="10" data-track-index="0">
  <div class="outro-logo">PLVS</div>
  <div class="outro-caption">Real-time Audio Metering</div>
</div>
```

`promo/styles/outro.css`:
```css
.outro {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
}
.outro-logo {
  font-size: 72px;
  font-weight: 700;
  color: var(--plvs-primary);
}
.outro-caption {
  font-size: 24px;
  color: var(--plvs-fg);
}
```

- [ ] **Step 2: Add key-phrase captions over the metering and multichannel blocks**

Inside the `.metering` clip div (Task 4), add:
```html
<div class="caption">Precise, real-time loudness &amp; spectrum metering</div>
```
Inside the `.multichannel` clip div (Task 5), add:
```html
<div class="caption">Flexible multichannel workflows</div>
```

`promo/styles/captions.css`:
```css
.caption {
  position: absolute;
  bottom: 64px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 28px;
  color: var(--plvs-fg);
  background: rgba(19, 17, 16, 0.7);
  padding: 12px 28px;
  border-radius: 8px;
  white-space: nowrap;
}
```
Link `outro.css` and `captions.css` from `<COMPOSITION_FILE>`.

- [ ] **Step 3: Preview the full 60s composition**

Run: `npx hyperframes preview`, scrub start to end.
Expected: intro (0-5s) → metering with caption (5-27s) → multichannel with caption (27-50s) → outro (50-60s), no overlapping or missing content at any point on the timeline.

- [ ] **Step 4: Commit**

```bash
git add promo/styles/outro.css promo/styles/captions.css <COMPOSITION_FILE>
git commit -m "feat(promo): add outro block and key-phrase captions"
```

---

### Task 7: Wire up the BGM track (pending user-provided audio) and final render

**Files:**
- Modify: `<COMPOSITION_FILE>`
- Create: `promo/audio/README.md`

- [ ] **Step 1: Add a placeholder note for the audio asset**

`promo/audio/README.md`:
```markdown
Drop the background music file here as `bgm.wav` (or `bgm.mp3`) before running the final render.
```

- [ ] **Step 2: Wire the audio track into `<COMPOSITION_FILE>`**

Inside `#stage`, alongside the other clips:
```html
<audio class="clip" data-start="0" data-duration="60" data-track-index="1"
       data-volume="0.6" src="audio/bgm.wav"></audio>
```

- [ ] **Step 3: Once the user supplies `promo/audio/bgm.wav`, lint and render**

Run (from `promo/`):
```bash
npx hyperframes lint
npx hyperframes render
```
Expected: lint passes with no errors; render produces a 60-second MP4 with the intro/metering/multichannel/outro visuals, captions, and BGM audible throughout.

- [ ] **Step 4: Commit**

```bash
git add promo/audio/README.md <COMPOSITION_FILE>
git commit -m "feat(promo): wire up BGM track and finalize composition"
```

Note: the actual `bgm.wav` file and the final rendered MP4 are not committed to git (per the design doc — rendered output stays out of version control; add `promo/audio/*.wav`, `promo/audio/*.mp3`, and the render output directory to a `promo/.gitignore` if `hyperframes init` didn't already create one).
