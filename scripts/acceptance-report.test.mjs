import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { parseAcceptanceReportArgs } from "./acceptance-report.mjs";

describe("acceptance report arguments", () => {
  it("accepts repeatable explicit evidence and resolves HEAD", () => {
    const parsed = parseAcceptanceReportArgs([
      "--evidence",
      "one.json",
      "--evidence",
      "two.json",
      "--out-dir",
      "artifacts/custom-report",
    ]);
    expect(parsed.evidence).toEqual([resolve("one.json"), resolve("two.json")]);
    expect(parsed.targetSha).toMatch(/^[0-9a-f]{40}$/);
    expect(parsed.outDir).toBe(resolve("artifacts/custom-report"));
  });

  it("rejects unknown, incomplete and unresolvable arguments", () => {
    expect(() => parseAcceptanceReportArgs(["--latest"])).toThrow(/Usage/);
    expect(() => parseAcceptanceReportArgs(["--evidence"])).toThrow(/requires a value/);
    expect(() => parseAcceptanceReportArgs(["--target", "not-a-real-ref"])).toThrow(
      /Could not resolve git commit/
    );
  });
});
