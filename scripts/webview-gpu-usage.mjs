/**
 * Measures what the app costs on the GPU, per second, attributed to the WebView2 GPU process.
 *
 * This is the third instrument in the perf set and it answers what neither of the other two can.
 * `webview-cpu-profile.mjs` samples the renderer's main thread, and the panels' own counters time
 * the rAF callback -- both stop at the moment a draw call is submitted. `ctx.stroke()` returns
 * before anything is rasterised: the geometry is tessellated and painted later, in the GPU process,
 * on nobody's stopwatch. A panel can therefore look cheap in every existing instrument and still
 * cost more than the one it is being compared against (Spectrogram 3D Lines vs Surface, which is
 * what this script was built for -- see `docs/working/perf/spectrogram.md`).
 *
 * Windows exposes per-process GPU time as the `GPU Engine` counter set, which is the same source
 * Task Manager's GPU column reads. No debugging port and no code change is needed; the app just has
 * to be running.
 *
 *   node scripts/webview-gpu-usage.mjs --seconds 10 --label "3D Lines"
 *
 * Three things about the reading, all of which change how it must be used:
 *
 * - **It is the whole app, not one panel.** One GPU process rasterises every panel plus the window
 *   itself, so a single number means nothing on its own. Take a floor reading (the panel closed, or
 *   in a mode already judged cheap) and read the difference. Same window size, same layout, same
 *   signal -- device pixels are the input variable that matters most here.
 * - **`Utilization Percentage` is per engine.** A process can run on 3D, copy and video engines at
 *   once, so the engines can sum past 100%. Task Manager shows the largest one; this reports the
 *   per-engine breakdown and their sum, because for canvas work the split between 3d and copy is
 *   itself the finding (tessellation vs texture upload).
 * - **The counter is sampled once a second.** Ten seconds is ten samples; the max column is a real
 *   observation but a coarse one, so don't read a single spike as a frame time.
 *
 * The GPU process also burns CPU getting work to the driver, and that CPU is invisible to a
 * renderer profile for the same reason the GPU time is. It is reported alongside.
 */
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const DEFAULTS = { seconds: 10, app: "plvs.exe", label: "" };

export function parseArgs(argv) {
  const options = { ...DEFAULTS, pids: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inline] = argv[i].split("=");
    const value = inline ?? argv[i + 1];
    const take = () => {
      if (inline === undefined) i += 1;
      return value;
    };
    if (flag === "--seconds") options.seconds = Number(take());
    else if (flag === "--app") options.app = String(take());
    else if (flag === "--label") options.label = String(take());
    else if (flag === "--pid") options.pids.push(Number(take()));
    else if (flag === "--help" || flag === "-h") options.help = true;
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (!Number.isFinite(options.seconds) || options.seconds <= 0) {
    throw new Error("--seconds must be positive");
  }
  if (options.pids.some((pid) => !Number.isInteger(pid) || pid <= 0)) {
    throw new Error("--pid must be a process id");
  }
  return options;
}

/**
 * Picks the GPU process out of a process listing.
 *
 * A machine can have many `msedgewebview2.exe` processes -- other WebView2 apps, and one browser
 * process plus a renderer, a GPU process and several utilities per app -- so neither the name nor
 * the `--type=gpu` switch is enough on its own. Ancestry is: the GPU process's parent is the
 * WebView2 browser process, whose parent is the Tauri host. Walking up to the host is what makes
 * the reading PLVS's rather than some other app's.
 *
 * Returns every match. A second instance of the app is a real possibility during A/B work and
 * silently measuring the wrong one would be indistinguishable from a mode being cheap.
 */
export function pickGpuProcesses(processes, appName) {
  const byPid = new Map(processes.map((process) => [process.ProcessId, process]));
  const target = appName.toLowerCase();

  const descendsFromApp = (process) => {
    const seen = new Set();
    let current = process;
    while (current && !seen.has(current.ProcessId)) {
      seen.add(current.ProcessId);
      if ((current.Name ?? "").toLowerCase() === target) return true;
      current = byPid.get(current.ParentProcessId);
    }
    return false;
  };

  return processes
    .filter(
      (process) =>
        (process.Name ?? "").toLowerCase() === "msedgewebview2.exe" &&
        /--type=gpu-process|--type=gpu\b/.test(process.CommandLine ?? "") &&
        descendsFromApp(process)
    )
    .map((process) => ({ pid: process.ProcessId, parentPid: process.ParentProcessId }));
}

/**
 * Reduces the per-second instance readings to one row per engine type.
 *
 * Instance names carry the pid, the adapter and the engine index (`pid_1234_luid_..._engtype_3d`),
 * and a process runs on several engines of the same type. Summing same-type engines within a sample
 * and only then averaging is what keeps "two copy engines at 20%" from reading as 20%.
 */
export function summarizeSamples(samples) {
  const perEngine = new Map();
  const totals = [];

  for (const sample of samples) {
    const byType = new Map();
    for (const [instance, value] of Object.entries(sample)) {
      const type = instance.split("engtype_")[1] ?? "unknown";
      byType.set(type, (byType.get(type) ?? 0) + value);
    }
    for (const [type, value] of byType) {
      if (!perEngine.has(type)) perEngine.set(type, []);
      perEngine.get(type).push(value);
    }
    totals.push([...byType.values()].reduce((sum, value) => sum + value, 0));
  }

  const rows = [...perEngine].map(([type, values]) => ({
    engine: type,
    // Samples where an engine reported nothing are absent rather than zero, so the mean is over the
    // whole run, not over the samples that happened to be non-zero -- otherwise an engine that
    // spikes once looks like an engine that is busy all the time.
    mean: values.reduce((sum, value) => sum + value, 0) / samples.length,
    max: Math.max(...values),
  }));
  rows.sort((a, b) => b.mean - a.mean);

  return {
    sampleCount: samples.length,
    rows,
    totalMean: totals.reduce((sum, value) => sum + value, 0) / (samples.length || 1),
    totalMax: totals.length ? Math.max(...totals) : 0,
  };
}

