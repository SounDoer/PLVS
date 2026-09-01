import { spawn } from "node:child_process";

import { pickTarget } from "./webview-cpu-profile.mjs";

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function attachToMainWebView(port, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`);
      const target = pickTarget(await response.json());
      // WebView2 publishes an about:blank target before Tauri navigates it to the app. Attaching to
      // that transient page succeeds but every UI assertion then fails for the wrong reason.
      if (target && !/^about:/.test(target.url ?? "")) return openCdpSession(target);
    } catch (error) {
      lastError = error;
    }
    await wait(250);
  }
  throw new Error(
    `no main WebView appeared on debugging port ${port}` +
      (lastError ? ` (${lastError.message})` : "")
  );
}

async function openCdpSession(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 1;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("could not open the CDP socket")), {
      once: true,
    });
  });

  const send = (method, params = {}) => {
    const id = nextId++;
    const result = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    socket.send(JSON.stringify({ id, method, params }));
    return result;
  };
  const evaluate = async (expression) => {
    const reply = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (reply.exceptionDetails) {
      throw new Error(reply.exceptionDetails.exception?.description ?? "WebView evaluation failed");
    }
    return reply.result?.value;
  };
  return { url: target.url, socket, send, evaluate, close: () => socket.close() };
}

export async function readUiFrameDiagnostics(session) {
  return session.evaluate('window.__TAURI_INTERNALS__.invoke("get_ui_frame_diagnostics")');
}

export function verifyBackpressurePhases({ normalStart, normalEnd, stalled, recovered }) {
  const failures = [];
  if (normalEnd.sentFrames <= normalStart.sentFrames)
    failures.push("normal phase received no frames");
  if (normalEnd.droppedFrames !== normalStart.droppedFrames) {
    failures.push("normal phase dropped UI frames");
  }
  if (stalled.droppedFrames <= normalEnd.droppedFrames) {
    failures.push("stall did not trigger an observable UI frame drop");
  }
  if (stalled.maxInflightFrames !== stalled.inflightLimit) {
    failures.push("stall did not reach the configured in-flight limit");
  }
  if (recovered.sentFrames <= stalled.sentFrames) failures.push("frame delivery did not resume");
  if (recovered.currentInflightFrames >= recovered.inflightLimit) {
    failures.push("WebView backlog did not recover below its limit");
  }
  return { ok: failures.length === 0, failures };
}

export const INSTALL_RUNTIME_PROBE = `(()=>{
  if (window.__PLVS_DESKTOP_SOAK__) return true;
  const state={longTasks:0,longTaskTotalMs:0,longTaskMaxMs:0,rafGaps:0,rafGapMaxMs:0,lastRaf:0,
    loafSupported:PerformanceObserver.supportedEntryTypes?.includes("long-animation-frame")===true,loafs:[]};
  try { state.observer=new PerformanceObserver(list=>{for(const e of list.getEntries()){
    state.longTasks++; state.longTaskTotalMs+=e.duration; state.longTaskMaxMs=Math.max(state.longTaskMaxMs,e.duration);
  }}); state.observer.observe({entryTypes:["longtask"]}); } catch {}
  if(state.loafSupported){try{state.loafObserver=new PerformanceObserver(list=>{for(const e of list.getEntries()){
    const scripts=[...(e.scripts||[])].sort((a,b)=>b.duration-a.duration).slice(0,8).map(s=>({
      duration:+s.duration.toFixed(2),forcedStyleAndLayoutDuration:+s.forcedStyleAndLayoutDuration.toFixed(2),
      pauseDuration:+s.pauseDuration.toFixed(2),invoker:s.invoker,invokerType:s.invokerType,
      sourceURL:s.sourceURL,sourceFunctionName:s.sourceFunctionName,sourceCharPosition:s.sourceCharPosition}));
    state.loafs.push({startTime:+e.startTime.toFixed(2),duration:+e.duration.toFixed(2),
      blockingDuration:+e.blockingDuration.toFixed(2),workDuration:+(e.renderStart?e.renderStart-e.startTime:e.duration).toFixed(2),
      renderDuration:+(e.renderStart?e.startTime+e.duration-e.renderStart:0).toFixed(2),
      styleAndLayoutDuration:+(e.styleAndLayoutStart?e.startTime+e.duration-e.styleAndLayoutStart:0).toFixed(2),scripts});
  }});state.loafObserver.observe({type:"long-animation-frame",buffered:true});}catch{state.loafSupported=false;}}
  const tick=t=>{if(state.lastRaf){const gap=t-state.lastRaf;if(gap>50){state.rafGaps++;state.rafGapMaxMs=Math.max(state.rafGapMaxMs,gap);}}
    state.lastRaf=t; state.raf=requestAnimationFrame(tick);}; state.raf=requestAnimationFrame(tick);
  window.__PLVS_DESKTOP_SOAK__={snapshot(){const longAnimationFrames=state.loafs.splice(0);return {longTasks:state.longTasks,
    longTaskTotalMs:+state.longTaskTotalMs.toFixed(2),longTaskMaxMs:+state.longTaskMaxMs.toFixed(2),
    rafGaps:state.rafGaps,rafGapMaxMs:+state.rafGapMaxMs.toFixed(2),documentHidden:document.hidden,
    domNodes:document.getElementsByTagName("*").length,longAnimationFrameSupported:state.loafSupported,longAnimationFrames};},
    stop(){state.observer?.disconnect();state.loafObserver?.disconnect();cancelAnimationFrame(state.raf);}};
  return true;
})()`;

export async function readWebViewSample(session) {
  const [runtime, performanceMetrics, ui] = await Promise.all([
    session.evaluate("window.__PLVS_DESKTOP_SOAK__.snapshot()"),
    session.send("Performance.getMetrics"),
    readUiFrameDiagnostics(session),
  ]);
  const metrics = Object.fromEntries(
    (performanceMetrics.metrics ?? []).map(({ name, value }) => [name, value])
  );
  return {
    ui,
    runtime,
    webview: {
      jsHeapUsedMb: (metrics.JSHeapUsedSize ?? 0) / 1024 / 1024,
      jsHeapTotalMb: (metrics.JSHeapTotalSize ?? 0) / 1024 / 1024,
      nodes: metrics.Nodes ?? runtime.domNodes,
      layoutCount: metrics.LayoutCount ?? null,
      recalcStyleCount: metrics.RecalcStyleCount ?? null,
    },
  };
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
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `PowerShell exited ${code}`));
    });
  });
}

export function classifyWebViewProcess(commandLine = "") {
  if (/--type=gpu-process|--type=gpu\b/.test(commandLine)) return "gpu";
  if (/--type=renderer\b/.test(commandLine)) return "renderer";
  if (/--type=utility\b/.test(commandLine)) return "utility";
  return "browser";
}

export async function readProcessTree(appPid) {
  if (!Number.isInteger(appPid) || appPid <= 0) throw new Error("appPid must be a process id");
  const script = [
    "$rows=Get-CimInstance Win32_Process -Filter \"Name='plvs.exe' OR Name='msedgewebview2.exe'\"",
    `$root=${appPid}`,
    "$ids=New-Object 'System.Collections.Generic.HashSet[int]'",
    "$null=$ids.Add($root)",
    "do{$changed=$false;foreach($p in $rows){if($ids.Contains([int]$p.ParentProcessId)-and -not $ids.Contains([int]$p.ProcessId)){$null=$ids.Add([int]$p.ProcessId);$changed=$true}}}while($changed)",
    "$rows|Where-Object{$ids.Contains([int]$_.ProcessId)}|Select-Object ProcessId,ParentProcessId,Name,CommandLine,WorkingSetSize,PrivatePageCount,KernelModeTime,UserModeTime|ConvertTo-Json -Compress -Depth 3",
  ].join("\n");
  const stdout = await powershell(script);
  if (!stdout) return [];
  const rows = JSON.parse(stdout);
  return (Array.isArray(rows) ? rows : [rows]).map((row) => ({
    pid: row.ProcessId,
    parentPid: row.ParentProcessId,
    kind: row.Name.toLowerCase() === "plvs.exe" ? "host" : classifyWebViewProcess(row.CommandLine),
    workingSetMb: Number(row.WorkingSetSize) / 1024 / 1024,
    privateMb: Number(row.PrivatePageCount) / 1024 / 1024,
    cpuMs: (Number(row.KernelModeTime) + Number(row.UserModeTime)) / 10_000,
  }));
}

export function summarizeDesktopSoak(samples) {
  if (samples.length === 0) return { sampleCount: 0 };
  const first = samples[0];
  const last = samples.at(-1);
  const total = (sample) => sample.processes.reduce((sum, row) => sum + row.workingSetMb, 0);
  const heap = samples.map((sample) => sample.webview.jsHeapUsedMb);
  const duration = Math.max(1, last.t - first.t);
  const afterWarmup = samples.filter((sample) => sample.t >= (last.t >= 600 ? 300 : 0));
  const secondHalf = samples.filter((sample) => sample.t >= last.t / 2);
  const slopePerMinute = (rows, read) => {
    if (rows.length < 2) return 0;
    const xMean = rows.reduce((sum, row) => sum + row.t, 0) / rows.length;
    const yMean = rows.reduce((sum, row) => sum + read(row), 0) / rows.length;
    const numerator = rows.reduce((sum, row) => sum + (row.t - xMean) * (read(row) - yMean), 0);
    const denominator = rows.reduce((sum, row) => sum + (row.t - xMean) ** 2, 0);
    return denominator === 0 ? 0 : (60 * numerator) / denominator;
  };
  const kinds = [...new Set(samples.flatMap((sample) => sample.processes.map((row) => row.kind)))];
  const sumKind = (sample, kind, field) =>
    sample.processes.filter((row) => row.kind === kind).reduce((sum, row) => sum + row[field], 0);
  const processGrowthMbByKind = Object.fromEntries(
    kinds.map((kind) => [
      kind,
      sumKind(last, kind, "workingSetMb") - sumKind(first, kind, "workingSetMb"),
    ])
  );
  const processCpuMsPerSecByKind = Object.fromEntries(
    kinds.map((kind) => [
      kind,
      (sumKind(last, kind, "cpuMs") - sumKind(first, kind, "cpuMs")) / duration,
    ])
  );
  const inflight = samples.map((sample) => sample.ui.currentInflightFrames).sort((a, b) => a - b);
  const longAnimationFrames = samples.flatMap((sample) => sample.runtime.longAnimationFrames ?? []);
  const worstLongAnimationFrames = [...longAnimationFrames]
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 10);
  return {
    sampleCount: samples.length,
    uiDroppedFrames: last.ui.droppedFrames - first.ui.droppedFrames,
    audioDroppedChunks: last.ui.audioDroppedChunks - first.ui.audioDroppedChunks,
    maxInflightFrames: Math.max(...samples.map((sample) => sample.ui.maxInflightFrames)),
    workingSetStartMb: total(first),
    workingSetEndMb: total(last),
    workingSetGrowthMb: total(last) - total(first),
    workingSetSlopeAfterWarmupMbPerMin: slopePerMinute(afterWarmup, total),
    workingSetSecondHalfSlopeMbPerMin: slopePerMinute(secondHalf, total),
    processGrowthMbByKind,
    processCpuMsPerSecByKind,
    jsHeapStartMb: heap[0],
    jsHeapEndMb: heap.at(-1),
    jsHeapMaxMb: Math.max(...heap),
    jsHeapSlopeAfterWarmupMbPerMin: slopePerMinute(
      afterWarmup,
      (sample) => sample.webview.jsHeapUsedMb
    ),
    currentInflightP95: inflight[Math.floor((inflight.length - 1) * 0.95)],
    longTasks: last.runtime.longTasks - first.runtime.longTasks,
    longTaskMaxMs: Math.max(...samples.map((sample) => sample.runtime.longTaskMaxMs)),
    longAnimationFrameSupported: samples.some(
      (sample) => sample.runtime.longAnimationFrameSupported === true
    ),
    longAnimationFrames: longAnimationFrames.length,
    longAnimationFrameMaxMs: longAnimationFrames.length
      ? Math.max(...longAnimationFrames.map((frame) => frame.duration))
      : 0,
    longAnimationFrameMaxBlockingMs: longAnimationFrames.length
      ? Math.max(...longAnimationFrames.map((frame) => frame.blockingDuration))
      : 0,
    worstLongAnimationFrames,
    rafGaps: last.runtime.rafGaps - first.runtime.rafGaps,
    rafGapMaxMs: Math.max(...samples.map((sample) => sample.runtime.rafGapMaxMs)),
  };
}
