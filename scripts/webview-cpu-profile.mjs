/**
 * Records a CPU profile from the running app's webview and prints where the time went.
 *
 * The renderer is the one place the benchmarks cannot reach: React's commit and the browser's
 * paint only exist in a real window. WebView2 exposes the same Chrome DevTools Protocol Chrome
 * does, so this attaches over it, records, writes a `.cpuprofile`, and summarises it in the
 * terminal -- the summary is the point, because it makes a profile readable without a GUI.
 *
 * The app must already be running with the debugging port open, and it must be receiving audio:
 * a profile of an idle app measures nothing. Start it with
 *
 *   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 npm run desktop
 *
 * then, with sound actually playing into the capture device and the panels you care about open:
 *
 *   npm run profile:webview -- --seconds 10 --out spectrum.cpuprofile
 */
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const DEFAULTS = { port: 9222, seconds: 10, out: "webview.cpuprofile", top: 25 };

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
    else if (flag === "--out") options.out = String(take());
    else if (flag === "--top") options.top = Number(take());
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
 * The debugging port lists every page the app owns, and PLVS owns more than one: the Dock's header
 * and editor are separate windows on the same origin, distinguished only by a `surface` query.
 * They appear before the main window in the listing, so "the first page that is not about:blank"
 * attaches to a Dock accessory and profiles a window that draws almost nothing.
 */
export function pickTarget(targets) {
  const pages = targets.filter((target) => target.type === "page" && target.webSocketDebuggerUrl);
  if (pages.length === 0) return null;
  const usable = pages.filter(
    (page) => !/^about:/.test(page.url ?? "") && !/devtools/.test(page.url ?? "")
  );
  const main = usable.find((page) => !/[?&]surface=/.test(page.url ?? ""));
  return main ?? usable[0] ?? pages[0];
}

/** Self time per function, which is what identifies a hot spot; totals hide it behind callers. */
export function summariseProfile(profile, top = DEFAULTS.top) {
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const selfTicks = new Map();
  for (const id of profile.samples ?? []) {
    selfTicks.set(id, (selfTicks.get(id) ?? 0) + 1);
  }
  // Reported as it is, so an idle window says zero rather than one; only the division is guarded.
  const totalTicks = (profile.samples ?? []).length;
  const divisor = Math.max(1, totalTicks);
  const spanMs = (profile.endTime - profile.startTime) / 1000;

  const rows = [];
  for (const [id, ticks] of selfTicks) {
    const frame = byId.get(id)?.callFrame;
    if (!frame) continue;
    const where = frame.url ? frame.url.replace(/^.*\/(?=[^/]+$)/, "") : "";
    const line = frame.lineNumber >= 0 ? `:${frame.lineNumber + 1}` : "";
    rows.push({
      label: `${frame.functionName || "(anonymous)"}${where ? `  ${where}${line}` : ""}`,
      ms: (ticks / divisor) * spanMs,
      share: (ticks / divisor) * 100,
    });
  }
  rows.sort((a, b) => b.ms - a.ms);
  return { spanMs, totalTicks, rows: rows.slice(0, top) };
}

async function send(socket, pending, method, params) {
  const id = pending.nextId++;
  const result = new Promise((resolve, reject) => pending.byId.set(id, { resolve, reject }));
  socket.send(JSON.stringify({ id, method, params }));
  return result;
}

export async function recordProfile({ port, seconds, out, top }, log = console.log) {
  const listing = await fetch(`http://127.0.0.1:${port}/json`).catch((error) => {
    throw new Error(
      `no debugging port on ${port} (${error.message}). Start the app with ` +
        `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=${port} npm run desktop`
    );
  });
  const target = pickTarget(await listing.json());
  if (!target) throw new Error(`nothing to profile on port ${port}: no page target`);
  log(`Attached to ${target.url}`);

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

  await send(socket, pending, "Profiler.enable");
  await send(socket, pending, "Profiler.setSamplingInterval", { interval: 100 });
  await send(socket, pending, "Profiler.start");
  log(`Recording ${seconds}s — make sure audio is actually playing.`);
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  const { profile } = await send(socket, pending, "Profiler.stop");
  socket.close();

  await writeFile(out, JSON.stringify(profile));
  const summary = summariseProfile(profile, top);
  log("");
  log(`${out} — ${summary.spanMs.toFixed(0)} ms, ${summary.totalTicks} samples`);
  if (summary.totalTicks <= 1) {
    log("No samples: the webview was idle. Is audio playing into the capture device?");
    return summary;
  }
  log("");
  log("Self time, hottest first:");
  const width = Math.min(70, Math.max(...summary.rows.map((row) => row.label.length)));
  for (const row of summary.rows) {
    log(`  ${row.label.slice(0, width).padEnd(width)}  ${row.ms.toFixed(1)} ms  ${row.share.toFixed(1)}%`);
  }
  return summary;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(
      "Usage: npm run profile:webview -- [--port 9222] [--seconds 10] [--out file.cpuprofile] [--top 25]"
    );
  } else {
    recordProfile(options).catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
