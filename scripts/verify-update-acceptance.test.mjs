import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { parseVerifyArguments, selectRunDirectory } from "./verify-update-acceptance.mjs";

describe("update acceptance verifier", () => {
  it("parses an optional explicit run", () => {
    expect(parseVerifyArguments(["artifacts/root", "--run", "run-1"]).runId).toBe("run-1");
  });

  it("selects the newest completed run", ({ onTestFinished }) => {
    const root = mkdtempSync(path.join(tmpdir(), "plvs-verify-fixture-"));
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    const older = path.join(root, "runs", "older");
    const newer = path.join(root, "runs", "newer");
    mkdirSync(older, { recursive: true });
    mkdirSync(newer, { recursive: true });
    writeFileSync(path.join(older, "result.json"), "{}\n");
    writeFileSync(path.join(newer, "result.json"), "{}\n");
    const now = new Date();
    const later = new Date(now.getTime() + 1_000);
    utimesSync(older, now, now);
    utimesSync(newer, later, later);
    expect(selectRunDirectory(root)).toBe(newer);
  });
});
