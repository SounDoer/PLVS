/**
 * Per-window-update silhouette probe for the Spectrogram's 3D Surface.
 *
 * Answers one question: as the window advances, how far does the terrain's top edge move, and in how
 * many columns does it move by a whole pixel? That is the "boiling" the 2026-08-31 WebGL rewrite was
 * aimed at, and this is the instrument its acceptance table is written in.
 *
 * The app must already be running with the debugging port open, on real signal, with the window
 * filled:
 *
 *   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 npm run desktop
 *   node scripts/spectrogram-shimmer-probe.mjs --seconds 60 --label "surface gl"
 *
 * Three things about the method are load-bearing and were each learned the expensive way. They are
 * in `docs/working/perf/spectrogram.md` §1 in full; in short:
 *
 * 1. THE DENOMINATOR IS UPDATES, NOT FRAMES. The panel repaints ~25 times a second while the visible
 *    window advances 10 times a second, so most repaints draw the same picture. Averaging over frames
 *    divides every real difference by five or six, and three separate hypotheses were read as "no
 *    effect" before this was noticed. Frames identical to their predecessor are dropped.
 *
 * 2. RUN WITH THE FLOOR GRID OFF. The floor is static geometry, and in a column the terrain does not
 *    reach it becomes the silhouette — a guaranteed zero, diluting the rate. Turning the grid off
 *    also removes the axis labels, which share the 2D canvas.
 *
 * 3. THE WEBGL ARM NEEDS A READABLE DRAWING BUFFER. `preserveDrawingBuffer` is false in the shipping
 *    build, as it should be, and `readPixels` then returns nothing. Measuring the GL renderer means a
 *    local build with that flag flipped. It changes buffer retention, not rasterisation.
 */
import { pathToFileURL } from "node:url";

import { pickTarget } from "./webview-cpu-profile.mjs";

const DEFAULTS = { port: 9222, seconds: 60, label: "" };

/** Alpha above which a pixel counts as covered. Matches the coverage snippet in the perf notes. */
export const ALPHA_FLOOR = 8;
/** One pixel's worth of opacity, accumulated down a column. See `silhouetteColumns`. */
export const INK_PER_PIXEL = 255;

export function parseArgs(argv) {
  const options = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i++) {
    const take = () => argv[++i];
    if (argv[i] === "--port") options.port = Number(take());
    else if (argv[i] === "--seconds") options.seconds = Number(take());
    else if (argv[i] === "--label") options.label = String(take());
  }
  if (!Number.isFinite(options.port) || options.port <= 0) throw new Error("--port must be a port");
  if (!Number.isFinite(options.seconds) || options.seconds <= 0) {
    throw new Error("--seconds must be positive");
  }
  return options;
}

/**
 * Two silhouette positions per column, because the two renderers do not place an edge the same way.
 *
 * `top` is the legacy definition — the first pixel over `ALPHA_FLOOR` — and it is what the original
 * 47–48% baseline was measured with. It is only meaningful for a HARD edge. A CPU rasteriser can put
 * a silhouette on integer pixels alone, so when it moves at all it moves a whole pixel, and that
 * quantisation is what the baseline was really counting. Read an MSAA edge the same way and it is
 * re-quantised: the outermost pixel of a coverage ramp crosses the threshold in and out as the
 * terrain slides a fraction of a pixel, and each crossing scores as a full-pixel jump — the metric
 * punishes the renderer exactly where antialiasing is working. Kept only for continuity with the
 * recorded baseline; do not compare arms with it.
 *
 * `ink` is the one to compare with. Accumulate alpha from the top of the column and take where the
 * total reaches one pixel's worth of opacity, interpolating inside the row that crosses it. A soft
 * level-driven fade and an MSAA coverage ramp are then the same thing — which, for "where does the
 * terrain begin", they are — and a hard edge collapses to the integer position, so both arms are
 * measured by one rule.
 *
 * (The obvious middle option does not work: "first solid pixel, minus the alpha of the pixel above"
 * assumes the partial pixel above is antialiasing coverage. Under the level-driven alpha fade it
 * usually is not — 83% of the CPU arm's columns have a partial pixel above a solid one, encoding
 * level rather than edge position.)
 *
 * `flipped` is set for `readPixels`, which returns rows bottom-up; both outputs are always in screen
 * rows, 0 at the top.
 *
 * Written to be self-contained: it is stringified into the page, so it may not close over anything.
 *
 * @returns {{ top: Int32Array, ink: Float64Array, coverage: number }}
 */
