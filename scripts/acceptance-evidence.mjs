import { createHash } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { arch, release } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export const ACCEPTANCE_SCHEMA_VERSION = 1;
export const ACCEPTANCE_DOMAINS = ["update", "dock", "capture"];
export const ACCEPTANCE_PLATFORMS = ["windows", "macos"];
export const ACCEPTANCE_STATUSES = new Set([
  "passed",
  "failed",
  "rigUnavailable",
  "manual",
  "notRun",
  "unsupported",
]);
const SUMMARIES = new Set(["complete", "incomplete", "failed"]);

function invalid(message) {
  throw new Error(`Invalid acceptance evidence: ${message}`);
}

export function normalizePlatform(value = process.platform) {
  if (value === "win32" || value === "windows") return "windows";
  if (value === "darwin" || value === "macos") return "macos";
  return value;
}

export function normalizeArch(value = arch()) {
  if (value === "arm64") return "aarch64";
  if (value === "x64") return "x86_64";
  return value;
}

export function hostPlatform() {
  let version = release();
  const command =
    process.platform === "darwin"
      ? ["sw_vers", ["-productVersion"]]
      : process.platform === "win32"
        ? [
            "powershell.exe",
            ["-NoProfile", "-NonInteractive", "-Command", "[Environment]::OSVersion.VersionString"],
          ]
        : null;
  if (command) {
    const result = spawnSync(command[0], command[1], { encoding: "utf8" });
    if (result.status === 0 && result.stdout.trim()) version = result.stdout.trim();
  }
  return {
    os: normalizePlatform(),
    arch: normalizeArch(),
    version,
  };
}

export function resolveGitSha(ref = "HEAD", cwd = process.cwd()) {
  const result = spawnSync("git", ["rev-parse", "--verify", `${ref}^{commit}`], {
    cwd,
    encoding: "utf8",
  });
  const sha = result.stdout?.trim().toLowerCase();
  if (result.status !== 0 || !/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error(`Could not resolve git commit: ${ref}`);
  }
  return sha;
}

export function resolveEvidenceSourceSha(cwd = process.cwd(), run = spawnSync) {
  const revision = run("git", ["rev-parse", "--verify", "HEAD^{commit}"], {
    cwd,
    encoding: "utf8",
  });
  const sha = revision.stdout?.trim().toLowerCase();
  if (revision.status !== 0 || !/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error("Could not resolve HEAD for acceptance evidence");
  }
  const status = run("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd,
    encoding: "utf8",
  });
  if (status.status !== 0)
    throw new Error("Could not inspect the worktree for acceptance evidence");
  if (status.stdout?.trim()) {
    throw new Error(
      "Acceptance evidence requires a clean worktree so its sourceSha names the code that ran"
    );
  }
  return sha;
}

