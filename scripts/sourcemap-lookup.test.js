import { describe, expect, it } from "vitest";
import { decodeMappings, decodeVlq, makeSourceMapper } from "./sourcemap-lookup.mjs";

describe("decodeVlq", () => {
  it("decodes the sign bit and continuation runs", () => {
    expect(decodeVlq("A")).toEqual([0]);
    expect(decodeVlq("C")).toEqual([1]);
    expect(decodeVlq("D")).toEqual([-1]);
    // Two fields in one segment: 0 then 1.
    expect(decodeVlq("AC")).toEqual([0, 1]);
    // A continued value: 32 needs two digits.
    expect(decodeVlq("gC")).toEqual([32]);
  });

  it("refuses input it cannot decode rather than inventing a position", () => {
    expect(() => decodeVlq("!")).toThrow(/base64/);
  });
});

describe("decodeMappings", () => {
  it("accumulates every field as a delta, across lines", () => {
    // Line 0: one segment at column 0 -> source 0, line 0, column 0.
    // Line 1: one segment at column 0 -> same source, line +1, column 0.
    const lines = decodeMappings("AAAA;AACA");
    expect(lines).toHaveLength(2);
    expect(lines[0][0]).toEqual([0, 0, 0, 0]);
    expect(lines[1][0]).toEqual([0, 0, 1, 0]);
  });

  it("keeps a generated-only segment, which maps to nothing", () => {
    expect(decodeMappings("A")[0][0]).toEqual([0]);
  });
});

describe("makeSourceMapper", () => {
  const map = {
    sources: ["src/a.js", "src/b.js"],
    names: ["paintSpan", "buildRuns"],
    // One generated line, two segments. Deltas, not absolutes: the second moves 10 generated
    // columns on, one source along, one source line down, five source columns in, one name on.
    mappings: "AAAAA,UCCKC",
  };

  it("takes the last segment starting at or before the column", () => {
    const lookup = makeSourceMapper(map);
    expect(lookup(0, 0)).toMatchObject({ source: "src/a.js", name: "paintSpan" });
    expect(lookup(0, 9)).toMatchObject({ source: "src/a.js", name: "paintSpan" });
    expect(lookup(0, 10)).toMatchObject({ source: "src/b.js", name: "buildRuns" });
    expect(lookup(0, 999)).toMatchObject({ source: "src/b.js" });
  });

  it("returns null for a line the map does not cover", () => {
    const lookup = makeSourceMapper(map);
    expect(lookup(7, 0)).toBeNull();
  });

  it("applies sourceRoot when the map carries one", () => {
    const lookup = makeSourceMapper({ ...map, sourceRoot: "../" });
    expect(lookup(0, 0).source).toBe("../src/a.js");
  });
});
