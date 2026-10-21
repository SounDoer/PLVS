import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEVELOPMENT_EVENT_FIXTURE_NAMES } from "../src/agentControl/developmentFixtureProtocol.js";
import { EVENT_FIXTURES, SCREENSHOT_TARGETS } from "./ui-visual-walkthrough-lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

async function rustEstablishNames() {
  const source = await readFile(join(root, "src-tauri", "src", "cli_control.rs"), "utf8");
  const block = source.match(
    /operation == "establish" \{\s*if !matches!\(\s*value\.as_str\(\),([\s\S]*?)\)\s*\{/
  );
  if (!block) throw new Error("The dev CLI establish name check was not found in cli_control.rs.");
  return [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return entry.name === "generated" ? [] : sourceFiles(path);
      return /\.jsx?$/.test(entry.name) && !/\.test\.jsx?$/.test(entry.name) ? [path] : [];
    })
  );
  return files.flat();
}

// Returns the object literal passed to each useUiSurface({ ... }) call, by brace depth.
function surfaceDescriptors(source) {
  const descriptors = [];
  for (const match of source.matchAll(/(?<!function )\buseUiSurface\(\{/g)) {
    const start = match.index + match[0].length - 1;
    let depth = 0;
    for (let index = start; index < source.length; index += 1) {
      if (source[index] === "{") depth += 1;
      if (source[index] === "}") depth -= 1;
      if (depth === 0) {
        descriptors.push({
          line: source.slice(0, match.index).split("\n").length,
          text: source.slice(start, index + 1),
        });
        break;
      }
    }
  }
  return descriptors;
}

async function eventSurfaceDeclarations() {
  const src = join(root, "src");
  const declarations = [];
  for (const file of await sourceFiles(src)) {
    const source = await readFile(file, "utf8");
    for (const { line, text } of surfaceDescriptors(source)) {
      const where = `${relative(root, file).replaceAll("\\", "/")}:${line}`;
      const origin = text.match(/\borigin:\s*([^,\n]+)/)?.[1].trim();
      const fixture = text.match(/\bdevelopmentFixture:\s*("[^"]*"|\{[^}]*\})/)?.[1];
      declarations.push({ where, origin, fixture });
    }
  }
  return declarations;
}

describe("development event fixture coverage", () => {
  it("requires every event surface to name its development fixture or a reason it has none", async () => {
    const declarations = await eventSurfaceDeclarations();
    const adapters = new Set();
    for (const file of await sourceFiles(join(root, "src"))) {
      const source = await readFile(file, "utf8");
      for (const match of source.matchAll(/useDevelopmentEventFixtureAdapter\(\s*"([^"]+)"/g)) {
        adapters.add(match[1]);
      }
    }
    expect(declarations.length).toBeGreaterThan(0);
    const problems = [];
    const declared = new Set();
    for (const { where, origin, fixture } of declarations) {
      if (!/^"(navigable|event|nested)"$/.test(origin ?? "")) {
        problems.push(`${where}: origin must be a string literal so this check can read it.`);
        continue;
      }
      if (origin !== '"event"') continue;
      if (!fixture) {
        problems.push(`${where}: event surface must declare developmentFixture.`);
      } else if (fixture.startsWith("{")) {
        if (!/^\{\s*none:\s*"[^"]{8,}"\s*\}$/.test(fixture))
          problems.push(`${where}: developmentFixture { none } needs a reason.`);
      } else {
        const name = fixture.slice(1, -1);
        declared.add(name);
        if (!DEVELOPMENT_EVENT_FIXTURE_NAMES.includes(name))
          problems.push(`${where}: ${name} is not a development fixture name.`);
        if (!adapters.has(name)) problems.push(`${where}: ${name} has no fixture adapter.`);
      }
    }
    for (const name of DEVELOPMENT_EVENT_FIXTURE_NAMES) {
      if (!declared.has(name)) problems.push(`${name} is not declared by any event surface.`);
    }
    expect(problems).toEqual([]);
  });

  it("keeps the fixture name list identical across the protocol, the dev CLI and the walkthrough", async () => {
    const names = [...DEVELOPMENT_EVENT_FIXTURE_NAMES].sort();
    expect((await rustEstablishNames()).sort()).toEqual(names);
    expect(Object.keys(EVENT_FIXTURES).sort()).toEqual(names);
  });

  it("lets walkthroughs capture every visual screenshot target the dev CLI accepts", async () => {
    const source = await readFile(join(root, "src-tauri", "src", "cli_control.rs"), "utf8");
    const block = source.match(/let target = match target\.as_deref\(\) \{([\s\S]*?)Some\(value\)/);
    if (!block)
      throw new Error("The visual screenshot target parser was not found in cli_control.rs.");
    const targets = [...block[1].matchAll(/Some\("([^"]+)"\)/g)].map((match) => match[1]);
    expect([...SCREENSHOT_TARGETS].sort()).toEqual(targets.sort());
  });
});
