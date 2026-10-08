import { execFileSync } from "node:child_process";
import process from "node:process";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ROOT, loadRecipe } from "./hero-lib.mjs";

const base = join(ROOT, "artifacts/marketing");
await mkdir(base, { recursive: true });
const run = await mkdtemp(join(base, "selection-test-"));
const recipe = await loadRecipe();
afterAll(async () => {
  await rm(run, { recursive: true, force: true });
});
function select(...args) {
  try {
    execFileSync(process.execPath, [join(ROOT, "scripts/marketing/select-hero.mjs"), ...args], {
      windowsHide: true,
      stdio: "pipe",
    });
    return "unexpected success";
  } catch (error) {
    return error.stderr.toString();
  }
}
describe("hero selection boundary", () => {
  it("requires explicit visual review", () => {
    expect(select(run, "candidate.png")).toContain("Usage:");
  });
  it("refuses failed runs even when a candidate is marked eligible", async () => {
    await writeFile(
      join(run, "capture-report.json"),
      JSON.stringify({
        recipe,
        status: "failed",
        captures: [{ file: "candidate.png", eligible: true }],
      })
    );
    expect(select(run, "candidate.png", "--reviewed")).toContain("Run is incomplete");
  });
  it("refuses an image changed after capture", async () => {
    await writeFile(
      join(run, "capture-report.json"),
      JSON.stringify({
        recipe,
        status: "reviewRequired",
        captures: [{ file: "candidate.png", eligible: true, issues: [], sha256: "0".repeat(64) }],
      })
    );
    await writeFile(join(run, "candidate.png"), "changed");
    expect(select(run, "candidate.png", "--reviewed")).toContain("Candidate image changed");
  });
});
