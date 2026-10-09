import { createReadStream, constants } from "node:fs";
import { copyFile, lstat, mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, relative, isAbsolute, join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const json = (value) => JSON.stringify(value, null, 2) + "\n";
const hash = async (file) => {
  const sum = createHash("sha256");
  for await (const chunk of createReadStream(file)) sum.update(chunk);
  return sum.digest("hex");
};
function safeRelative(value) {
  if (typeof value !== "string" || !value || value.includes("\\") || value.includes(":"))
    throw new Error(`Invalid relative path: ${value}`);
  if (
    value
      .split("/")
      .some(
        (p) =>
          !p ||
          p === "." ||
          p === ".." ||
          /[<>"|?*\x00-\x1f]/.test(p) ||
          /[. ]$/.test(p) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(p)
      )
  )
    throw new Error(`Unsafe relative path: ${value}`);
  return value;
}
function inside(root, path) {
  const r = relative(root, path);
  return (
    r === "" ||
    (!isAbsolute(r) &&
      r !== ".." &&
      !r.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`))
  );
}
async function noLinks(path) {
  path = resolve(path);
  const parent = dirname(path);
  if (parent !== path) await noLinks(parent);
  try {
    if ((await lstat(path)).isSymbolicLink())
      throw new Error(`Symbolic links/junctions are not supported: ${path}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
async function absent(path) {
  try {
    await lstat(path);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`Destination already exists: ${path}`);
}
async function canonicalPath(path) {
  try {
    return await realpath(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return join(await canonicalPath(dirname(path)), relative(dirname(path), path));
  }
}
function validateConfig(config) {
  for (const key of Object.keys(config))
    if (!["source", "destination", "rules"].includes(key))
      throw new Error(`Unknown configuration key: ${key}`);
  if (typeof config.source !== "string" || typeof config.destination !== "string")
    throw new Error("source and destination are required");
  const rules = config.rules ?? [];
  if (!Array.isArray(rules)) throw new Error("rules must be an array");
  const seen = new Set();
  for (const r of rules) {
    for (const k of Object.keys(r))
      if (!["path", "action", "to", "deduplicate"].includes(k))
        throw new Error(`Unknown rule key: ${k}`);
    safeRelative(r.path);
    if (seen.has(r.path.toLowerCase())) throw new Error(`Duplicate rule: ${r.path}`);
    seen.add(r.path.toLowerCase());
    if (!["keep", "omit"].includes(r.action)) throw new Error(`Invalid action for ${r.path}`);
    if (r.to !== undefined) safeRelative(r.to);
    if (r.deduplicate !== undefined && typeof r.deduplicate !== "boolean")
      throw new Error("deduplicate must be boolean");
    if (r.action === "omit" && (r.to !== undefined || r.deduplicate !== undefined))
      throw new Error("Omit rules cannot remap or deduplicate");
  }
  // Disallow nested rules: a parent omission must not hide a child keep rule.
  for (const a of rules)
    for (const b of rules)
      if (a !== b && b.path.toLowerCase().startsWith(a.path.toLowerCase() + "/"))
        throw new Error("Overlapping rules are not supported");
  const source = resolve(config.source),
    destination = resolve(config.destination);
  if (inside(source, destination) || inside(destination, source))
    throw new Error("Source and destination must be separate, non-nested directories");
  return { source, destination, rules };
}

async function collectPlan(input, destinationMayExist = false) {
  const config = validateConfig(input);
  await noLinks(config.source);
  await noLinks(config.destination);
  config.source = await canonicalPath(config.source);
  config.destination = await canonicalPath(config.destination);
  if (inside(config.source, config.destination) || inside(config.destination, config.source)) {
    throw new Error("Source and destination must be separate, non-nested directories");
  }
  if (!destinationMayExist) await absent(config.destination);
  if (!(await lstat(config.source)).isDirectory()) throw new Error("Source must be a directory");
  const entries = [],
    matched = new Set(),
    targets = new Map(),
    content = new Map();
  async function walk(dir, prefix = "") {
    const children = (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    );
    for (const item of children) {
      const path = safeRelative(prefix ? `${prefix}/${item.name}` : item.name);
      const rule = config.rules.find((r) => path === r.path || path.startsWith(r.path + "/"));
      if (rule) matched.add(rule.path);
      if (rule?.action === "omit") {
        entries.push({
          source: path,
          action: "omit",
          kind: item.isDirectory() ? "directory" : "file",
          rule: rule.path,
        });
        continue; // Explicitly omitted directory trees are not inspected or hashed.
      }
      if (item.isSymbolicLink())
        throw new Error(`Symbolic links/junctions are not supported: ${path}`);
      if (item.isDirectory()) {
        await walk(join(dir, item.name), path);
        continue;
      }
      if (!item.isFile()) throw new Error(`Not a regular file: ${path}`);
      const full = join(dir, item.name),
        before = await lstat(full);
      const sha256 = await hash(full),
        after = await lstat(full);
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs)
        throw new Error(`Source changed during planning: ${path}`);
      const mapped = rule?.to ? rule.to + path.slice(rule.path.length) : path;
      const target = `files/${safeRelative(mapped)}`;
      const folded = target.toLowerCase();
      if (targets.has(folded)) throw new Error(`Target collision: ${target}`);
      targets.set(folded, path);
      // Deduplication is opt-in only: normal project paths must continue resolving unchanged.
      const canonical = rule?.deduplicate ? content.get(sha256) : undefined;
      const entry = {
        source: path,
        action: "keep",
        target: canonical ?? target,
        bytes: after.size,
        mtimeMs: after.mtimeMs,
        sha256,
        classification: rule ? "explicit" : "unclassified-preserved",
      };
      if (canonical) entry.deduplicated = true;
      else if (rule?.deduplicate) content.set(sha256, target);
      entries.push(entry);
    }
  }
  await walk(config.source);
  for (const rule of config.rules)
    if (!matched.has(rule.path)) throw new Error(`Rule matched no source: ${rule.path}`);
  const actualTargets = entries
    .filter((e) => e.action === "keep" && !e.deduplicated)
    .map((e) => e.target.toLowerCase());
  const targetSet = new Set(actualTargets);
  for (const target of actualTargets) {
    let parent = target;
    while (parent.includes("/")) {
      parent = parent.slice(0, parent.lastIndexOf("/"));
      if (targetSet.has(parent)) throw new Error(`File/directory target collision: ${target}`);
    }
  }
  const kept = entries.filter((e) => e.action === "keep");
  const summary = {
    preservedSourceFiles: kept.length,
    unclassifiedPreservedFiles: kept.filter((e) => e.classification === "unclassified-preserved")
      .length,
    deduplicatedFiles: kept.filter((e) => e.deduplicated).length,
    payloadBytes: kept.filter((e) => !e.deduplicated).reduce((sum, e) => sum + e.bytes, 0),
    omittedEntries: entries.filter((e) => e.action === "omit").length,
  };
  return { version: 1, config, summary, entries };
}

export async function planArchive(input) {
  return collectPlan(input);
}

export async function applyArchive(plan, { copy = copyFile } = {}) {
  if (plan.version !== 1) throw new Error("Unsupported plan version");
  const fresh = await planArchive(plan.config);
  // Regenerate mappings rather than trusting paths in an edited/stale plan.
  if (JSON.stringify(fresh) !== JSON.stringify(plan))
    throw new Error("Plan is stale or modified; generate a new plan");
  const root = fresh.config.destination;
  await mkdir(root); // Parent must already exist. No overwrite, resume or automatic deletion.
  const report = { version: 1, status: "copying", completed: [] };
  const save = () => writeFile(join(root, "archive-report.json"), json(report));
  await writeFile(join(root, "archive-plan.json"), json(plan), { flag: "wx" });
  await save();
  try {
    for (const entry of plan.entries.filter((e) => e.action === "keep")) {
      const src = join(plan.config.source, entry.source),
        dest = join(root, entry.target);
      await noLinks(src);
      if (!entry.deduplicated) {
        await noLinks(dirname(dest));
        await mkdir(dirname(dest), { recursive: true });
        await copy(src, dest, constants.COPYFILE_EXCL);
      }
      if ((await hash(dest)) !== entry.sha256 || (await hash(src)) !== entry.sha256)
        throw new Error(`Copy/source verification failed: ${entry.source}`);
      report.completed.push(entry.source);
      await save();
    }
    // Recheck the complete source inventory after copying, including additions and removals.
    const checked = await collectPlan(plan.config, true);
    if (JSON.stringify(checked) !== JSON.stringify(plan))
      throw new Error("Source changed during copying");
    const files = plan.entries
      .filter((e) => e.action === "keep" && !e.deduplicated)
      .map((e) => ({ path: e.target, bytes: e.bytes, sha256: e.sha256 }));
    await writeFile(join(root, "SHA256SUMS.json"), json({ version: 1, files }), { flag: "wx" });
    await writeFile(
      join(root, "README.md"),
      `# Production archive\n\nPayload: files/ (original paths unless explicitly remapped).\n\nSee archive-plan.json for every preserved/omitted path and deduplication mapping.\nUnclassified files were preserved. Empty directories are not materialized.\nSHA256SUMS.json checks payload files; metadata is not covered by that manifest.\nNo source files were deleted. Dependency installation and render validation remain separate.\n\nVerify from a PLVS checkout:\n\n\`node scripts/marketing/archive-production.mjs verify "${root}"\`\n`,
      { flag: "wx" }
    );
    report.status = "complete";
  } catch (error) {
    report.status = "failed";
    report.error = error.message;
    await save();
    throw error;
  }
  await save();
  return report;
}

export async function verifyArchive(directory) {
  const root = resolve(directory);
  await noLinks(root);
  await noLinks(join(root, "archive-report.json"));
  await noLinks(join(root, "SHA256SUMS.json"));
  const report = JSON.parse(await readFile(join(root, "archive-report.json"), "utf8"));
  if (report.status !== "complete") throw new Error("Archive is incomplete");
  const manifest = JSON.parse(await readFile(join(root, "SHA256SUMS.json"), "utf8"));
  if (manifest.version !== 1 || !Array.isArray(manifest.files)) throw new Error("Invalid manifest");
  const failures = [];
  const expected = new Set();
  for (const entry of manifest.files) {
    safeRelative(entry.path);
    if (!entry.path.startsWith("files/") || expected.has(entry.path))
      throw new Error("Invalid or duplicate manifest path");
    expected.add(entry.path);
    const file = join(root, entry.path);
    try {
      await noLinks(file);
      if (
        !(await lstat(file)).isFile() ||
        (await lstat(file)).size !== entry.bytes ||
        (await hash(file)) !== entry.sha256
      )
        failures.push(entry.path);
    } catch {
      failures.push(entry.path);
    }
  }
  async function extras(dir, prefix) {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const name = prefix + "/" + item.name;
      if (item.isSymbolicLink()) failures.push(name);
      else if (item.isDirectory()) await extras(join(dir, item.name), name);
      else if (!expected.has(name)) failures.push(name);
    }
  }
  try {
    await extras(join(root, "files"), "files");
  } catch (error) {
    if (error.code !== "ENOENT" || expected.size) throw error;
  }
  return { status: failures.length ? "failed" : "passed", files: expected.size, failures };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { values, positionals } = parseArgs({
      allowPositionals: true,
      options: { out: { type: "string" }, help: { type: "boolean" } },
    });
    if (values.help)
      console.log(
        "plan CONFIG --out PLAN.json | apply PLAN.json | verify ARCHIVE_DIRECTORY\nRun with node scripts/marketing/archive-production.mjs. Config paths are relative to its file. No source deletion."
      );
    else {
      if (positionals.length !== 2) throw new Error("Expected an operation and path; see --help");
      const [operation, file] = positionals;
      if (operation === "plan") {
        if (!values.out) throw new Error("plan requires --out");
        const config = JSON.parse(await readFile(file, "utf8"));
        for (const key of ["source", "destination"])
          if (typeof config[key] === "string")
            config[key] = resolve(dirname(resolve(file)), config[key]);
        const plan = await planArchive(config);
        if (
          inside(plan.config.source, resolve(values.out)) ||
          inside(plan.config.destination, resolve(values.out))
        )
          throw new Error("Plan must be outside source and destination");
        await writeFile(values.out, json(plan), { flag: "wx" });
        console.log(
          `Plan saved: ${resolve(values.out)}; ${plan.entries.length} entries. Review it before apply.`
        );
      } else if (operation === "apply")
        console.log(json(await applyArchive(JSON.parse(await readFile(file, "utf8")))));
      else if (operation === "verify") {
        const report = await verifyArchive(file);
        console.log(json(report));
        process.exitCode = report.status === "passed" ? 0 : 1;
      } else throw new Error("Unknown operation; see --help");
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
