import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";

const REQUIRED_PATHS = [
  "index.html",
  "docs/index.html",
  "privacy/index.html",
  "sharesets/index.html",
  "assets/site-tokens.css",
  "assets/site-components.css",
];

async function walkFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walkFiles(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function isWithin(parent, child) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}

export function assertSafeWebsiteOutput(
  outputDirectory,
  sourceDirectories = [],
  { repositoryRoot, localOutputRoot } = {}
) {
  const output = resolve(outputDirectory);
  const root = parse(output).root;
  if (output === root) throw new Error(`Website output cannot be a filesystem root: ${output}`);

  if (repositoryRoot && localOutputRoot) {
    const repository = resolve(repositoryRoot);
    const localOutputs = resolve(localOutputRoot);
    if (
      isWithin(repository, output) &&
      (output === localOutputs || !isWithin(localOutputs, output))
    ) {
      throw new Error(
        `Website output inside the repository must be below ${localOutputs}: ${output}`
      );
    }
  }

  for (const sourceDirectory of sourceDirectories) {
    const source = resolve(sourceDirectory);
    if (output === source || isWithin(output, source) || isWithin(source, output)) {
      throw new Error(`Website output overlaps source directory ${source}: ${output}`);
    }
  }
  return output;
}

function localTarget(root, htmlPath, rawTarget) {
  if (
    !rawTarget ||
    rawTarget.startsWith("#") ||
    rawTarget.startsWith("//") ||
    /^[a-z][a-z\d+.-]*:/i.test(rawTarget)
  ) {
    return null;
  }

  const decoded = decodeURIComponent(rawTarget.split(/[?#]/, 1)[0]);
  if (!decoded) return null;
  const target = decoded.startsWith("/")
    ? resolve(root, `.${decoded}`)
    : resolve(dirname(htmlPath), decoded);
  if (!isWithin(root, target)) {
    throw new Error(`Local website reference escapes the assembled root: ${rawTarget}`);
  }
  return target;
}

async function resolvesTarget(target, rawTarget) {
  if (existsSync(target)) {
    return (await stat(target)).isDirectory() ? existsSync(join(target, "index.html")) : true;
  }
  if (rawTarget.split(/[?#]/, 1)[0].endsWith("/")) return false;
  return extname(target) ? false : existsSync(join(target, "index.html"));
}

export async function validateWebsite(directory) {
  const root = resolve(directory);
  for (const required of REQUIRED_PATHS) {
    if (!existsSync(join(root, required))) throw new Error(`Website output is missing ${required}`);
  }

  const files = await walkFiles(root);
  const leaked = files
    .map((path) => relative(root, path))
    .filter((path) =>
      /(^|[\\/])template\.html$|\.test\.[^\\/]+$|^assets[\\/]raw[\\/]/i.test(path)
    );
  if (leaked.length > 0) {
    throw new Error(`Website output contains source-only files: ${leaked.join(", ")}`);
  }

  const missing = [];
  const htmlFiles = files.filter((path) => path.endsWith(".html"));
  for (const htmlPath of htmlFiles) {
    const html = await readFile(htmlPath, "utf8");
    const document = new JSDOM(html).window.document;
    const references = [...document.querySelectorAll("[href], [src]")].flatMap((element) =>
      [element.getAttribute("href"), element.getAttribute("src")].filter(Boolean)
    );
    for (const rawTarget of references) {
      const target = localTarget(root, htmlPath, rawTarget);
      if (target && !(await resolvesTarget(target, rawTarget))) {
        missing.push(`${relative(root, htmlPath)} -> ${rawTarget}`);
      }
    }
  }
  if (missing.length > 0) {
    throw new Error(`Website output has missing local references:\n${missing.join("\n")}`);
  }

  // A published image that nothing names is a leftover from an earlier page: delete it, and its
  // original under website/assets/raw/, instead of shipping it.
  let corpus = "";
  for (const path of files.filter((path) => /\.(html|css|js|json|webmanifest)$/i.test(path))) {
    corpus += await readFile(path, "utf8");
  }
  const unreferenced = files
    .filter((path) => /\.(png|webp|jpe?g|gif|svg|avif|ico)$/i.test(path))
    .filter((path) => !corpus.includes(basename(path)))
    .map((path) => relative(root, path));
  if (unreferenced.length > 0) {
    throw new Error(`Website output has unreferenced images:\n${unreferenced.join("\n")}`);
  }

  return { root, fileCount: files.length, htmlPageCount: htmlFiles.length };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const result = await validateWebsite(process.argv[2] ?? join("artifacts", "website"));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
