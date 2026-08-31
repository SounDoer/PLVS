import { describe, expect, it } from "vitest";

import { formatReport, parseArgs } from "./webview-dom-count.mjs";

describe("parseArgs", () => {
  it("defaults to the debugging port the profiler documents", () => {
    expect(parseArgs([])).toMatchObject({ port: 9222, seconds: 5, top: 6 });
  });

  it("accepts both spellings of a flag", () => {
    expect(parseArgs(["--seconds", "12"]).seconds).toBe(12);
    expect(parseArgs(["--seconds=12"]).seconds).toBe(12);
  });

  it("refuses input that would silently count nothing", () => {
    expect(() => parseArgs(["--seconds", "0"])).toThrow(/--seconds/);
    expect(() => parseArgs(["--port", "-1"])).toThrow(/--port/);
    expect(() => parseArgs(["--nope"])).toThrow(/unknown flag/);
  });
});

describe("formatReport", () => {
  const reading = {
    elapsedSec: 4,
    rows: [
      {
        label: "Level Meter @ 0.1",
        attributes: 400,
        childList: 40,
        characterData: 20,
        total: 460,
        attributeNames: [
          ["style", 320],
          ["class", 80],
        ],
        attributeSites: [
          ["g[style]", 320],
          ["div[data-level-meter-fill-value][class]", 80],
        ],
        childSites: [["div[data-axis-ticks]", 40]],
      },
      {
        label: "Stats @ 0.2",
        attributes: 8,
        childList: 0,
        characterData: 4,
        total: 12,
        attributeNames: [],
        attributeSites: [],
        childSites: [],
      },
    ],
  };

  it("reports per-second rates rather than raw totals", () => {
    const text = formatReport(reading).join("\n");
    expect(text).toContain("Level Meter @ 0.1");
    expect(text).toContain("115.0 mutations/s");
    expect(text).toContain("attributes 100.0");
    expect(text).toContain("style 80.0/s");
    expect(text).toContain("attribute targets: g[style] 80.0/s");
    // Node churn says nothing without the element it happened under.
    expect(text).toContain("nodes churned under: div[data-axis-ticks] 10.0/s");
  });

  it("says a still window looks like a quiet one, instead of reading as a result", () => {
    const text = formatReport({ elapsedSec: 5, rows: [] }).join("\n");
    expect(text).toMatch(/still window looks exactly like this one/);
  });

  it("keeps the listing bounded and says how much it left out", () => {
    const text = formatReport(reading, 1).join("\n");
    expect(text).toContain("Level Meter @ 0.1");
    expect(text).not.toContain("Stats @ 0.2");
    expect(text).toContain("1 quieter rows");
  });
});