export function silhouetteColumns(pixels, width, height, flipped) {
  const ALPHA = 8;
  const INK = 255;
  const top = new Int32Array(width).fill(-1);
  const ink = new Float64Array(width).fill(NaN);
  let covered = 0;

  for (let x = 0; x < width; x++) {
    let accumulated = 0;
    let seenTop = false;
    for (let row = 0; row < height; row++) {
      const y = flipped ? height - 1 - row : row;
      const alpha = pixels[(y * width + x) * 4 + 3];
      if (!seenTop && alpha > ALPHA) {
        top[x] = row;
        seenTop = true;
      }
      const next = accumulated + alpha;
      if (next >= INK) {
        ink[x] = row - (alpha > 0 ? (next - INK) / alpha : 0);
        break;
      }
      accumulated = next;
    }
  }
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > ALPHA) covered++;
  return { top, ink, coverage: (100 * covered) / (width * height) };
}

/**
 * How far each column's silhouette moved between two updates.
 *
 * Columns without terrain in BOTH frames are skipped rather than counted as zero: a column the
 * terrain has not reached says nothing about how steady the terrain is.
 *
 * @returns {{ columns: number, popped: number, deformSum: number }}
 */
export function compareSilhouettes(previous, current) {
  let columns = 0;
  let popped = 0;
  let deformSum = 0;
  const width = Math.min(previous.length, current.length);
  for (let x = 0; x < width; x++) {
    const a = previous[x];
    const b = current[x];
    if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < 0) continue;
    const delta = Math.abs(b - a);
    columns++;
    deformSum += delta;
    if (delta >= 1) popped++;
  }
  return { columns, popped, deformSum };
}

/**
 * The collector, assembled from the functions above so the page runs the same code the tests assert.
 *
 * The largest GL canvas, not the first: a Spectrogram panel elsewhere in the workspace keeps its own
 * canvas mounted at the default 300x150 and lists ahead of the fullscreen one — the same decoy-first
 * shape `pickTarget` has to handle for Dock accessories.
 */
function collectorSource() {
  return `(() => {
  if (window.__PLVS_SHIMMER__) window.__PLVS_SHIMMER__.stop();
  const silhouetteColumns = ${silhouetteColumns.toString()};
  const compareSilhouettes = ${compareSilhouettes.toString()};

  const state = { frames: 0, updates: 0, changed: 0, source: null, error: null, running: true,
    top: { columns: 0, popped: 0, deformSum: 0 }, ink: { columns: 0, popped: 0, deformSum: 0 },
    coverageFirst: null, coverageLast: null };

  const glCanvas = [...document.querySelectorAll("canvas[data-spectrogram-gl]")]
    .sort((a, b) => b.width * b.height - a.width * a.height)[0];
  let read;
  if (glCanvas) {
    state.source = "webgl";
    const gl = glCanvas.getContext("webgl2");
    read = () => {
      const w = glCanvas.width, h = glCanvas.height;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return { w, h, px, flipped: true };
    };
  } else {
    state.source = "2d";
    const c = [...document.querySelectorAll("canvas")].sort((a, b) => b.width * b.height - a.width * a.height)[0];
    const ctx = c && c.getContext("2d");
    if (!ctx) state.error = "no 2d context on the widest canvas";
    read = () => ({ w: c.width, h: c.height, px: ctx.getImageData(0, 0, c.width, c.height).data, flipped: false });
  }

  let previous = null;
  let previousPixels = null;
  let raf = 0;
  function tick() {
    if (!state.running) return;
    raf = requestAnimationFrame(tick);
    let frame;
    try { frame = read(); } catch (e) { state.error = String(e); state.running = false; return; }
    state.frames++;

    let same = false;
    if (previousPixels && previousPixels.length === frame.px.length) {
      same = true;
      for (let i = 3; i < frame.px.length; i += 4) {
        if (frame.px[i] !== previousPixels[i]) { same = false; break; }
      }
    }
    previousPixels = frame.px;
    if (same) return;
    state.changed++;

    const s = silhouetteColumns(frame.px, frame.w, frame.h, frame.flipped);
    if (state.coverageFirst === null) state.coverageFirst = s.coverage;
    state.coverageLast = s.coverage;
    if (previous) {
      state.updates++;
      for (const [key, prev, cur] of [["top", previous.top, s.top], ["ink", previous.ink, s.ink]]) {
        const r = compareSilhouettes(prev, cur);
        state[key].columns += r.columns;
        state[key].popped += r.popped;
        state[key].deformSum += r.deformSum;
      }
    }
    previous = s;
  }
  raf = requestAnimationFrame(tick);
  window.__PLVS_SHIMMER__ = {
    stop() { state.running = false; cancelAnimationFrame(raf); },
    read() { return state; },
  };
  return state.source + (state.error ? " ERROR " + state.error : "");
})()`;
}

