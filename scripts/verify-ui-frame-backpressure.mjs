import { pathToFileURL } from "node:url";

import {
  launchDesktopPerfRig,
  parseRigArgs,
  startLiveCapture,
  stopDesktopPerfRig,
} from "./desktop-perf-rig.mjs";
import {
  readUiFrameDiagnostics,
  verifyBackpressurePhases,
  wait,
} from "./webview-observability.mjs";

export async function runAcceptance(options, log = console.log) {
  const rig = await launchDesktopPerfRig(options);
  try {
    log(`Attached to ${rig.session.url}`);
    const device = await startLiveCapture(rig.session, options.device);
    log(`Live signal: ${device}`);

    const normalStart = await readUiFrameDiagnostics(rig.session);
    await wait(1_500);
    const normalEnd = await readUiFrameDiagnostics(rig.session);

    await rig.session.evaluate(`(()=>{const end=performance.now()+${options.stallMs};
      while(performance.now()<end){};return true;})()`);
    const stalled = await readUiFrameDiagnostics(rig.session);

    await wait(2_000);
    const recovered = await readUiFrameDiagnostics(rig.session);
    const verdict = verifyBackpressurePhases({ normalStart, normalEnd, stalled, recovered });
    const report = {
      device,
      stallMs: options.stallMs,
      normalStart,
      normalEnd,
      stalled,
      recovered,
      verdict,
    };
    log(JSON.stringify(report, null, 2));
    if (!verdict.ok) throw new Error(verdict.failures.join("; "));
    return report;
  } finally {
    await stopDesktopPerfRig(rig);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const options = parseRigArgs(process.argv.slice(2), { stallMs: 4_000 });
  if (options.help) {
    console.log(
      "usage: node scripts/verify-ui-frame-backpressure.mjs [--exe path] [--port 9222] [--device name] [--stall-ms 4000]"
    );
  } else {
    runAcceptance(options).catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
