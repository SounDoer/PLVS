import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { forkApprovalProblem } from "./check-fork-pr-approval.mjs";

describe("fork pull request approval", () => {
  it("accepts only approval for every external contributor", () => {
    expect(forkApprovalProblem("all_external_contributors")).toBeNull();
    for (const weaker of ["first_time_contributors", "first_time_contributors_new_to_github"]) {
      expect(forkApprovalProblem(weaker)).toContain(weaker);
    }
    expect(forkApprovalProblem("")).toContain("could not be read");
  });

  it("is checked by the local release gate", () => {
    const gate = readFileSync(new URL("./run-release-gate.mjs", import.meta.url), "utf8");
    expect(gate).toContain(
      'run("Fork pull request approval", "node", ["scripts/check-fork-pr-approval.mjs"]);'
    );
  });
});