/** Parses the one-JSON-object-per-sample stream the PowerShell sampler writes. */
export function parseSampleStream(stdout) {
  const samples = [];
  for (const line of stdout.split(/\r?\n/)) {
    const text = line.trim();
    if (!text.startsWith("{")) continue;
    const parsed = JSON.parse(text);
    samples.push(parsed.engines ?? {});
  }
  return samples;
}

function powershell(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(stderr.trim() || `powershell exited ${code}`));
      else resolve(stdout);
    });
  });
}

async function readProcesses(appName) {
  // Only the two names on the chain are needed -- gpu process -> WebView2 browser process -> the
  // Tauri host -- and asking for every process on the machine means asking for every command line,
  // which is both slow and more of the user's environment than this has any business reading.
  const stdout = await powershell(
    `Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe' OR Name='${appName.replace(/'/g, "''")}'" | ` +
      "Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress -Depth 3"
  );
  const parsed = JSON.parse(stdout);
  return Array.isArray(parsed) ? parsed : [parsed];
}

/** CPU time the given processes have burned so far, in milliseconds. */
async function readCpuMs(pids) {
  const filter = pids.map((pid) => `ProcessId=${pid}`).join(" OR ");
  const stdout = await powershell(
    `Get-CimInstance Win32_Process -Filter "${filter}" | ` +
      "Select-Object ProcessId,KernelModeTime,UserModeTime | ConvertTo-Json -Compress"
  );
  const parsed = JSON.parse(stdout);
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  // Win32_Process reports both times in 100-nanosecond units.
  return rows.reduce((sum, row) => sum + (row.KernelModeTime + row.UserModeTime) / 10_000, 0);
}

async function sampleCounters(pids, seconds) {
  // Instance names are matched rather than requested by path: a pid with no GPU work has no
  // instance at all, and asking for one by name makes Get-Counter fail on exactly the reading that
  // should have come back as "this mode does nothing on the GPU".
  const pattern = `pid_(${pids.join("|")})_`;
  const script = [
    "$ErrorActionPreference='Stop'",
    `$re = '${pattern}'`,
    `Get-Counter -Counter '\\GPU Engine(*)\\Utilization Percentage' -SampleInterval 1 -MaxSamples ${seconds} |`,
    "ForEach-Object {",
    "  $engines = @{}",
    "  foreach ($s in $_.CounterSamples) {",
    "    if ($s.InstanceName -match $re -and $s.CookedValue -gt 0) {",
    "      $engines[$s.InstanceName] = [math]::Round($s.CookedValue, 3)",
    "    }",
    "  }",
    "  [pscustomobject]@{ engines = $engines } | ConvertTo-Json -Compress -Depth 3",
    "}",
  ].join("\n");
  return parseSampleStream(await powershell(script));
}

export async function measureGpu(options, log = console.log) {
  let pids = options.pids;
  if (pids.length === 0) {
    const found = pickGpuProcesses(await readProcesses(options.app), options.app);
    if (found.length === 0) {
      throw new Error(
        `no WebView2 GPU process under ${options.app}. Start the app first, or pass --pid.`
      );
    }
    if (new Set(found.map((process) => process.parentPid)).size > 1) {
      log(
        `Warning: ${found.length} GPU processes under ${options.app} — more than one instance is ` +
          "running. Close the others or the reading mixes them."
      );
    }
    pids = found.map((process) => process.pid);
  }

  log(`GPU process${pids.length > 1 ? "es" : ""}: ${pids.join(", ")}`);
  log(`Sampling ${options.seconds}s${options.label ? ` — ${options.label}` : ""}.`);

  const cpuBefore = await readCpuMs(pids);
  const samples = await sampleCounters(pids, options.seconds);
  const cpuAfter = await readCpuMs(pids);

  const summary = summarizeSamples(samples);
  const reading = {
    label: options.label,
    pids,
    ...summary,
    gpuProcessCpuMsPerSec: (cpuAfter - cpuBefore) / options.seconds,
  };
  report(reading, log);
  return reading;
}

function report(reading, log) {
  log("");
  if (reading.rows.length === 0) {
    log(
      `No GPU engine reported work in ${reading.sampleCount}s. Either nothing is animating, or ` +
        "the window is occluded — an occluded WebView2 window stops painting."
    );
  } else {
    log(`GPU engine utilization over ${reading.sampleCount} samples${label(reading)}:`);
    const width = Math.max(...reading.rows.map((row) => row.engine.length), 6);
    for (const row of reading.rows) {
      log(
        `  ${row.engine.padEnd(width)}  mean ${row.mean.toFixed(2).padStart(6)}%   ` +
          `max ${row.max.toFixed(2).padStart(6)}%`
      );
    }
    log(
      `  ${"sum".padEnd(width)}  mean ${reading.totalMean.toFixed(2).padStart(6)}%   ` +
        `max ${reading.totalMax.toFixed(2).padStart(6)}%`
    );
  }
  log(`GPU process CPU: ${reading.gpuProcessCpuMsPerSec.toFixed(1)} ms/s`);
  log("");
  log("Read this against a floor reading, not on its own: one GPU process serves every panel.");
}

function label(reading) {
  return reading.label ? ` — ${reading.label}` : "";
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(
      "usage: node scripts/webview-gpu-usage.mjs [--seconds 10] [--label text] [--app plvs.exe] [--pid N]"
    );
  } else {
    measureGpu(options).catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
