/**
 * Drives one measurement arm of the Spectrogram Surface A/B: launch a build, put the panel into a
 * known state, wait for a full window, and report the main-thread cost with the canvas size beside
 * it.
 *
 *   node scripts/measure-surface-arm.mjs --exe path\\to\\plvs.exe --expect gl --label "arm B"
 *   node scripts/spectrogram-shimmer-probe.mjs --seconds 60 --label "arm B"   # while it is up
 *
 * It exists because the same three rig mistakes were made repeatedly by hand, each of which produces
 * a plausible-looking number from the wrong thing. All three are assertions here, not advice:
 *
 * 1. `Get-Process plvs` does NOT match `plvs-armB-measure`. A rename is enough for "kill the last
 *    arm" to silently do nothing, and two apps then race for one debugging port — after which every
 *    reading is of an unidentified process. The kill is by wildcard and the survivor count is
 *    asserted.
 *
 * 2. The capture device does NOT persist across launches, while the panel controls do. An arm can
 *    therefore come up pointed at a device with no signal and record two minutes of silence with an
 *    empty panel and no error anywhere — the same shape as the trap in `docs/working/perf/
 *    protocol.md` §10.3. The status bar is read back and asserted.
 *
 * 3. The window comes back at a different size from launch to launch (1383x640, 1918x886 and
 *    2222x1026 were all seen in one session with identical settings). Point count and row cap follow
 *    the canvas, so cost readings across launches are not comparable unless the size is recorded.
 *    It is reported with every result.
 *
 * The probe runs separately, against the app this leaves running, so an arm can be measured more
 * than once without relaunching.
 */
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { pickTarget } from "./webview-cpu-profile.mjs";

const DEFAULTS = {
  port: 9222,
  exe: "",
  label: "",
  expect: "",
  panel: "[1,1,1]",
  device: "CABLE Output",
  profileSeconds: 45,
  extraBrowserArgs: "",
};

export function parseArgs(argv) {
  const options = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i++) {
    const take = () => argv[++i];
    const flag = argv[i];
    if (flag === "--port") options.port = Number(take());
    else if (flag === "--exe") options.exe = String(take());
    else if (flag === "--label") options.label = String(take());
    else if (flag === "--expect") options.expect = String(take());
    else if (flag === "--panel") options.panel = String(take());
    else if (flag === "--device") options.device = String(take());
    else if (flag === "--seconds") options.profileSeconds = Number(take());
    else if (flag === "--browser-args") options.extraBrowserArgs = String(take());
  }
  if (!options.exe) throw new Error("--exe is required");
  if (options.expect !== "gl" && options.expect !== "cpu") {
    throw new Error('--expect must be "gl" (the WebGL build) or "cpu" (the rasteriser build)');
  }
  return options;
}

/**
 * The survivor check after a wildcard kill. Anything left means the next launch would race it for
 * the debugging port, and the arm that answers is then a coin toss.
 */
export function assertSingleApp(processNames) {
  const names = processNames.split(/\s+/).filter(Boolean);
  const unique = [...new Set(names)];
  if (unique.length === 0) throw new Error("the app did not start");
  if (unique.length > 1) {
    throw new Error(
      `expected exactly one PLVS process, found ${unique.join(", ")} — an earlier arm survived the ` +
        `kill and both are racing for the debugging port`
    );
  }
  return unique[0];
}

/** Reads back what the status bar says the capture device is; see trap 2. */
export function assertCaptureDevice(statusText, expected) {
  const shown = String(statusText ?? "").trim();
  const token = expected.split(/\s+/)[0];
  if (!shown || !new RegExp(token, "i").test(shown)) {
    throw new Error(
      `capture device is "${shown}", not ${expected} — this arm would record silence`
    );
  }
  return shown;
}

const ps = (command) =>
  spawnSync("powershell", ["-NoProfile", "-Command", command], { encoding: "utf8" }).stdout.trim();

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function attach(port) {
  const target = pickTarget(await (await fetch(`http://127.0.0.1:${port}/json`)).json());
  if (!target) throw new Error("no attachable page");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 1;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });
  await new Promise((resolve) => socket.addEventListener("open", resolve));

  const evaluate = async (expression) => {
    const id = nextId++;
    const reply = await new Promise((resolve) => {
      pending.set(id, resolve);
      socket.send(
        JSON.stringify({
          id,
          method: "Runtime.evaluate",
          params: { expression, returnByValue: true, awaitPromise: true },
        })
      );
    });
    if (reply.result?.exceptionDetails) {
      throw new Error(reply.result.exceptionDetails.exception?.description ?? "evaluate failed");
    }
    return reply.result?.result?.value;
  };
  return { socket, evaluate, url: target.url };
}

/**
 * Every failure after the socket opens has to close it.
 *
 * An open WebSocket keeps Node's event loop alive, so without this a failed assertion does not
 * report and exit -- it prints and then hangs forever, which reads as "the rig is stuck" rather than
 * "the arm is not what you asked for". Cost two ten-minute timeouts before it was noticed.
 */
