import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "node:process";
import { parse } from "yaml";
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
    // The runner splits a quoted shell path at its first quote, so Windows runners put Git Bash
    // first on their own PATH instead; the workflow names plain bash everywhere.
    expect(capture).toMatch(/defaults:\n\s+run:\n\s+shell: bash\n/);
    expect(capture).not.toContain("matrix.shell");
    expect(capture).toContain("COREPACK_ENABLE_AUTO_PIN: 0");
    expect(capture).toContain("npm run smoke:capture -- --wait");
    expect(capture).toContain('--sha "$COMMIT_SHA" --platform "$PLATFORM"');
    expect(capture).not.toMatch(/continue-on-error|^\s*if:/m);
  });

  it("keeps standalone dispatches out of the release call's concurrency group", () => {
    // Only one run per group may be pending, so a standalone dispatch for the release SHA would
    // otherwise cancel the release's pending call. A called workflow sees the caller's
    // github.workflow, which separates the two.
    const { concurrency } = parse(workflows["capture-acceptance.yml"]);
    expect(concurrency.group).toBe(
      "capture-acceptance-${{ github.workflow }}-${{ inputs.commit_sha }}"
    );
  });

  it("runs automated update acceptance on both desktop platforms without secrets", () => {
    const workflow = workflows["update-acceptance.yml"];
    for (const platform of ["windows", "macos"]) {
      expect(workflow).toContain(`labels: [self-hosted, plvs-rig, ${platform}]`);
    }
    expect(workflow).toContain("npm run update:acceptance:run");
    expect(workflow).toContain("actions/upload-artifact@v7");
    expect(workflow).toContain("actions/download-artifact@v8");
    expect(workflow).not.toContain("secrets.");
  });

  it("refuses a commit that main does not contain before anything from it runs", () => {
    // A dispatch accepts any SHA in the repository network, fork pull request commits included.
    const { steps } = parse(workflows["capture-acceptance.yml"]).jobs["capture-smoke"];
    const names = steps.map((step) => step.name);
    const checkout = steps[names.indexOf("Checkout the exact commit")];
    const reachable = names.indexOf("Require the commit on main");
    expect(checkout.with["fetch-depth"]).toBe(0);
    expect(reachable).toBe(names.indexOf("Checkout the exact commit") + 1);
    expect(steps[reachable].run).toContain(
      'git merge-base --is-ancestor "$COMMIT_SHA" refs/remotes/origin/main'
    );
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

  it("treats any runs-on that is not a hosted image label as self-hosted", () => {
    const job = (runsOn) =>
      `on:\n  pull_request:\njobs:\n  rig:\n    runs-on: ${runsOn}\n    steps:\n      - run: echo\n`;
    const shapes = {
      "labels.yml": job("[plvs-rig, linux]"),
      "expression.yml": job("${{ fromJSON(vars.RIG) }}"),
      "group.yml": job("{ group: home }"),
      "matrix.yml": job("${{ matrix.labels }}"),
    };
    expect(selfHostedViolations(shapes)).toEqual(
      Object.keys(shapes).map(
        (name) => `${name} reaches a self-hosted runner and is triggered by pull_request`
      )
    );
    const hosted = job("ubuntu-24.04").replace("pull_request", "push");
    expect(selfHostedViolations({ "ci.yml": hosted })).toEqual([]);
  });

  it("reads every YAML form of on:", () => {
    const body = "jobs:\n  rig:\n    runs-on: [self-hosted]\n    steps:\n      - run: echo\n";
    const forms = {
      "sequence.yml": `on:\n  - workflow_dispatch\n  - pull_request\n${body}`,
      "spaced.yml": `on :\n  pull_request:\n${body}`,
      "quoted.yml": `"on":\n  "pull_request_target": {}\n${body}`,
      "flow.yml": `on: {workflow_dispatch: {}, issue_comment: {}}\n${body}`,
    };
    expect(selfHostedViolations(forms)).toEqual([
      "sequence.yml reaches a self-hosted runner and is triggered by pull_request",
      "spaced.yml reaches a self-hosted runner and is triggered by pull_request",
      "quoted.yml reaches a self-hosted runner and is triggered by pull_request_target",
      "flow.yml reaches a self-hosted runner and is triggered by issue_comment",
    ]);
  });

  it("follows quoted, deeply indented and same-repository remote reusable calls", () => {
    const callers = {
      "quoted.yml": `on: [pull_request]\njobs:\n  "rig":\n    uses: "./.github/workflows/rig.yml"\n`,
      "indented.yml": `on: [pull_request]\njobs:\n    rig:\n        uses: ./.github/workflows/rig.yml\n`,
      "remote.yml": `on: [pull_request]\njobs:\n  rig:\n    uses: SounDoer/PLVS/.github/workflows/rig.yml@main\n`,
    };
    expect(selfHostedViolations({ "rig.yml": selfHosted, ...callers })).toEqual(
      Object.keys(callers).map(
        (name) => `${name} reaches a self-hosted runner and is triggered by pull_request`
      )
    );
  });

  it("fails closed on a workflow it cannot read", () => {
    expect(selfHostedViolations({ "broken.yml": "on: [push\njobs: {" })).toEqual([
      "broken.yml cannot be parsed as YAML",
    ]);
    expect(
      selfHostedViolations({ "empty.yml": "jobs:\n  a:\n    runs-on: [self-hosted]\n" })
    ).toEqual(["empty.yml reaches a self-hosted runner and has no readable on: triggers"]);
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