export function summarise(state, label) {
  const rate = (bucket) => (bucket.columns ? (100 * bucket.popped) / bucket.columns : null);
  const deform = (bucket) => (bucket.columns ? bucket.deformSum / bucket.columns : null);
  return {
    label,
    source: state.source,
    error: state.error,
    frames: state.frames,
    changedFrames: state.changed,
    updatesCompared: state.updates,
    coverageFirstPct: state.coverageFirst,
    coverageLastPct: state.coverageLast,
    poppingPct: rate(state.ink),
    deformPx: deform(state.ink),
    legacyPoppingPct: rate(state.top),
    legacyDeformPx: deform(state.top),
  };
}

let nextId = 1;
function send(socket, pending, method, params) {
  const id = nextId++;
  const promise = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  socket.send(JSON.stringify({ id, method, params }));
  return promise;
}

export async function runProbe(options, log = console.log) {
  const listing = await fetch(`http://127.0.0.1:${options.port}/json`).catch((error) => {
    throw new Error(
      `no debugging port on ${options.port} (${error.message}). Start the app with ` +
        `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=${options.port} npm run desktop`
    );
  });
  const target = pickTarget(await listing.json());
  if (!target) throw new Error("no attachable page");

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    }
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve);
    socket.addEventListener("error", () => reject(new Error("websocket failed")));
  });

  await send(socket, pending, "Runtime.enable");
  const installed = await send(socket, pending, "Runtime.evaluate", {
    expression: collectorSource(),
    returnByValue: true,
  });
  if (installed.exceptionDetails) {
    throw new Error(`collector failed: ${JSON.stringify(installed.exceptionDetails)}`);
  }
  log(`attached to ${target.url}, reading the ${installed.result.value} canvas`);

  await new Promise((resolve) => setTimeout(resolve, options.seconds * 1000));
  const out = await send(socket, pending, "Runtime.evaluate", {
    expression: "window.__PLVS_SHIMMER__.read()",
    returnByValue: true,
  });
  await send(socket, pending, "Runtime.evaluate", { expression: "window.__PLVS_SHIMMER__.stop()" });
  socket.close();
  return summarise(out.result.value, options.label);
}

// argv[1] is absent when the module is imported rather than run (`node -e`, some loaders),
// and pathToFileURL throws on undefined.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runProbe(parseArgs(process.argv.slice(2)))
    .then((row) => {
      if (row.coverageLastPct !== null && row.coverageLastPct < 8) {
        console.error(
          `\ncoverage is ${row.coverageLastPct?.toFixed(2)}% — under ~8% the reading is not valid, ` +
            `and a WebGL arm reading 0 usually means the build has preserveDrawingBuffer off`
        );
      }
      console.log(JSON.stringify(row, null, 1));
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