async function withSocket(port, body) {
  const session = await attach(port);
  try {
    return await body(session);
  } finally {
    session.socket.close();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  ps("Get-Process | Where-Object { $_.ProcessName -like 'plvs*' } | Stop-Process -Force");
  await wait(4000);
  const survivors = ps(
    "Get-Process | Where-Object { $_.ProcessName -like 'plvs*' } | Select-Object -ExpandProperty ProcessName"
  );
  if (survivors) throw new Error(`processes survived the kill: ${survivors.replace(/\s+/g, ",")}`);

  const browserArgs = `--remote-debugging-port=${options.port} ${options.extraBrowserArgs}`.trim();
  spawn("powershell", [
    "-NoProfile",
    "-Command",
    `$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='${browserArgs}'; Start-Process '${options.exe}'`,
  ]);
  await wait(12000);
  const app = assertSingleApp(
    ps(
      "Get-Process | Where-Object { $_.ProcessName -like 'plvs*' } | Select-Object -ExpandProperty ProcessName -Unique"
    )
  );
  console.log(`app: ${app}`);

  const result = await withSocket(options.port, async ({ evaluate, url }) => {
    console.log(`attached to ${url}`);

    await evaluate(
      `[...document.querySelectorAll("button")].find(b=>b.getAttribute("aria-label")==="Devices").click()`
    );
    await wait(1200);
    await evaluate(`(()=>{
    const scope = document.querySelector("[role=dialog]") || document;
    const hit = [...scope.querySelectorAll("button,[role=option],li,div[tabindex]")]
      .find(e => (e.innerText||"").trim().startsWith(${JSON.stringify(options.device)}));
    if (!hit) throw new Error("device not offered: " + ${JSON.stringify(options.device)});
    hit.click();
  })()`);
    await wait(2500);
    await evaluate(`(()=>{
    const start = [...document.querySelectorAll("button")].find(b => (b.innerText||"").trim() === "START");
    if (start) start.click();
    const panel = document.querySelector('[data-leaf-path=${JSON.stringify(options.panel)}]');
    if (!panel) throw new Error("no panel at ${options.panel}");
    [...panel.querySelectorAll("button")].find(b=>b.getAttribute("aria-label")==="Fullscreen").click();
  })()`);
    await wait(4000);

    const device = assertCaptureDevice(
      await evaluate(`document.body.innerText.match(/Device\\s*\\n?([^\\n]*)/)?.[1] ?? ""`),
      options.device
    );
    console.log(`device: ${device}`);

    const shape = JSON.parse(
      await evaluate(`JSON.stringify((()=>{
      const gl=[...document.querySelectorAll("canvas[data-spectrogram-gl]")]
        .sort((a,b)=>b.width*b.height-a.width*a.height)[0];
      let readable=false;
      if(gl){ try{ const c=gl.getContext("webgl2"); const px=new Uint8Array(64);
        c.readPixels(0,0,4,4,c.RGBA,c.UNSIGNED_BYTE,px); readable=px.some(v=>v!==0);}catch{} }
      const two=[...document.querySelectorAll("canvas")].sort((a,b)=>b.width*b.height-a.width*a.height)[0];
      return { gl: !!gl, size: (gl??two) ? [(gl??two).width,(gl??two).height] : null, readable };
    })())`)
    );
    if (options.expect === "gl" && !shape.gl)
      throw new Error("expected the WebGL build, found none");
    if (options.expect === "cpu" && shape.gl)
      throw new Error("expected the CPU build, found WebGL");

    // The window is 1m by default, so a full one needs at least that much capture. Coverage is the
    // real gate wherever it can be read, because it is what proves two arms are comparable.
    console.log("waiting for the window to fill…");
    await wait(85000);
    let coverage = null;
    if (!shape.gl || shape.readable) {
      coverage = await evaluate(`(()=>{
      const gl=[...document.querySelectorAll("canvas[data-spectrogram-gl]")]
        .sort((a,b)=>b.width*b.height-a.width*a.height)[0];
      let px,w,h;
      if(gl){ const c=gl.getContext("webgl2"); w=gl.width; h=gl.height;
        px=new Uint8Array(w*h*4); c.readPixels(0,0,w,h,c.RGBA,c.UNSIGNED_BYTE,px); }
      else { const c=[...document.querySelectorAll("canvas")].sort((a,b)=>b.width*b.height-a.width*a.height)[0];
        w=c.width; h=c.height; px=c.getContext("2d").getImageData(0,0,w,h).data; }
      let n=0; for(let i=3;i<px.length;i+=4) if(px[i]>8) n++;
      return (100*n)/(w*h);
    })()`);
      if (coverage < 8)
        throw new Error(`coverage is ${coverage.toFixed(2)}% — no terrain to measure`);
    }

    await evaluate(`(()=>{const p=window.__PLVS_PANEL_CPU__;p.enable();p.reset();})()`);
    await wait(options.profileSeconds * 1000);
    const cpu = JSON.parse(
      await evaluate(`(()=>{
      const s=window.__PLVS_PANEL_CPU__.snapshot();
      const d=s["spectrogram3d:callbackDuration"]||{count:0,totalMs:0,maxMs:0};
      return JSON.stringify({ repaints:d.count, meanMs:+(d.totalMs/Math.max(1,d.count)).toFixed(3),
        maxMs:+d.maxMs.toFixed(2), dirty:(s["spectrogram3d:dirtyPaint"]||{}).count,
        skips:(s["spectrogram3d:signatureSkip"]||{}).count });
    })()`)
    );

    return {
      label: options.label,
      exe: options.exe,
      browserArgs,
      device,
      canvas: shape.size,
      drawingBufferReadable: shape.readable,
      coveragePct: coverage,
      cpu,
    };
  });

  console.log(JSON.stringify(result, null, 1));
  console.log(
    "\nthe app is left running — take the silhouette reading now:\n" +
      `  node scripts/spectrogram-shimmer-probe.mjs --seconds 60 --label ${JSON.stringify(options.label)}`
  );
}

// argv[1] is absent when the module is imported rather than run (`node -e`, some loaders),
// and pathToFileURL throws on undefined.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
