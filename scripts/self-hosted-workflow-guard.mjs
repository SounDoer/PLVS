/**
 * PLVS is a public repository. A self-hosted runner reachable from an event an outsider can
 * trigger (a pull request, a comment, a fork push) hands that outsider a shell on the
 * maintainer's own machine, so self-hosted jobs may only start from events that require write
 * access, and are never given secrets.
 *
 * Workflows are read as text: the repository has no YAML parser, and the rules only need the
 * top-level `on:` keys, `runs-on` labels and reusable-workflow calls.
 */

const TRUSTED_TRIGGERS = new Set(["workflow_dispatch", "workflow_call", "schedule"]);

function withoutComments(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

/** The event names under the top-level `on:` key, in any of its three forms. */
export function workflowTriggers(text) {
  const lines = withoutComments(text).split("\n");
  const index = lines.findIndex((line) => /^["']?on["']?:/.test(line));
  if (index < 0) return [];
  const inline = lines[index].replace(/^["']?on["']?:/, "").trim();
  if (inline) {
    return inline
      .replace(/^\[|\]$/g, "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
  }
  const triggers = [];
  let indent = null;
  for (const line of lines.slice(index + 1)) {
    if (!line.trim()) continue;
    const leading = line.length - line.trimStart().length;
    if (leading === 0) break;
    indent ??= leading;
    const key = line.match(/^\s*([A-Za-z_]+):/);
    if (leading === indent && key) triggers.push(key[1]);
  }
  return triggers;
}

function runsSelfHosted(text) {
  return /self-hosted/.test(withoutComments(text));
}

/** Each `jobs:` entry as its own text block, keyed by job id. */
function jobBlocks(text) {
  const lines = withoutComments(text).split("\n");
  const start = lines.findIndex((line) => /^jobs:/.test(line));
  const blocks = [];
  if (start < 0) return blocks;
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    if (/^ {2}[\w-]+:/.test(line)) blocks.push([line]);
    else blocks.at(-1)?.push(line);
  }
  return blocks.map((block) => block.join("\n"));
}

function calledWorkflows(block) {
  return [...block.matchAll(/uses:\s*\.\/\.github\/workflows\/([\w.-]+\.ya?ml)/g)].map(
    (match) => match[1]
  );
}

/** Every rule a set of workflows `{ fileName: text }` breaks, as readable sentences. */
export function selfHostedViolations(workflows) {
  const reaches = new Map();
  const reachesSelfHosted = (name, seen = new Set()) => {
    if (reaches.has(name)) return reaches.get(name);
    if (seen.has(name) || !(name in workflows)) return false;
    seen.add(name);
    const text = workflows[name];
    const result =
      runsSelfHosted(text) ||
      jobBlocks(text).some((block) =>
        calledWorkflows(block).some((callee) => reachesSelfHosted(callee, seen))
      );
    reaches.set(name, result);
    return result;
  };

  const violations = [];
  for (const [name, text] of Object.entries(workflows)) {
    if (!reachesSelfHosted(name)) continue;
    for (const trigger of workflowTriggers(text)) {
      if (!TRUSTED_TRIGGERS.has(trigger)) {
        violations.push(`${name} reaches a self-hosted runner and is triggered by ${trigger}`);
      }
    }
    if (runsSelfHosted(text) && /\bsecrets\b/.test(withoutComments(text))) {
      violations.push(`${name} runs on a self-hosted runner and references secrets`);
    }
    for (const block of jobBlocks(text)) {
      for (const callee of calledWorkflows(block)) {
        if (reachesSelfHosted(callee) && /^\s+secrets:/m.test(block)) {
          violations.push(`${name} passes secrets to self-hosted workflow ${callee}`);
        }
      }
    }
  }
  return violations;
}
