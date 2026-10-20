/**
 * PLVS is a public repository. A self-hosted runner reachable from an event an outsider can
 * trigger (a pull request, a comment, a fork push) hands that outsider a shell on the
 * maintainer's own machine, so self-hosted jobs may only start from events that require write
 * access, and are never given secrets.
 *
 * This guard checks the workflows on the default branch, so it catches the maintainer's and
 * agents' mistakes. A fork pull request runs the workflow files it brings itself, so against
 * outsiders the boundary is the repository's fork-PR approval setting (`CONTRIBUTING.md`, "Home
 * capture runners").
 *
 * It fails closed: any `runs-on` that is not a single hosted image label counts as self-hosted,
 * and a workflow it cannot read is a violation.
 */
import { parse } from "yaml";

const TRUSTED_TRIGGERS = new Set(["workflow_dispatch", "workflow_call", "schedule"]);
const HOSTED_IMAGE = /^(ubuntu|windows|macos)-[A-Za-z0-9.-]+$/;
const REPOSITORY = "soundoer/plvs";

function triggersOf(on) {
  if (typeof on === "string") return [on];
  if (Array.isArray(on)) return on.filter((name) => typeof name === "string");
  if (on && typeof on === "object") return Object.keys(on);
  return [];
}

function runsOnHosted(runsOn) {
  const labels = Array.isArray(runsOn) ? runsOn : [runsOn];
  return labels.length === 1 && typeof labels[0] === "string" && HOSTED_IMAGE.test(labels[0]);
}

/** The file name a job's `uses:` names when it calls a workflow of this repository, else null. */
function calledWorkflow(uses) {
  if (typeof uses !== "string") return null;
  const local = uses.match(/^\.\/\.github\/workflows\/([^/@]+\.ya?ml)$/);
  if (local) return local[1];
  const remote = uses.match(/^([^/]+\/[^/]+)\/\.github\/workflows\/([^/@]+\.ya?ml)@/);
  return remote && remote[1].toLowerCase() === REPOSITORY ? remote[2] : null;
}

function jobsOf(workflow) {
  const jobs = workflow?.jobs;
  return jobs && typeof jobs === "object" ? Object.values(jobs).filter(Boolean) : [];
}

/** Every rule a set of workflows `{ fileName: text }` breaks, as readable sentences. */
export function selfHostedViolations(workflows) {
  const violations = [];
  const parsed = {};
  for (const [name, text] of Object.entries(workflows)) {
    try {
      parsed[name] = parse(text);
    } catch {
      violations.push(`${name} cannot be parsed as YAML`);
    }
  }

  const runsSelfHosted = (workflow) =>
    jobsOf(workflow).some((job) => job.uses === undefined && !runsOnHosted(job["runs-on"]));

  const reaches = new Map();
  const reachesSelfHosted = (name, seen = new Set()) => {
    if (reaches.has(name)) return reaches.get(name);
    if (seen.has(name) || !(name in parsed)) return false;
    seen.add(name);
    const workflow = parsed[name];
    const result =
      runsSelfHosted(workflow) ||
      jobsOf(workflow).some((job) => {
        const callee = calledWorkflow(job.uses);
        return callee !== null && reachesSelfHosted(callee, seen);
      });
    reaches.set(name, result);
    return result;
  };

  for (const [name, workflow] of Object.entries(parsed)) {
    if (!reachesSelfHosted(name)) continue;
    const triggers = triggersOf(workflow?.on);
    if (triggers.length === 0) {
      violations.push(`${name} reaches a self-hosted runner and has no readable on: triggers`);
    }
    for (const trigger of triggers) {
      if (!TRUSTED_TRIGGERS.has(trigger)) {
        violations.push(`${name} reaches a self-hosted runner and is triggered by ${trigger}`);
      }
    }
    if (runsSelfHosted(workflow) && /\bsecrets\b/.test(JSON.stringify(workflow))) {
      violations.push(`${name} runs on a self-hosted runner and references secrets`);
    }
    for (const job of jobsOf(workflow)) {
      const callee = calledWorkflow(job.uses);
      if (callee !== null && reachesSelfHosted(callee) && job.secrets !== undefined) {
        violations.push(`${name} passes secrets to self-hosted workflow ${callee}`);
      }
    }
  }
  return violations;
}
