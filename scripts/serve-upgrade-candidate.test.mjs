import { describe, expect, it } from "vitest";
import { parseFaultMode, resolveCandidateRequest } from "./serve-upgrade-candidate.mjs";

describe("private upgrade candidate server", () => {
  it("maps the baked public endpoint and flat assets into the candidate root", () => {
    const root = process.platform === "win32" ? "C:\\candidate" : "/candidate";
    expect(
      resolveCandidateRequest(root, "/SounDoer/PLVS/releases/latest/download/latest.json")
    ).toBe(resolveCandidateRequest(root, "/latest.json"));
    expect(resolveCandidateRequest(root, "/PLVS.app.tar.gz")).toMatch(/PLVS\.app\.tar\.gz$/);
  });

  it("rejects traversal and validates fault modes", () => {
    expect(resolveCandidateRequest("C:\\candidate", "/../secret")).toBeNull();
    expect(resolveCandidateRequest("C:\\candidate", "/nested/installer.exe")).toBeNull();
    expect(parseFaultMode("drop:0.5")).toEqual({ kind: "drop", fraction: 0.5 });
    expect(parseFaultMode("http-503")).toEqual({ kind: "http-503" });
    expect(() => parseFaultMode("drop:50")).toThrow(/Invalid asset fault mode/);
  });
});
