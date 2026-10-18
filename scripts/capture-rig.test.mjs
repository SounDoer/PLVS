import { describe, it, expect, vi } from "vitest";
import { readFileSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import * as captureRig from "./capture-rig.mjs";
import {
  synthesizeSignal,
  compareMetrics,
  harnessArgs,
  staleHarnessSources,
  SIGNAL,
} from "./capture-rig.mjs";

describe("synthesizeSignal", () => {
  it("writes continuous PCM across repeated chunks and a partial final chunk", async () => {
    const path = join(tmpdir(), `plvs-rig-duration-${Date.now()}.wav`);
    try {
      await synthesizeSignal(path, { seconds: 2.125 });
      const buf = readFileSync(path);
      const frames = SIGNAL.sampleRateHz * 2.125;
      expect(buf.length).toBe(44 + frames * 4);
      expect(buf.readUInt32LE(4)).toBe(buf.length - 8);
      expect(buf.readUInt32LE(40)).toBe(frames * 4);
      const expectedPcm = Buffer.alloc(frames * 4);
      for (let i = 0; i < frames; i++) {
        const phase = (2 * Math.PI * SIGNAL.freqHz * i) / SIGNAL.sampleRateHz;
        for (const [channel, peak] of [SIGNAL.peakLDb, SIGNAL.peakRDb].entries()) {
          const expected = Math.round(Math.sin(phase) * 10 ** (peak / 20) * 32767);
          expectedPcm.writeInt16LE(expected, i * 4 + channel * 2);
        }
      }
      expect(buf.subarray(44).equals(expectedPcm)).toBe(true);
    } finally {
      await rm(path, { force: true });
    }
  });

  it.each([0, -1, NaN, Infinity, 24000])(
    "rejects invalid or oversized duration %s",
    async (seconds) => {
      await expect(synthesizeSignal("unused.wav", { seconds })).rejects.toThrow(/duration/);
    }
  );

  it("writes a WAV whose header matches the declared format", async () => {
    const path = join(tmpdir(), `plvs-rig-test-${Date.now()}.wav`);
    try {
      await synthesizeSignal(path);
      const buf = readFileSync(path);
      expect(buf.toString("ascii", 0, 4)).toBe("RIFF");
      expect(buf.toString("ascii", 8, 12)).toBe("WAVE");
      expect(buf.readUInt16LE(22)).toBe(2); // channels
      expect(buf.readUInt32LE(24)).toBe(SIGNAL.sampleRateHz);
      expect(buf.readUInt16LE(34)).toBe(16); // bits per sample
      const frames = SIGNAL.sampleRateHz * SIGNAL.seconds;
      expect(buf.readUInt32LE(40)).toBe(frames * 4); // data chunk size
      expect(buf.length).toBe(44 + frames * 4);
    } finally {
      await rm(path, { force: true });
    }
  });

  it("puts a higher peak in L than in R, which is what makes a channel swap visible", async () => {
    // Equal-weight channels integrate identically under BS.1770, so only an
    // asymmetric signal can expose an L/R swap.
    const path = join(tmpdir(), `plvs-rig-asym-${Date.now()}.wav`);
    try {
      await synthesizeSignal(path);
      const buf = readFileSync(path);
      let peakL = 0;
      let peakR = 0;
      const frames = SIGNAL.sampleRateHz * SIGNAL.seconds;
      for (let i = 0; i < frames; i++) {
        peakL = Math.max(peakL, Math.abs(buf.readInt16LE(44 + i * 4)));
        peakR = Math.max(peakR, Math.abs(buf.readInt16LE(44 + i * 4 + 2)));
      }
      const dbL = 20 * Math.log10(peakL / 32767);
      const dbR = 20 * Math.log10(peakR / 32767);
      expect(dbL).toBeCloseTo(SIGNAL.peakLDb, 1);
      expect(dbR).toBeCloseTo(SIGNAL.peakRDb, 1);
      expect(dbL).toBeGreaterThan(dbR + 3);
    } finally {
      await rm(path, { force: true });
    }
  });
});

describe("compareMetrics", () => {
  const truth = {
    integratedLufs: -22.03,
    samplePeakMaxLDb: -20.0,
    samplePeakMaxRDb: -26.0,
  };

  it("accepts values inside tolerance", () => {
    const result = compareMetrics(truth, {
      integratedLufs: -22.4,
      samplePeakMaxLDb: -20.1,
      samplePeakMaxRDb: -25.9,
    });
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("rejects a value outside tolerance and names the field", () => {
    const result = compareMetrics(truth, {
      integratedLufs: -22.03,
      samplePeakMaxLDb: -20.0,
      samplePeakMaxRDb: -20.0,
    });
    expect(result.ok).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].field).toBe("samplePeakMaxRDb");
  });

  it("catches a swapped channel map", () => {
    // The exact defect this whole check exists for: integrated is unchanged,
    // only the per-channel peaks move.
    const result = compareMetrics(truth, {
      integratedLufs: -22.03,
      samplePeakMaxLDb: -26.0,
      samplePeakMaxRDb: -20.0,
    });
    expect(result.ok).toBe(false);
    expect(result.failures.map((f) => f.field).sort()).toEqual([
      "samplePeakMaxLDb",
      "samplePeakMaxRDb",
    ]);
  });

  it("fails when ground truth is missing a field instead of passing silently", () => {
    // `Math.abs(got - undefined)` is NaN and `NaN > tolerance` is false, so an
    // unguarded expected value would pass unconditionally and forever. If analyze
    // ever renames a field, this check must go red rather than green.
    const result = compareMetrics(
      {},
      {
        integratedLufs: -22.03,
        samplePeakMaxLDb: -20.0,
        samplePeakMaxRDb: -26.0,
      }
    );
    expect(result.ok).toBe(false);
    expect(result.failures).toHaveLength(3);
    expect(result.failures[0].reason).toBe("no ground truth for this field");
  });

  it("treats a null metric as a failure rather than passing it", () => {
    // Silence reports null. A comparison that skipped nulls would call a dead
    // capture path green.
    const result = compareMetrics(truth, {
      integratedLufs: null,
      samplePeakMaxLDb: null,
      samplePeakMaxRDb: null,
    });
    expect(result.ok).toBe(false);
    expect(result.failures).toHaveLength(3);
  });
});

describe("capture harness invocation", () => {
  it("routes internal commands through the feature-gated host entry", () => {
    expect(harnessArgs(["capture", "--json"])).toEqual(["--harness", "capture", "--json"]);
  });

  it("accepts a harness-enabled build", () => {
    expect(captureRig.verifyHarnessBuild).toBeTypeOf("function");
    const run = vi.fn(() => ({ status: 0, stdout: "help", stderr: "" }));

    expect(() => captureRig.verifyHarnessBuild("plvs.exe", run)).not.toThrow();
    expect(run).toHaveBeenCalledWith("plvs.exe", ["--harness", "capture", "--help"]);
  });

  it("rejects a production build without the harness feature", () => {
    expect(captureRig.verifyHarnessBuild).toBeTypeOf("function");
    const run = vi.fn(() => ({
      status: 2,
      stdout: "",
      stderr: "The capture harness is not available in this build.",
    }));

    expect(() => captureRig.verifyHarnessBuild("plvs.exe", run)).toThrow(
      /--features capture-harness/
    );
  });

  it("builds into its own profile so it never replaces target/release/plvs.exe", () => {
    // target/release/plvs.exe is the dev-identity GUI from `desktop:dev-optimized`. A harness build
    // without dev-identity landing there silently turns it into a GUI on the stable identity's settings.
    expect(captureRig.BUILD_HARNESS).toContain("--profile harness");
    expect(captureRig.BUILD_HARNESS).not.toContain("--release");
    expect(captureRig.harnessPath("root", "win32")).toBe(
      join("root", "src-tauri", "target", "harness", "plvs.exe")
    );
    expect(captureRig.harnessPath("root", "darwin")).toBe(
      join("root", "src-tauri", "target", "harness", "plvs")
    );
    expect(captureRig.harnessPath("root", "linux")).toBe(
      join("root", "src-tauri", "target", "harness", "plvs")
    );
  });

  it("declares the harness profile in the workspace root manifest", () => {
    const manifest = readFileSync(new URL("../src-tauri/Cargo.toml", import.meta.url), "utf8");
    expect(manifest).toMatch(/^\[profile\.harness\]\r?\ninherits = "release"$/m);
  });
});

describe("cross-platform capture route", () => {
  const macDeviceReport = {
    status: "ok",
    devices: [
      {
        id: "lb-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        label: "BlackHole 2ch",
        kind: "systemOutput",
        sampleRateHz: 48000,
        channelCount: 2,
      },
      {
        id: "cap-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        label: "BlackHole 2ch",
        kind: "input",
        sampleRateHz: 48000,
        channelCount: 2,
      },
    ],
  };

  it("selects the BlackHole output-monitor row rather than the same-named input", () => {
    expect(captureRig.selectMacCaptureDevice(macDeviceReport).id).toBe(
      "lb-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    );
  });

  it("rejects an unexpected BlackHole capture format as a rig error", () => {
    const wrong = structuredClone(macDeviceReport);
    wrong.devices[0].channelCount = 4;
    expect(() => captureRig.selectMacCaptureDevice(wrong)).toThrow(/expected 48000 Hz, 2 ch/);
  });

  it("validates the Core Audio render target", () => {
    expect(
      captureRig.selectMacRenderDevice({
        devices: [
          {
            audioObjectId: 121,
            name: "BlackHole 2ch",
            outputChannelCount: 2,
            nominalSampleRateHz: 48000,
          },
        ],
      }).audioObjectId
    ).toBe(121);
  });

  it("builds the proven VLC arguments for both adapters", () => {
    expect(captureRig.playerArgs("endpoint", "signal.wav", "win32")).toContain(
      "--mmdevice-audio-device=endpoint"
    );
    expect(captureRig.playerArgs("121", "signal.wav", "darwin")).toContain(
      "--auhal-audio-device=121"
    );
    expect(captureRig.linuxPlayerArgs("plvs_rig", "signal.wav")).toEqual([
      "paplay",
      "--device=plvs_rig",
      "signal.wav",
    ]);
  });

  it.each(["win32", "darwin"])("plays a continuous soak file once on %s", (platform) => {
    const args = captureRig.playerArgs("target", "signal.wav", platform, { loop: false });
    expect(args).toEqual(expect.arrayContaining(["--no-loop", "--no-repeat", "--play-and-exit"]));
    expect(args).not.toContain("--loop");
    expect(args.at(-1)).toBe("signal.wav");
    expect(captureRig.playerArgs("target", "signal.wav", platform)).toContain("--loop");
  });

  it("normalizes a macOS route from harness and Core Audio discovery", () => {
    const run = vi.fn(() => ({
      status: 0,
      stdout: `${JSON.stringify(macDeviceReport)}\n`,
      stderr: "",
    }));
    const route = captureRig.resolveCaptureRoute("plvs", {
      platform: "darwin",
      run,
      macRenderResolver: () => ({ audioObjectId: 121 }),
    });
    expect(route).toEqual({
      platform: "darwin",
      label: "BlackHole 2ch",
      captureDevice: "lb-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      playerTarget: "121",
    });
    expect(run).toHaveBeenCalledWith("plvs", ["--harness", "devices", "--json"]);
  });

  it("creates a private PulseAudio null sink and can remove it", () => {
    const calls = [];
    const run = vi.fn((command, args) => {
      calls.push([command, args]);
      if (args[0] === "info") return { status: 0, stdout: "Server Name: PulseAudio\n", stderr: "" };
      if (args[0] === "load-module") return { status: 0, stdout: "42\n", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    });
    const route = captureRig.resolveCaptureRoute("plvs", {
      platform: "linux",
      linuxPulseRunner: run,
      linuxSinkName: "plvs_rig_test",
    });
    expect(route).toMatchObject({
      platform: "linux",
      label: "PulseAudio null sink",
      captureDevice: "plvs_rig_test.monitor",
      playerTarget: "plvs_rig_test",
    });
    route.release();
    route.release();
    expect(calls.at(-1)).toEqual(["pactl", ["unload-module", "42"]]);
    expect(calls.filter((call) => call[1][0] === "unload-module")).toHaveLength(1);
  });

  it("reports a missing PulseAudio server as a rig error", () => {
    expect(() =>
      captureRig.resolveCaptureRoute("plvs", {
        platform: "linux",
        linuxPulseRunner: () => ({ status: 1, stdout: "", stderr: "Connection refused" }),
      })
    ).toThrow(/PulseAudio is not available/);
  });

  it("preserves the existing Windows route contract", () => {
    const endpointResolver = vi.fn(() => "{0.0.0.00000000}.{guid}");
    expect(
      captureRig.resolveCaptureRoute("plvs.exe", {
        platform: "win32",
        endpointResolver,
      })
    ).toEqual({
      platform: "win32",
      label: "VB-Cable",
      captureDevice: "CABLE Output",
      playerTarget: "{0.0.0.00000000}.{guid}",
    });
  });
});

describe("soak capture completion", () => {
  it("accepts a successful final report", () => {
    expect(captureRig.assertSoakCaptureCompleted).toBeTypeOf("function");
    expect(() => captureRig.assertSoakCaptureCompleted(0, { status: "ok" })).not.toThrow();
  });

  it("rejects a nonzero child exit", () => {
    expect(captureRig.assertSoakCaptureCompleted).toBeTypeOf("function");
    expect(() => captureRig.assertSoakCaptureCompleted(1, null)).toThrow(/exit code 1/);
  });

  it("rejects a missing final report", () => {
    expect(captureRig.assertSoakCaptureCompleted).toBeTypeOf("function");
    expect(() => captureRig.assertSoakCaptureCompleted(0, null)).toThrow(/without a final report/);
  });

  it("rejects an error final report", () => {
    expect(captureRig.assertSoakCaptureCompleted).toBeTypeOf("function");
    expect(() =>
      captureRig.assertSoakCaptureCompleted(0, {
        status: "error",
        error: { message: "device lost" },
      })
    ).toThrow(/device lost/);
  });
});

describe("staleHarnessSources", () => {
  // A built binary carries no record of what went into it, so the rig compares
  // mtimes. These fixtures set them explicitly: writing files in sequence gives
  // timestamps too close together to order reliably.
  const BUILT_AT = 1_700_000_000_000;

  async function fixture(files) {
    const root = join(tmpdir(), `plvs-stale-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    for (const [rel, mtimeMs] of Object.entries(files)) {
      const abs = join(root, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, "x");
      const seconds = mtimeMs / 1000;
      utimesSync(abs, seconds, seconds);
    }
    return root;
  }

  it("reports nothing when every source predates the binary", async () => {
    const root = await fixture({
      "src-tauri/src/lib.rs": BUILT_AT - 60_000,
      "src-tauri/Cargo.toml": BUILT_AT - 60_000,
    });
    try {
      expect(staleHarnessSources(BUILT_AT, root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("names a nested source that changed after the binary was built", async () => {
    const root = await fixture({
      "src-tauri/src/lib.rs": BUILT_AT - 60_000,
      "src-tauri/src/dsp/spectrum.rs": BUILT_AT + 60_000,
    });
    try {
      expect(staleHarnessSources(BUILT_AT, root)).toEqual(["src-tauri/src/dsp/spectrum.rs"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("ignores target/, which holds the binary rather than an input to it", async () => {
    // Every build writes here, so counting it would make the rig permanently stale
    // against itself.
    const root = await fixture({
      "src-tauri/src/lib.rs": BUILT_AT - 60_000,
      "src-tauri/target/harness/plvs.exe": BUILT_AT + 60_000,
    });
    try {
      expect(staleHarnessSources(BUILT_AT, root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("catches a Cargo.lock bump, which changes the binary without touching src", async () => {
    const root = await fixture({
      "src-tauri/src/lib.rs": BUILT_AT - 60_000,
      "src-tauri/Cargo.lock": BUILT_AT + 60_000,
    });
    try {
      expect(staleHarnessSources(BUILT_AT, root)).toEqual(["src-tauri/Cargo.lock"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("judgeSoak", () => {
  const steady = {
    integratedLufs: -22.03,
    lra: 0,
    mMaxLufs: -22.03,
    stMaxLufs: -22.03,
    truePeakMaxDbtp: -20,
  };
  const run = (seconds, at = () => ({})) =>
    Array.from({ length: seconds / 10 }, (_, i) => {
      const t = (i + 1) * 10;
      return { t, ...steady, droppedChunks: 0, ...at(t) };
    });

  it("passes readings that hold still over the constant signal", () => {
    const { failures, spreads } = captureRig.judgeSoak(run(600));
    expect(failures).toEqual([]);
    expect(Object.keys(spreads)).toEqual([
      "integratedLufs",
      "lra",
      "mMaxLufs",
      "stMaxLufs",
      "truePeakMaxDbtp",
    ]);
  });

  it("names a metric that drifts after warmup", () => {
    const { failures } = captureRig.judgeSoak(
      run(600, (t) => ({ integratedLufs: -22.03 - t * 1e-4 }))
    );
    expect(failures.join("\n")).toMatch(/integratedLufs drifted/);
  });

  it("lets a maximum settle through the first loop seam but not after it", () => {
    const seam = captureRig.SOAK_MAX_WARMUP_SECONDS;
    const settles = captureRig.judgeSoak(
      run(600, (t) => (t >= seam - 10 ? { truePeakMaxDbtp: -19.9 } : {}))
    );
    expect(settles.failures).toEqual([]);
    const late = captureRig.judgeSoak(
      run(600, (t) => (t >= seam + 60 ? { truePeakMaxDbtp: -19.9 } : {}))
    );
    expect(late.failures.join("\n")).toMatch(/truePeakMaxDbtp drifted/);
  });

  it("catches a contaminant during warmup, which a maximum keeps for the rest of the run", () => {
    // Something doubled the signal for the first 40 s: Integrated recovers toward the tone, the
    // maxima do not, and neither one moves after its warmup.
    const { failures } = captureRig.judgeSoak(
      run(600, () => ({ mMaxLufs: -16.01, stMaxLufs: -16.01 }))
    );
    expect(failures.join("\n")).toMatch(/mMaxLufs sits 6\.0200 dB from integratedLufs/);
  });

  it("fails a null reading rather than skipping it", () => {
    const { failures } = captureRig.judgeSoak(run(600, (t) => (t === 300 ? { lra: null } : {})));
    expect(failures.join("\n")).toMatch(/lra is not a finite number at t=300s/);
  });

  it("fails a run too short to judge", () => {
    const { failures } = captureRig.judgeSoak(run(50));
    expect(failures.join("\n")).toMatch(/fewer than two readings/);
  });
});