export function acceptanceRunId(date = new Date(), pid = process.pid) {
  return `${date
    .toISOString()
    .replaceAll(":", "-")
    .replace(/\.\d{3}Z$/, "Z")}-${pid}`;
}

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function validateAcceptanceEvidence(evidence) {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    invalid("root must be an object");
  }
  if (evidence.schemaVersion !== ACCEPTANCE_SCHEMA_VERSION) {
    invalid("unsupported schemaVersion");
  }
  if (!ACCEPTANCE_DOMAINS.includes(evidence.domain)) invalid(`unknown domain ${evidence.domain}`);
  if (typeof evidence.runId !== "string" || evidence.runId.length === 0) {
    invalid("runId must be a nonempty string");
  }
  if (!/^[0-9a-f]{40}$/.test(evidence.sourceSha)) invalid("sourceSha must be 40 lowercase hex");
  if (!ACCEPTANCE_PLATFORMS.includes(evidence.platform?.os)) {
    invalid(`unknown platform ${evidence.platform?.os}`);
  }
  for (const key of ["arch", "version"]) {
    if (typeof evidence.platform?.[key] !== "string" || evidence.platform[key].length === 0) {
      invalid(`platform.${key} must be a nonempty string`);
    }
  }
  if (typeof evidence.tool?.name !== "string" || !Number.isSafeInteger(evidence.tool?.version)) {
    invalid("tool must name an integer version");
  }
  const started = Date.parse(evidence.startedAt);
  const ended = Date.parse(evidence.endedAt);
  if (
    !Number.isFinite(started) ||
    !Number.isFinite(ended) ||
    new Date(started).toISOString() !== evidence.startedAt ||
    new Date(ended).toISOString() !== evidence.endedAt ||
    ended < started
  ) {
    invalid("startedAt and endedAt must be ordered ISO timestamps");
  }
  if (!SUMMARIES.has(evidence.summary)) invalid(`unknown summary ${evidence.summary}`);
  if (!Array.isArray(evidence.scenarios)) invalid("scenarios must be an array");
  const ids = new Set();
  for (const scenario of evidence.scenarios) {
    if (typeof scenario?.id !== "string" || scenario.id.length === 0 || ids.has(scenario.id)) {
      invalid("scenario IDs must be present and unique");
    }
    ids.add(scenario.id);
    if (!ACCEPTANCE_STATUSES.has(scenario.status)) {
      invalid(`unknown status for ${scenario.id}`);
    }
  }
  if (!Array.isArray(evidence.artifacts)) invalid("artifacts must be an array");
  for (const artifact of evidence.artifacts) {
    if (typeof artifact?.file !== "string" || artifact.file.length === 0) {
      invalid("artifact files must be nonempty strings");
    }
  }
  if (!Array.isArray(evidence.warnings)) invalid("warnings must be an array");
  if (evidence.warnings.some((warning) => typeof warning !== "string")) {
    invalid("warnings must contain strings");
  }
  if (!new Set(["passed", "failed"]).has(evidence.cleanup?.status)) {
    invalid("cleanup.status must be passed or failed");
  }
  if (
    !Array.isArray(evidence.cleanup.observations) ||
    evidence.cleanup.observations.some((observation) => typeof observation !== "string")
  ) {
    invalid("cleanup.observations must contain strings");
  }
  const hasFailure = evidence.scenarios.some((scenario) => scenario.status === "failed");
  if (evidence.summary === "complete" && (hasFailure || evidence.cleanup.status !== "passed")) {
    invalid("complete evidence cannot contain a failure or failed cleanup");
  }
  return evidence;
}

export function classifyEvidence(evidence, targetSha) {
  validateAcceptanceEvidence(evidence);
  if (evidence.sourceSha !== targetSha) return "stale";
  if (evidence.summary === "failed" || evidence.cleanup.status === "failed") return "failed";
  return evidence.summary === "complete" ? "passed" : "incomplete";
}

function cellKey(domain, platform) {
  return `${domain}:${platform}`;
}

