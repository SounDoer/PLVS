import { describe, expect, it } from "vitest";

import {
  parseArgs,
  parseSampleStream,
  pickGpuProcesses,
  summarizeSamples,
} from "./webview-gpu-usage.mjs";

describe("parseArgs", () => {
  it("defaults to a ten second sample of the app's own GPU process", () => {
    expect(parseArgs([])).toEqual({ seconds: 10, app: "plvs.exe", label: "", pids: [] });
  });

  it("accepts both spellings of a flag", () => {
    expect(parseArgs(["--seconds=5", "--label", "3D Lines"])).toMatchObject({
      seconds: 5,
      label: "3D Lines",
    });
  });

  it("collects repeated --pid overrides", () => {
    expect(parseArgs(["--pid", "10", "--pid", "20"]).pids).toEqual([10, 20]);
  });

  it("rejects a sample window that would produce no samples", () => {
    expect(() => parseArgs(["--seconds", "0"])).toThrow(/--seconds/);
  });

  it("rejects an unknown flag rather than sampling something unintended", () => {
    expect(() => parseArgs(["--procss", "1"])).toThrow(/unknown argument/);
  });
});

describe("pickGpuProcesses", () => {
  const processes = [
    { ProcessId: 1, ParentProcessId: 0, Name: "plvs.exe", CommandLine: "plvs.exe" },
    {
      ProcessId: 2,
      ParentProcessId: 1,
      Name: "msedgewebview2.exe",
      CommandLine: "msedgewebview2.exe --embedded-browser-webview=1",
    },
    {
      ProcessId: 3,
      ParentProcessId: 2,
      Name: "msedgewebview2.exe",
      CommandLine: "msedgewebview2.exe --type=gpu-process",
    },
    {
      ProcessId: 4,
      ParentProcessId: 2,
      Name: "msedgewebview2.exe",
      CommandLine: "msedgewebview2.exe --type=renderer",
    },
  ];

  it("finds the GPU process through the browser process to the app", () => {
    expect(pickGpuProcesses(processes, "plvs.exe")).toEqual([{ pid: 3, parentPid: 2 }]);
  });

  it("ignores a GPU process belonging to another WebView2 app", () => {
    const foreign = [
      { ProcessId: 10, ParentProcessId: 0, Name: "otherapp.exe", CommandLine: "otherapp.exe" },
      {
        ProcessId: 11,
        ParentProcessId: 10,
        Name: "msedgewebview2.exe",
        CommandLine: "msedgewebview2.exe",
      },
      {
        ProcessId: 12,
        ParentProcessId: 11,
        Name: "msedgewebview2.exe",
        CommandLine: "msedgewebview2.exe --type=gpu-process",
      },
    ];
    expect(pickGpuProcesses([...processes, ...foreign], "plvs.exe")).toEqual([
      { pid: 3, parentPid: 2 },
    ]);
  });

  it("reports both GPU processes when two instances of the app are running", () => {
    const second = [
      { ProcessId: 20, ParentProcessId: 0, Name: "plvs.exe", CommandLine: "plvs.exe" },
      {
        ProcessId: 21,
        ParentProcessId: 20,
        Name: "msedgewebview2.exe",
        CommandLine: "msedgewebview2.exe",
      },
      {
        ProcessId: 22,
        ParentProcessId: 21,
        Name: "msedgewebview2.exe",
        CommandLine: "msedgewebview2.exe --type=gpu-process",
      },
    ];
    expect(pickGpuProcesses([...processes, ...second], "plvs.exe")).toEqual([
      { pid: 3, parentPid: 2 },
      { pid: 22, parentPid: 21 },
    ]);
  });

  it("survives a parent pid that has already been reused or is gone", () => {
    const orphan = [
      {
        ProcessId: 30,
        ParentProcessId: 30,
        Name: "msedgewebview2.exe",
        CommandLine: "msedgewebview2.exe --type=gpu-process",
      },
    ];
    expect(pickGpuProcesses(orphan, "plvs.exe")).toEqual([]);
  });
});

describe("summarizeSamples", () => {
  it("sums engines of one type within a sample before averaging across samples", () => {
    const summary = summarizeSamples([
      { pid_1_luid_0_phys_0_eng_0_engtype_copy: 20, pid_1_luid_0_phys_0_eng_1_engtype_copy: 20 },
      { pid_1_luid_0_phys_0_eng_0_engtype_copy: 20, pid_1_luid_0_phys_0_eng_1_engtype_copy: 20 },
    ]);
    expect(summary.rows).toEqual([{ engine: "copy", mean: 40, max: 40 }]);
  });

  it("averages an engine over the whole run, not over the samples it appeared in", () => {
    const summary = summarizeSamples([{ pid_1_luid_0_phys_0_eng_0_engtype_3d: 40 }, {}, {}, {}]);
    expect(summary.rows).toEqual([{ engine: "3d", mean: 10, max: 40 }]);
  });

  it("ranks engines by mean and totals them per sample", () => {
    const summary = summarizeSamples([
      { pid_1_luid_0_phys_0_eng_0_engtype_copy: 2, pid_1_luid_0_phys_0_eng_1_engtype_3d: 8 },
      { pid_1_luid_0_phys_0_eng_0_engtype_copy: 4, pid_1_luid_0_phys_0_eng_1_engtype_3d: 6 },
    ]);
    expect(summary.rows.map((row) => row.engine)).toEqual(["3d", "copy"]);
    expect(summary.totalMean).toBe(10);
    expect(summary.totalMax).toBe(10);
  });

  it("reports an idle run as no engines rather than as an error", () => {
    expect(summarizeSamples([{}, {}])).toEqual({
      sampleCount: 2,
      rows: [],
      totalMean: 0,
      totalMax: 0,
    });
  });
});

describe("parseSampleStream", () => {
  it("reads one sample per JSON line and ignores PowerShell's chatter", () => {
    const stdout = [
      "WARNING: something",
      '{"engines":{"pid_1_luid_0_phys_0_eng_0_engtype_3d":12.5}}',
      "",
      '{"engines":{}}',
    ].join("\r\n");
    expect(parseSampleStream(stdout)).toEqual([{ pid_1_luid_0_phys_0_eng_0_engtype_3d: 12.5 }, {}]);
  });

  it("separates a run that produced nothing from a run of empty samples", () => {
    // The caller turns these into different outcomes: no samples at all is a broken query, while
    // empty samples are a real reading of a window that painted nothing.
    expect(parseSampleStream("Get-Counter : the data in one of the samples is not valid")).toEqual(
      []
    );
    expect(parseSampleStream('{"engines":{}}')).toEqual([{}]);
  });
});
