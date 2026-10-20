import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "node:process";
import { describe, expect, it } from "vitest";
import { BUILD_HARNESS } from "./capture-rig.mjs";
import { selfHostedViolations } from "./self-hosted-workflow-guard.mjs";

const workflowDirectory = join(cwd(), ".github", "workflows");
const workflows = Object.fromEntries(
  readdirSync(workflowDirectory)
    .filter((name) => /\.ya?ml$/.test(name))
    .map((name) => [name, readFileSync(join(workflowDirectory, name), "utf8")])
);

const selfHosted = `name: Rig
on:
  workflow_dispatch:
  workflow_call:
jobs:
  smoke:
    runs-on: [self-hosted, plvs-rig, linux]
    steps:
      - run: npm run smoke:capture
`;

describe("self-hosted runners on a public repository", () => {
  it("keeps every self-hosted job away from untrusted triggers and secrets", () => {
    expect(selfHostedViolations(workflows)).toEqual([]);
  });

  it("runs leased capture smoke on all three home platforms with the release harness build", () => {
    const capture = workflows["capture-acceptance.yml"];
    for (const platform of ["windows", "macos", "linux"]) {
      expect(capture).toContain(`labels: [self-hosted, plvs-rig, ${platform}]`);
    }
    expect(capture).toContain(BUILD_HARNESS);
    // On a Windows desktop, `bash` on PATH is usually WSL's System32 launcher, not Git Bash.
    expect(capture).toContain(
      `shell: '"C:\\Program Files\\Git\\bin\\bash.exe" --noprofile --norc -eo pipefail {0}'`
    );
    expect(capture).toContain("shell: ${{ matrix.shell }}");
    expect(capture).toContain("COREPACK_ENABLE_AUTO_PIN: 0");
    expect(capture).toContain("npm run smoke:capture -- --wait");
    expect(capture).toContain('--sha "$COMMIT_SHA" --platform "$PLATFORM"');
    expect(capture).not.toMatch(/continue-on-error|^\s*if:/m);
  });

  it("accepts a dispatch-only self-hosted workflow and a dispatch-only caller", () => {
    const caller = `on:
  workflow_dispatch:
jobs:
  rig:
    uses: ./.github/workflows/rig.yml
`;
    expect(selfHostedViolations({ "rig.yml": selfHosted, "release.yml": caller })).toEqual([]);
  });

  it("rejects a pull_request trigger beside a self-hosted job", () => {
    const text = selfHosted.replace("  workflow_call:\n", "  workflow_call:\n  pull_request:\n");
    expect(selfHostedViolations({ "rig.yml": text })).toEqual([
      "rig.yml reaches a self-hosted runner and is triggered by pull_request",
    ]);
  });

  it("rejects one-line trigger forms that include an untrusted event", () => {
    const list = selfHosted.replace(/on:\n(  .*\n)+/, "on: [push, workflow_dispatch]\n");
    const scalar = selfHosted.replace(/on:\n(  .*\n)+/, "on: issue_comment\n");
    expect(selfHostedViolations({ "a.yml": list, "b.yml": scalar })).toEqual([
      "a.yml reaches a self-hosted runner and is triggered by push",
      "b.yml reaches a self-hosted runner and is triggered by issue_comment",
    ]);
  });

  it("rejects a workflow that calls a self-hosted workflow from pull_request", () => {
    const caller = `on:
  pull_request:
jobs:
  rig:
    uses: ./.github/workflows/rig.yml
`;
    expect(selfHostedViolations({ "rig.yml": selfHosted, "ci.yml": caller })).toEqual([
      "ci.yml reaches a self-hosted runner and is triggered by pull_request",
    ]);
  });

  it("rejects secrets in a self-hosted workflow or passed to one", () => {
    const leaking = selfHosted.replace(
      "      - run: npm run smoke:capture\n",
      "      - run: echo ${{ secrets.TOKEN }}\n"
    );
    const inheriting = `on:
  workflow_dispatch:
jobs:
  rig:
    uses: ./.github/workflows/rig.yml
    secrets: inherit
`;
    expect(selfHostedViolations({ "rig.yml": leaking })).toEqual([
      "rig.yml runs on a self-hosted runner and references secrets",
    ]);
    expect(selfHostedViolations({ "rig.yml": selfHosted, "release.yml": inheriting })).toEqual([
      "release.yml passes secrets to self-hosted workflow rig.yml",
    ]);
  });
});
