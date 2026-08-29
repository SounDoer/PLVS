/**
 * Counts the canvas draw calls the running app issues, per panel, per second.
 *
 * This answers what a CPU profile cannot. A profile says where time went; it does not say **how
 * often a panel repaints** or **how many separate draw calls one repaint submits**. Both are
 * structural facts about the code rather than timings, and both have been guessed wrong here more
 * than once -- the Waveform panel's repaint rate was inferred from a dependency chain three times
 * and was wrong every time (`docs/working/perf/waveform.md` §2.0).
 *
 * Prerequisites are the profiler's (see `docs/working/perf/README.md`):
 *
 *   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 npm run desktop
 *   node scripts/webview-draw-count.mjs --seconds 5
 *
 * **Frames have to be moving.** An idle window draws nothing and this reports nothing, which reads
 * the same as a panel that is genuinely quiet. In a remote session the way to move them is file
 * analysis, not capture -- again, see the perf README.
 *
 * **The counters cost something.** Each wrapped call does a map lookup and a few increments, and a
 * Frequency Color draw submits tens of thousands per second. That is fine for counting and fatal
 * for timing, so this removes them again when it is done: never leave them installed and then
 * record a profile.
 */
import { pathToFileURL } from "node:url";

import { pickTarget } from "./webview-cpu-profile.mjs";

const DEFAULTS = { port: 9222, seconds: 5 };

/**
 * Canvas methods worth counting: each is one submission to the browser's rasteriser.
 *
 * `clearRect` and `putImageData` are also the repaint markers -- a painter clears its canvas or
 * uploads a whole image once per repaint, while `fill` can run once or once per pixel column
 * depending on the painter, which is exactly the thing being measured and so cannot be the divisor.
 */
const COUNTED_METHODS = [
  "clearRect",
  "putImageData",
  "fill",
  "stroke",
  "beginPath",
  "drawImage",
  "fillRect",
];

export function parseArgs(argv) {
  const options = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inline] = argv[i].split("=");
    const value = inline ?? argv[i + 1];
    const take = () => {
      if (inline === undefined) i += 1;
      return value;
    };
    if (flag === "--port") options.port = Number(take());
    else if (flag === "--seconds") options.seconds = Number(take());
    else if (flag === "--help" || flag === "-h") options.help = true;
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (!Number.isFinite(options.port) || options.port <= 0) throw new Error("--port must be a port");
  if (!Number.isFinite(options.seconds) || options.seconds <= 0) {
    throw new Error("--seconds must be positive");
  }
  return options;
}

/**
 * Runs in the page. Wraps the counted methods, keeping the originals so `uninstall` can put them
 * back -- a counter left behind would be measured by the next profile as if it were app code.
 *
 * Canvases are labelled by the nearest enclosing element carrying a panel marker, so the rows read
 * as panels rather than as anonymous canvas indices. A canvas React replaces mid-run is picked up
 * because the label is resolved at call time, not at install time.
 */
function pageInstaller(countedMethods) {
  const prototype = CanvasRenderingContext2D.prototype;
  if (globalThis.__PLVS_DRAW_COUNT__) globalThis.__PLVS_DRAW_COUNT__.uninstall();

  const counts = new Map();
  const originals = new Map();
  // Labels live here rather than on the canvas element: a property left on a DOM node would
  // outlive `uninstall` and the next run would silently reuse the previous run's naming.
  const labels = new WeakMap();

  /**
   * Names a canvas by what it belongs to. `data-leaf-path` is the workspace slot, which is what
   * separates two panels of the same kind; the index within that slot is what separates a panel's
   * own canvases, such as the Waveform panel's per-channel lanes. Both are read from the DOM at
   * call time, so a canvas React swaps out keeps its identity.
   */
  const labelFor = (canvas) => {
    if (!canvas) return "(no canvas)";
    const cached = labels.get(canvas);
    if (cached) return cached;
    const role = canvas.closest?.("[data-waveform-lane]")
      ? "waveform lane"
      : canvas.closest?.("[data-stereo-map-plot]")
        ? "stereo map"
        : canvas.closest?.("[data-testid]")?.dataset?.testid ||
          canvas.closest?.("[data-panel-id]")?.dataset?.panelId ||
          canvas.closest?.("[data-module-id]")?.dataset?.moduleId ||
          "canvas";
    const host = canvas.closest?.("[data-leaf-path]");
    const slot = host?.dataset?.leafPath ?? "";
    const siblings = host ? [...host.querySelectorAll("canvas")] : [];
    const index = siblings.indexOf(canvas);
    const suffix = siblings.length > 1 && index >= 0 ? ` #${index + 1}` : "";
    const label = `${role}${suffix}${slot ? ` ${slot}` : ""} ${canvas.width}x${canvas.height}`;
    labels.set(canvas, label);
    return label;
  };

  for (const method of countedMethods) {
    const original = prototype[method];
    if (typeof original !== "function") continue;
    originals.set(method, original);
    prototype[method] = function countedCall(...args) {
      const label = labelFor(this.canvas);
      let row = counts.get(label);
      if (!row) {
        row = {};
        counts.set(label, row);
      }
      row[method] = (row[method] ?? 0) + 1;
      return original.apply(this, args);
    };
  }

  globalThis.__PLVS_DRAW_COUNT__ = {
    startedAt: performance.now(),
    reset() {
      counts.clear();
      this.startedAt = performance.now();
    },
    read() {
      const elapsedSec = (performance.now() - this.startedAt) / 1000;
      const rows = [];
      for (const [label, methods] of counts) {
        const perSecond = {};
        for (const [method, total] of Object.entries(methods)) {
          perSecond[method] = total / elapsedSec;
        }
        rows.push({ label, perSecond, totals: { ...methods } });
      }
      return { elapsedSec, rows };
    },
    uninstall() {
      for (const [method, original] of originals) prototype[method] = original;
      delete globalThis.__PLVS_DRAW_COUNT__;
    },
  };
  return true;
}