export function buildAcceptanceReport({
  targetSha,
  evidence,
  generatedAt = new Date(),
  generatorSha = resolveEvidenceSourceSha(),
  generatorPlatform = hostPlatform(),
}) {
  if (!/^[0-9a-f]{40}$/.test(targetSha)) throw new Error("targetSha must be 40 lowercase hex");
  const grouped = new Map();
  for (const item of evidence) {
    validateAcceptanceEvidence(item.value);
    const key = cellKey(item.value.domain, item.value.platform.os);
    const rows = grouped.get(key) ?? [];
    rows.push(item);
    grouped.set(key, rows);
  }

  const matrix = [];
  for (const domain of ACCEPTANCE_DOMAINS) {
    for (const platform of ACCEPTANCE_PLATFORMS) {
      const rows = grouped.get(cellKey(domain, platform)) ?? [];
      const exact = rows.filter((item) => item.value.sourceSha === targetSha);
      if (exact.length > 1 || (rows.length > 1 && exact.length !== 1)) {
        throw new Error(`Ambiguous evidence files supplied for ${domain}/${platform}`);
      }
      const selected = exact[0] ?? rows.at(-1) ?? null;
      const state = selected ? classifyEvidence(selected.value, targetSha) : "missing";
      matrix.push({
        domain,
        platform,
        state,
        sourceSha: selected?.value.sourceSha ?? null,
        summary: selected?.value.summary ?? null,
        evidenceFile: selected?.file ?? null,
        evidenceSha256: selected?.sha256 ?? null,
        scenarios: selected?.value.scenarios ?? [],
        warnings: selected?.value.warnings ?? [],
      });
    }
  }
  const failed = matrix.filter((cell) => cell.state === "failed");
  const gaps = matrix
    .filter((cell) => !new Set(["passed", "failed", "unsupported"]).has(cell.state))
    .map((cell) => ({
      domain: cell.domain,
      platform: cell.platform,
      state: cell.state,
      sourceSha: cell.sourceSha,
    }));
  const advisories = matrix.flatMap((cell) => [
    ...cell.scenarios
      .filter((scenario) =>
        new Set(["manual", "notRun", "rigUnavailable", "unsupported"]).has(scenario.status)
      )
      .map((scenario) => ({
        domain: cell.domain,
        platform: cell.platform,
        scenario: scenario.id,
        status: scenario.status,
      })),
    ...cell.warnings.map((warning) => ({
      domain: cell.domain,
      platform: cell.platform,
      warning,
    })),
  ]);
  return {
    schemaVersion: ACCEPTANCE_SCHEMA_VERSION,
    targetSha,
    generatedAt: generatedAt.toISOString(),
    generatedBy: {
      sourceSha: generatorSha,
      platform: generatorPlatform,
      tool: { name: "acceptance-report", version: 1 },
    },
    ready: failed.length === 0,
    verdict: failed.length > 0 ? "failed" : gaps.length > 0 ? "incomplete" : "passed",
    matrix,
    gaps,
    advisories,
  };
}

export function acceptanceReportMarkdown(report, reportPath) {
  const lines = [
    "# PLVS Acceptance Evidence",
    "",
    `Target: \`${report.targetSha}\``,
    "",
    `Verdict: **${report.verdict}** (${report.ready ? "ready with any listed gaps" : "blocked by failure"})`,
    "",
    "| Domain | Windows | macOS |",
    "| --- | --- | --- |",
  ];
  for (const domain of ACCEPTANCE_DOMAINS) {
    const cells = ACCEPTANCE_PLATFORMS.map((platform) =>
      report.matrix.find((cell) => cell.domain === domain && cell.platform === platform)
    );
    const render = (cell) => {
      if (!cell.evidenceFile) return cell.state;
      const href = relative(dirname(reportPath), cell.evidenceFile).replaceAll("\\", "/");
      return `[${cell.state}](${href})`;
    };
    lines.push(`| ${domain} | ${render(cells[0])} | ${render(cells[1])} |`);
  }
  lines.push("", "## Follow-up", "");
  if (report.gaps.length === 0) {
    lines.push("No evidence gaps.");
  } else {
    for (const gap of report.gaps) {
      const suffix = gap.sourceSha ? `; evidence is for \`${gap.sourceSha}\`` : "";
      lines.push(`- ${gap.domain}/${gap.platform}: ${gap.state}${suffix}`);
    }
  }
  lines.push("", "## Advisories", "");
  if (report.advisories.length === 0) {
    lines.push("No manual, unsupported or tool-reported advisories.");
  } else {
    for (const advisory of report.advisories) {
      const detail = advisory.warning
        ? advisory.warning
        : `${advisory.scenario}: ${advisory.status}`;
      lines.push(`- ${advisory.domain}/${advisory.platform}: ${detail}`);
    }
  }
  lines.push(
    "",
    "> Missing, stale and incomplete evidence is advisory in this report. An actual target-SHA failure blocks readiness. This is not a stable-release approval.",
    ""
  );
  return lines.join("\n");
}

export async function writeTextAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}`;
  writeFileSync(temp, value);
  renameSync(temp, path);
}

export async function writeJsonAtomic(path, value) {
  await writeTextAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function resolveEvidencePath(path) {
  return resolve(path);
}
