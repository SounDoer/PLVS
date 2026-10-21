import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEVELOPMENT_EVENT_FIXTURE_NAMES } from "../src/agentControl/developmentFixtureProtocol.js";
import { EVENT_FIXTURES } from "./ui-visual-walkthrough-lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

async function rustEstablishNames() {
  const source = await readFile(join(root, "src-tauri", "src", "cli_control.rs"), "utf8");
  const block = source.match(
    /operation == "establish" \{\s*if !matches!\(\s*value\.as_str\(\),([\s\S]*?)\)\s*\{/
  );
  if (!block) throw new Error("The dev CLI establish name check was not found in cli_control.rs.");
  return [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

describe("development event fixture coverage", () => {
  it("keeps the fixture name list identical across the protocol, the dev CLI and the walkthrough", async () => {
    const names = [...DEVELOPMENT_EVENT_FIXTURE_NAMES].sort();
    expect((await rustEstablishNames()).sort()).toEqual(names);
    expect(Object.keys(EVENT_FIXTURES).sort()).toEqual(names);
  });
});
