import { describe, expect, it } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createRunJournal,
  createRunJournalStore,
  readRunJournal,
  transitionRunJournal,
  transitionScenarioJournal,
  updateRunJournal,
  validateRunJournal,
  writeRunJournal,
} from "./journal.mjs";

const manifest = {
  version: 1,
  workbench: { instanceId: "instance-a" },
  scenarios: [{ id: "appearance" }],
};

function createJournal() {
  return createRunJournal({
    manifest,
    manifestPath: "C:/repo/scenario.json",
    initial: { revision: 4, uiGeneration: 2, applicationIdentity: "development" },
  });
}

describe("UI walkthrough recovery journal", () => {
  it("allows only explicit run and scenario phase transitions", () => {
    let journal = createJournal();
    journal = transitionRunJournal(journal, "preparing");
    journal = transitionScenarioJournal(journal, "appearance", "preparing");
    journal = transitionScenarioJournal(journal, "appearance", "running");

    expect(journal.phase).toBe("preparing");
    expect(journal.scenarios[0].phase).toBe("running");
    expect(() => transitionRunJournal(journal, "complete")).toThrow(/invalid run phase/i);
    expect(() => transitionScenarioJournal(journal, "appearance", "complete")).toThrow(
      /invalid scenario phase/i
    );
  });

  it("atomically persists a validated private journal", async () => {
    const directory = await mkdtemp(join(tmpdir(), "plvs-journal-test-"));
    const path = join(directory, "run.json");
    let journal = createJournal();
    journal = updateRunJournal(journal, (draft) => {
      draft.scenarios[0].resources.push({
        type: "field",
        family: "view",
        key: "surfaceOpacity",
        before: 72,
        applied: 100,
        status: "intent",
      });
    });

    await writeRunJournal(path, journal);

    expect(await readRunJournal(path)).toEqual(journal);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(journal);
  });

  it("rejects malformed recovery input", () => {
    const journal = createJournal();
    journal.workbench.instanceId = null;
    expect(validateRunJournal(journal)).toContain("workbench.instanceId is required.");

    const unknownResource = createJournal();
    unknownResource.scenarios[0].resources.push({ type: "command", status: "owned" });
    expect(validateRunJournal(unknownResource)).toContain("scenario resource type is invalid.");
  });

  it("persists every store transition before returning", async () => {
    const directory = await mkdtemp(join(tmpdir(), "plvs-journal-store-test-"));
    const path = join(directory, "run.json");
    const store = await createRunJournalStore(path, {
      manifest,
      manifestPath: "C:/repo/scenario.json",
      initial: { revision: 4, uiGeneration: 2 },
    });

    await store.transitionRun("preparing");
    await store.update((draft) => {
      draft.failure = { reason: "injected" };
    });

    expect((await readRunJournal(path)).phase).toBe("preparing");
    expect(store.current.failure).toEqual({ reason: "injected" });
  });
});
