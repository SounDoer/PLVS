import { describe, expect, it } from "vitest";
import manifest from "../src/agentControl/commandManifest.json" with { type: "json" };
import {
  ACCEPTANCE_DISPOSITIONS,
  agentControlAcceptanceCatalog,
  buildAgentControlAcceptanceCatalog,
} from "./agent-control-acceptance-catalog.mjs";

describe("Agent Control acceptance catalogue", () => {
  it("assigns every public command exactly once", () => {
    expect(agentControlAcceptanceCatalog).toHaveLength(121);
    expect(agentControlAcceptanceCatalog.map(({ commandId }) => commandId)).toEqual(
      manifest.commands.map(({ id }) => id)
    );
    expect(new Set(agentControlAcceptanceCatalog.map(({ commandId }) => commandId)).size).toBe(121);
  });

  it("uses only closed dispositions and gives external commands an owning domain", () => {
    for (const entry of agentControlAcceptanceCatalog) {
      expect(ACCEPTANCE_DISPOSITIONS).toContain(entry.disposition);
      expect(entry.scenario).toMatch(/^[a-z0-9][a-z0-9-]+$/);
      if (entry.disposition === "external") expect(entry.owner).toMatch(/^(capture|update)$/);
    }
  });

  it("fails when the public manifest gains or loses a command", () => {
    const added = structuredClone(manifest);
    added.commands.push({ ...added.commands[0], id: "future.command" });
    expect(() => buildAgentControlAcceptanceCatalog(added)).toThrow(/missing \[future.command\]/);

    const removed = structuredClone(manifest);
    removed.commands = removed.commands.filter(({ id }) => id !== "app.inspect");
    expect(() => buildAgentControlAcceptanceCatalog(removed)).toThrow(/unknown \[app.inspect\]/);
  });
});
