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

  it("stops Corepack from pinning package.json in every self-hosted workflow", () => {
    // A pinned packageManager field dirties the runner checkout, and exact-SHA evidence then
    // refuses to run (the first 0.23.1 macOS release-package smoke).
    const selfHosted = Object.entries(workflows).filter(([, text]) =>
      text.includes("[self-hosted, plvs-rig")
    );
    expect(selfHosted.length).toBeGreaterThanOrEqual(3);
    for (const [name, text] of selfHosted) {
      expect(text, name).toContain("COREPACK_ENABLE_AUTO_PIN: 0");
    }
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

  it("runs the release-package smoke on all three home platforms under the rig lease", () => {
    const workflow = workflows["release-package-smoke.yml"];
    for (const platform of ["windows", "macos", "linux"]) {
      expect(workflow).toContain(`labels: [self-hosted, plvs-rig, ${platform}]`);
    }
    expect(workflow).toMatch(/defaults:\n\s+run:\n\s+shell: bash\n/);
    expect(workflow).toContain("--wait");
    expect(workflow).not.toContain("secrets.");
    expect(parse(workflow).concurrency.group).toBe(
      "release-package-smoke-${{ github.workflow }}-${{ inputs.commit_sha }}"
    );
  });

  it("runs automated update acceptance on all three desktop platforms without secrets", () => {
    const workflow = workflows["update-acceptance.yml"];
    for (const platform of ["windows", "macos", "linux"]) {
      expect(workflow).toContain(`labels: [self-hosted, plvs-rig, ${platform}]`);
    }
    expect(workflow).toContain("npm run update:acceptance:run");
    expect(workflow).toContain("actions/upload-artifact@v7");
    expect(workflow).toContain("actions/download-artifact@v8");
    expect(workflow).not.toContain("secrets.");
  });

  it("runs weekly four-hour capture diagnostics without weakening release gates", () => {
    const text = workflows["capture-soak.yml"];
    const workflow = parse(text);
    expect(workflow.on.schedule).toEqual([{ cron: "0 18 * * 1" }]);
    expect(workflow.on).toHaveProperty("workflow_dispatch");
    expect(workflow.concurrency).toEqual({ group: "capture-soak", "cancel-in-progress": false });
    const job = workflow.jobs["capture-soak"];
    expect(job.strategy["fail-fast"]).toBe(false);
    expect(job.strategy.matrix.include.map(({ platform }) => platform)).toEqual([
      "windows",
      "macos",
      "linux",
    ]);
    expect(job["timeout-minutes"]).toBeGreaterThan(240);
    const steps = job.steps;
    const index = (name) => steps.findIndex((step) => step.name === name);
    expect(index("Require the commit on main")).toBe(index("Checkout the exact commit") + 1);
    expect(text).toContain(BUILD_HARNESS);
    expect(index("Capture smoke")).toBeGreaterThan(index("Build the capture harness"));
    expect(index("Four-hour capture soak")).toBeGreaterThan(
      index("Verify exact-commit smoke evidence")
    );
    expect(steps[index("Capture smoke")].run).toContain("npm run smoke:capture -- --wait");
    expect(steps[index("Four-hour capture soak")].run).toContain(
      "npm run soak:capture -- --seconds 14400 --every 10 --wait"
    );
    for (const name of ["Capture smoke", "Four-hour capture soak"]) {
      expect(steps[index(name)]).not.toHaveProperty("if");
      expect(steps[index(name)]).not.toHaveProperty("continue-on-error");
    }
    // Explicit bash uses pipefail, so tee cannot turn a failed diagnostic green.
    expect(job.defaults.run.shell).toBe("bash");
    const upload = steps[index("Upload capture diagnostics")];
    expect(upload.if).toBe("always()");
    expect(upload.with.path).toContain("artifacts/soak/");
    expect(upload.with["retention-days"]).toBe(90);
    expect(workflows["release.yml"]).not.toContain("capture-soak.yml");
  });

  it.each(["release-package-smoke.yml", "capture-acceptance.yml", "update-acceptance.yml"])(
    "%s bounds every artifact download",
    (file) => {
      const workflow = parse(workflows[file]);
      const downloads = Object.values(workflow.jobs).flatMap((job) =>
        (job.steps ?? []).filter((step) => step.uses?.startsWith("actions/download-artifact@"))
      );
      if (file !== "capture-acceptance.yml") expect(downloads.length).toBeGreaterThan(0);
      for (const step of downloads) {
        expect(step["timeout-minutes"], step.name).toBe(
          file === "release-package-smoke.yml" ? 20 : 10
        );
      }
    }
  );

  it.each([
    ["capture-acceptance.yml", "capture-smoke"],
    ["release-package-smoke.yml", "package-smoke"],
  ])("%s refuses a commit that main does not contain before anything from it runs", (file, job) => {
    // A dispatch accepts any SHA in the repository network, fork pull request commits included.
    const { steps } = parse(workflows[file]).jobs[job];
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
