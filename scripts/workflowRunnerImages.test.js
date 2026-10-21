import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "node:process";
import { describe, expect, it } from "vitest";

const workflowDirectory = join(cwd(), ".github", "workflows");

describe("hosted runner images", () => {
  // A moving `-latest` label lets CI and the release build run on different images.
  it("pins every hosted runner to an explicit image", () => {
    const moving = readdirSync(workflowDirectory)
      .filter((name) => /\.ya?ml$/.test(name))
      .flatMap((name) =>
        readFileSync(join(workflowDirectory, name), "utf8")
          .split("\n")
          .filter((line) => /runs-on:.*-latest\b/.test(line))
          .map((line) => `${name}: ${line.trim()}`)
      );
    expect(moving).toEqual([]);
  });
});
