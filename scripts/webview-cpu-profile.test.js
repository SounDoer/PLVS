import { describe, expect, it } from "vitest";
import { parseArgs, pickTarget, summariseProfile } from "./webview-cpu-profile.mjs";
import { makeSourceMapper } from "./sourcemap-lookup.mjs";

describe("parseArgs", () => {
  it("defaults to a ten second recording on the WebView2 port", () => {
    expect(parseArgs([])).toMatchObject({ port: 9222, seconds: 10, out: "webview.cpuprofile" });
  });

  it("accepts both spaced and inline forms", () => {
    expect(parseArgs(["--seconds", "30", "--out=run.cpuprofile"])).toMatchObject({
      seconds: 30,
      out: "run.cpuprofile",
    });
  });

  it("rejects an argument it cannot act on rather than recording the wrong thing", () => {
    expect(() => parseArgs(["--secons", "30"])).toThrow(/unknown argument/);
    expect(() => parseArgs(["--seconds", "0"])).toThrow(/positive/);
    expect(() => parseArgs(["--port", "nope"])).toThrow(/port/);
  });
});

describe("pickTarget", () => {
  const page = (url) => ({ type: "page", url, webSocketDebuggerUrl: `ws://${url}` });

  it("prefers the app's own page over the webview's helpers", () => {
    const app = page("http://tauri.localhost/index.html");
    expect(pickTarget([page("about:blank"), app])).toBe(app);
  });

  it("picks the main window over the Dock's accessory surfaces", () => {
    // The order a real session reports: both Dock surfaces come before the main window, and they
    // draw almost nothing, so taking the first page profiles the wrong window.
    const main = page("http://tauri.localhost/");
    const targets = [
      page("http://tauri.localhost/index.html?surface=dock-editor"),
      page("http://tauri.localhost/index.html?surface=dock-header"),
      main,
    ];
    expect(pickTarget(targets)).toBe(main);
  });

  it("returns null when there is no page to attach to", () => {
    expect(pickTarget([{ type: "service_worker", url: "x", webSocketDebuggerUrl: "ws://x" }])).toBe(
      null
    );
    // A page with no socket cannot be driven, so it does not count as one.
    expect(pickTarget([{ type: "page", url: "http://app" }])).toBe(null);
  });
});

describe("summariseProfile", () => {
  // Two functions, sampled 3:1, over a 400 ms window.
  const profile = {
    startTime: 1_000_000,
    endTime: 1_400_000,
    nodes: [
      { id: 1, callFrame: { functionName: "buildPaths", url: "app/a.js", lineNumber: 41 } },
      { id: 2, callFrame: { functionName: "", url: "", lineNumber: -1 } },
    ],
    samples: [1, 1, 1, 2],
  };

  it("ranks by self time and converts ticks to milliseconds", () => {
    const { rows, spanMs } = summariseProfile(profile);
    expect(spanMs).toBe(400);
    expect(rows[0].label).toBe("buildPaths  a.js:42");
    expect(rows[0].ms).toBeCloseTo(300, 6);
    expect(rows[0].share).toBeCloseTo(75, 6);
    expect(rows[1].label).toBe("(anonymous)");
  });

  it("honours the row limit", () => {
    expect(summariseProfile(profile, 1).rows).toHaveLength(1);
  });

  it("survives a profile with no samples, which is what an idle window produces", () => {
    const idle = { ...profile, samples: [] };
    expect(summariseProfile(idle).rows).toEqual([]);
    expect(summariseProfile(idle).totalTicks).toBe(0);
  });
});

describe("summariseProfile with source maps", () => {
  const profile = {
    startTime: 0,
    endTime: 200_000,
    nodes: [
      {
        id: 1,
        callFrame: {
          functionName: "qN",
          url: "http://tauri.localhost/assets/index-abc.js",
          lineNumber: 0,
          columnNumber: 0,
        },
      },
      {
        id: 2,
        callFrame: {
          functionName: "zz",
          url: "http://tauri.localhost/assets/other.js",
          lineNumber: 3,
          columnNumber: 0,
        },
      },
    ],
    samples: [1, 2],
  };
  const mappers = new Map([
    [
      "http://tauri.localhost/assets/index-abc.js",
      makeSourceMapper({
        sources: ["../src/hooks/usePaint.js"],
        names: ["paintEverything"],
        mappings: "AAAAA",
      }),
    ],
  ]);

  it("names a minified frame from the map and drops the bundler's leading ../", () => {
    const { rows } = summariseProfile(profile, 25, mappers);
    const mapped = rows.find((row) => row.label.startsWith("paintEverything"));
    expect(mapped.label).toBe("paintEverything  src/hooks/usePaint.js:1");
  });

  it("leaves a frame from an unmapped bundle under its minified name", () => {
    const { rows } = summariseProfile(profile, 25, mappers);
    expect(rows.some((row) => row.label === "zz  other.js:4")).toBe(true);
  });
});
