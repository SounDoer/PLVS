import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkContentReview,
  contentSnapshot,
  REVIEW_AREAS,
  REVIEW_PATH,
} from "./release-content-review.mjs";

let cwd;
const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
const write = (path, text) => writeFileSync(join(cwd, path), text);
const commit = () => {
  git("add", ".");
  git("commit", "-qm", "fixture");
};
function review() {
  const record = {
    schemaVersion: 1,
    ...contentSnapshot(cwd),
    reviews: Object.fromEntries(
      REVIEW_AREAS.map((area) => [
        area,
        {
          status: "unchanged",
          rationale: "The change does not affect this surface.",
          evidence: ["Compared the complete baseline diff and the existing public content."],
        },
      ])
    ),
  };
  write(REVIEW_PATH, JSON.stringify(record));
  return record;
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "plvs-content-review-"));
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  mkdirSync(join(cwd, "docs"));
  write("package.json", JSON.stringify({ version: "1.0.0" }));
  write("panel.js", "old UI");
  commit();
  git("tag", "v1.0.0");
  write("package.json", JSON.stringify({ version: "1.0.1" }));
  commit();
});
afterEach(() => rmSync(cwd, { recursive: true, force: true }));

describe("release content review", () => {
  it("requires a review but allows committing the review without a circular fingerprint", () => {
    expect(() => checkContentReview(cwd)).toThrow();
    const record = review();
    expect(checkContentReview(cwd).contentSha256).toBe(record.contentSha256);
    commit();
    expect(checkContentReview(cwd).candidateRevision).not.toBe(record.candidateRevision);
  });

  it.each(REVIEW_AREAS)(
    "rejects missing, pending or unsupported %s decisions and empty evidence",
    (area) => {
      const record = review();
      for (const decision of [
        undefined,
        { status: "pending" },
        { status: "approved" },
        { status: "unchanged", rationale: "", evidence: ["comparison"] },
        { status: "updated", rationale: "Retaken", evidence: [] },
      ]) {
        record.reviews[area] = decision;
        write(REVIEW_PATH, JSON.stringify(record));
        expect(() => checkContentReview(cwd)).toThrow();
      }
    }
  );

  it("invalidates review after implementation changes even when public assets stay unchanged", () => {
    review();
    commit();
    write("panel.js", "new UI");
    expect(() => checkContentReview(cwd)).toThrow(/Commit candidate/);
    commit();
    expect(() => checkContentReview(cwd)).toThrow(/stale/);
  });

  it("invalidates review after adding or deleting files", () => {
    review();
    commit();
    write("new-image.png", "fixture");
    expect(() => contentSnapshot(cwd)).toThrow(/Commit candidate/);
    commit();
    expect(() => checkContentReview(cwd)).toThrow(/stale/);
    review();
    commit();
    git("rm", "panel.js");
    commit();
    expect(() => checkContentReview(cwd)).toThrow(/stale/);
  });

  it("ignores preview and prerelease tags but rejects a changed stable baseline", () => {
    git("tag", "preview-999");
    git("tag", "v9.0.0-beta.1");
    expect(contentSnapshot(cwd).baselineTag).toBe("v1.0.0");
    review();
    commit();
    git("tag", "v1.0.1");
    expect(() => checkContentReview(cwd)).toThrow(/baselineTag/);
  });

  it("rejects missing history and a candidate revision with different content", () => {
    const record = review();
    record.candidateRevision = record.baselineRevision;
    write(REVIEW_PATH, JSON.stringify(record));
    expect(() => checkContentReview(cwd)).toThrow(/differs/);
    git("tag", "-d", "v1.0.0");
    expect(() => contentSnapshot(cwd)).toThrow(/No stable release baseline/);
  });

  it("wires the release-only check into local and remote gates with complete history", () => {
    const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    expect(read("scripts/run-release-gate.mjs")).toContain(
      '"scripts/release-content-review.mjs", "check"'
    );
    const workflow = read(".github/workflows/release.yml");
    const validate = workflow.slice(
      workflow.indexOf("  validate:"),
      workflow.indexOf("  build-windows:")
    );
    expect(validate).toContain("fetch-depth: 0");
    expect(validate).toContain("node scripts/release-content-review.mjs check");
  });
});