async function connect(port) {
  const listing = await fetch(`http://127.0.0.1:${port}/json`).catch((error) => {
    throw new Error(
      `no debugging port on ${port} (${error.message}). Start the app with ` +
        `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=${port} npm run desktop`
    );
  });
  const target = pickTarget(await listing.json());
  if (!target) throw new Error(`nothing to count on port ${port}: no page target`);

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = { nextId: 1, byId: new Map() };
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const waiter = pending.byId.get(message.id);
    if (!waiter) return;
    pending.byId.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("could not open the CDP socket")), {
      once: true,
    });
  });

  const evaluate = async (expression) => {
    const id = pending.nextId++;
    const result = new Promise((resolve, reject) => pending.byId.set(id, { resolve, reject }));
    socket.send(
      JSON.stringify({
        id,
        // `Runtime.evaluate` has no top-level await, which is why every expression below is either
        // a plain one or an async IIFE paired with awaitPromise.
        method: "Runtime.evaluate",
        params: { expression, awaitPromise: true, returnByValue: true },
      })
    );
    const response = await result;
    if (response.exceptionDetails) {
      throw new Error(
        response.exceptionDetails.exception?.description ?? response.exceptionDetails.text
      );
    }
    return response.result?.value;
  };

  return { target, socket, evaluate };
}

export async function countDraws({ port, seconds }, log = console.log) {
  const { target, socket, evaluate } = await connect(port);
  log(`Attached to ${target.url}`);

  try {
    await evaluate(`(${pageInstaller.toString()})(${JSON.stringify(COUNTED_METHODS)})`);
    await evaluate("globalThis.__PLVS_DRAW_COUNT__.reset(), true");
    log(`Counting for ${seconds}s — make sure frames are actually moving.`);
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    const reading = await evaluate("globalThis.__PLVS_DRAW_COUNT__.read()");
    await evaluate("globalThis.__PLVS_DRAW_COUNT__.uninstall(), true");

    report(reading, log);
    return reading;
  } finally {
    socket.close();
  }
}

function report({ elapsedSec, rows }, log) {
  log("");
  if (rows.length === 0) {
    log(`Nothing drew in ${elapsedSec.toFixed(1)}s. An idle window looks exactly like this one:`);
    log("start capture, or drive file analysis, then count again.");
    return;
  }
  rows.sort((a, b) => sumOf(b.perSecond) - sumOf(a.perSecond));
  const methods = COUNTED_METHODS.filter((method) =>
    rows.some((row) => (row.perSecond[method] ?? 0) > 0)
  );
  const labelWidth = Math.max(...rows.map((row) => row.label.length), 8);
  const columnWidth = Math.max(12, ...methods.map((method) => method.length + 2));

  log(`Canvas calls per second over ${elapsedSec.toFixed(1)}s:`);
  log(
    `  ${"canvas".padEnd(labelWidth)}  ${methods.map((method) => method.padStart(columnWidth)).join("")}`
  );
  for (const row of rows) {
    log(
      `  ${row.label.padEnd(labelWidth)}  ` +
        methods
          .map((method) => (row.perSecond[method] ?? 0).toFixed(1).padStart(columnWidth))
          .join("")
    );
  }

  // The per-repaint figure is what says how a painter is built: one submission for the whole
  // shape, or one per pixel column. A painter that clears once and then fills 340 times is the
  // shape of the finding this tool exists to make legible.
  log("");
  log("Repaints per second, and calls per repaint:");
  for (const row of rows) {
    const repaints = row.perSecond.clearRect || row.perSecond.putImageData || 0;
    if (repaints <= 0) {
      log(
        `  ${row.label.padEnd(labelWidth)}  (no clearRect or putImageData: cannot tell repaints apart)`
      );
      continue;
    }
    const perRepaint = methods
      .filter((method) => method !== "clearRect")
      .map((method) => `${method} ${((row.perSecond[method] ?? 0) / repaints).toFixed(1)}`)
      .join("   ");
    log(`  ${row.label.padEnd(labelWidth)}  ${repaints.toFixed(1)}/s   ${perRepaint}`);
  }
}

function sumOf(perSecond) {
  return Object.values(perSecond).reduce((total, value) => total + value, 0);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: node scripts/webview-draw-count.mjs [--port 9222] [--seconds 5]");
  } else {
    countDraws(options).catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
