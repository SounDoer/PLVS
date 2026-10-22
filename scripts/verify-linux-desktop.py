#!/usr/bin/env python3
"""Runtime checks for an installed PLVS package, under Xvfb and a private session bus."""
import json
import os
from pathlib import Path
import ssl
import subprocess
import sys
import tempfile
import time


def run(args):
    return subprocess.check_output(args, text=True, timeout=30)


output = Path(sys.argv[1]).resolve()
fixtures = Path(sys.argv[2]).resolve()
package_name = sys.argv[3]
if package_name == "plvs-preview":
    app_name = "PLVS Preview"
    app_id = "com.soundoer.plvs.preview"
    binary, cli = "plvs-preview", "plvs-preview-cli"
else:
    app_name = "PLVS"
    app_id = "com.soundoer.plvs"
    binary, cli = "plvs", "plvs-cli"
sidecar_dir = Path("/usr/lib", package_name, "sidecars")
output.mkdir(parents=True, exist_ok=True)
if not ssl.create_default_context().get_ca_certs():
    raise RuntimeError("System TLS certificate trust is unavailable")
runtime = tempfile.TemporaryDirectory(prefix="plvs-package-session-")
os.environ["XDG_RUNTIME_DIR"] = runtime.name
os.environ["PULSE_SERVER"] = "unix:" + runtime.name + "/pulse.sock"
os.environ.pop("PLVS_FFMPEG_DIR", None)
os.environ.pop("WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS", None)
audio_log = (output / "pulse.log").open("w")
gui_log = (output / "desktop.log").open("w")
audio = subprocess.Popen([
    "pulseaudio", "-n", "--daemonize=no", "--exit-idle-time=-1",
    "--load=module-native-protocol-unix socket=" + runtime.name + "/pulse.sock",
    "--load=module-null-sink sink_name=plvs_package_test channels=2 rate=48000",
], stdout=audio_log, stderr=subprocess.STDOUT)
gui = None
try:
    for _ in range(100):
        if Path(runtime.name, "pulse.sock").exists():
            break
        if audio.poll() is not None:
            raise RuntimeError("Private audio server failed; inspect pulse.log")
        time.sleep(0.1)
    doctor = json.loads(run([cli, "doctor", "--json"]))
    (output / "doctor.json").write_text(json.dumps(doctor, indent=2) + "\n")
    report = doctor["result"]["report"]
    if not doctor["ok"] or report["app"]["name"] != app_name:
        raise RuntimeError("Installed CLI does not target the package identity")
    if report["app"]["version"] != run(["dpkg-query", "-W", "-f=${Version}", package_name]):
        raise RuntimeError("Installed application and package versions disagree")
    # The clean system has no distribution FFmpeg, so the recording encoder check must warn with
    # its install remedy (ADR 0037); every other check must pass.
    recording = next(c for c in report["checks"] if c["id"] == "visual-recording-encoder")
    if recording["status"] != "ok" and (
        recording["status"] != "warning"
        or recording["details"].get("remedy") != "sudo apt install ffmpeg"
    ):
        raise RuntimeError("Recording encoder check did not report its install remedy")
    blocking = [c["id"] for c in report["checks"] if c["status"] != "ok" and c is not recording]
    if blocking:
        raise RuntimeError("Installed doctor did not pass every check: " + ", ".join(blocking))
    for name in ("ffmpeg", "ffprobe"):
        check = next(c for c in report["checks"] if c["id"] == name + "-sidecar")
        if check["details"]["path"] != str(sidecar_dir / name):
            raise RuntimeError("Decoder did not resolve to the package-private sidecar")
    if not report["paths"]["dataDir"].endswith(app_id):
        raise RuntimeError("Package storage is not isolated")

    # Fixtures are generated outside this clean system. Only the package-private sidecars are used
    # here, proving that installation and file analysis do not depend on Ubuntu's ffmpeg package.
    manifest = json.loads((fixtures / "manifest.json").read_text())
    for fixture in manifest["fixtures"]:
        encoded = fixtures / fixture
        probe = json.loads(run([str(sidecar_dir / "ffprobe"), "-v", "error", "-show_streams", "-of", "json", str(encoded)]))
        if probe["streams"][0]["channels"] != 2:
            raise RuntimeError("Encoded fixture lost a channel")
        pcm = subprocess.check_output([str(sidecar_dir / "ffmpeg"), "-nostdin", "-v", "error", "-i", str(encoded),
                                       "-map", "0:a:0", "-vn", "-f", "f32le", "pipe:1"], timeout=30)
        if len(pcm) < 48000 * 2 * 4 * 0.9 or not any(pcm):
            raise RuntimeError("Decoder returned empty or silent PCM: " + fixture)

    gui = subprocess.Popen([binary], stdout=gui_log, stderr=subprocess.STDOUT)
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        if gui.poll() is not None:
            raise RuntimeError("Installed GUI exited early; inspect desktop.log")
        instances = json.loads(run([cli, "instances", "--json"]))
        if instances["ok"] and any(i["visible"] for i in instances["result"]["instances"]):
            (output / "instances.json").write_text(json.dumps(instances, indent=2) + "\n")
            break
        time.sleep(0.5)
    else:
        raise RuntimeError("Installed GUI did not register a visible workbench")
    time.sleep(5)
    if gui.poll() is not None:
        raise RuntimeError("Installed GUI crashed after startup")
    print(f"PASS: installed {app_name} identity, bundled decoders, and visible GUI")
finally:
    for child in (gui, audio):
        if child is not None and child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
    gui_log.close()
    audio_log.close()
    runtime.cleanup()
