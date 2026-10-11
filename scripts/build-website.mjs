import { cp, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

import { buildSharesetsSite } from "./build-sharesets-site.mjs";
import { buildDocsPage } from "./build-user-docs.mjs";
import { assertSafeWebsiteOutput, validateWebsite } from "./validate-website.mjs";

async function removeSourceOnlyFiles(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await removeSourceOnlyFiles(path);
    else if (entry.isFile() && entry.name.includes(".test.")) await rm(path);
  }
}

async function renameWithRetry(source, target) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(source, target);
      return;
    } catch (error) {
      if (!new Set(["EACCES", "EBUSY", "EPERM"]).has(error?.code) || attempt === 7) throw error;
      await delay(40 * (attempt + 1));
    }
  }
}

async function replaceDirectory(staging, output) {
  const backup = join(dirname(output), `.${basename(output)}-backup-${process.pid}-${Date.now()}`);
  let movedPrevious = false;
  try {
    await renameWithRetry(output, backup);
    movedPrevious = true;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  try {
    await renameWithRetry(staging, output);
  } catch (error) {
    if (movedPrevious) await renameWithRetry(backup, output);
    throw error;
  }
  if (movedPrevious) await rm(backup, { recursive: true, force: true });
}

export async function buildWebsite({ rootDirectory, contentDirectory, outputDirectory } = {}) {
  const root = resolve(rootDirectory ?? process.cwd());
  const website = resolve(root, "website");
  const userGuide = resolve(root, "docs", "user");
  const content = resolve(contentDirectory ?? join(root, "sharesets", "catalogue"));
  const output = assertSafeWebsiteOutput(
    outputDirectory ?? join(root, "artifacts", "website"),
    [website, userGuide, content],
    { repositoryRoot: root, localOutputRoot: join(root, "artifacts") }
  );
  const staging = join(
    dirname(output),
    `.${basename(output)}-staging-${process.pid}-${Date.now()}`
  );

  await mkdir(dirname(output), { recursive: true });
  await rm(staging, { recursive: true, force: true });
  try {
    await cp(website, staging, { recursive: true });
    await removeSourceOnlyFiles(staging);
    await mkdir(join(staging, "docs"), { recursive: true });
    await writeFile(join(staging, "docs", "index.html"), buildDocsPage(root));
    await buildSharesetsSite({
      contentDirectory: content,
      outputDirectory: join(staging, "sharesets"),
      siteDirectory: staging,
      websiteDirectory: website,
    });
    await rm(join(staging, "docs", "template.html"));
    const validation = await validateWebsite(staging);
    await replaceDirectory(staging, output);
    return { outputDirectory: output, ...validation, root: output };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function main(args) {
  if (args.length > 2) {
    throw new Error("Usage: npm run website:build -- [content-directory] [output-directory]");
  }
  const result = await buildWebsite({ contentDirectory: args[0], outputDirectory: args[1] });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
