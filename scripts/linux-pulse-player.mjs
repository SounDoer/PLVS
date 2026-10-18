import { spawn } from "node:child_process";

const [device, wav] = process.argv.slice(2);
if (!device || !wav || device.startsWith("-") || wav.startsWith("-")) {
  process.exit(2);
}

let child = null;
let stopped = false;

function play() {
  if (stopped) return;
  child = spawn("paplay", [`--device=${device}`, wav], { stdio: "ignore" });
  child.on("exit", () => {
    child = null;
    if (!stopped) setTimeout(play, 50);
  });
}

function stop() {
  if (stopped) return;
  stopped = true;
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
  }
  process.exit(0);
}

process.on("SIGTERM", stop);
process.on("SIGINT", stop);
play();
