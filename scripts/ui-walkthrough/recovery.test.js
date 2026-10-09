import { describe, expect, it, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunJournalStore, openRunJournalStore } from "./journal.mjs";
import { recoverUiVisualWalkthrough, summarizeRunJournal } from "./recovery.mjs";

const manifest = {
  version: 1,
  workbench: { instanceId: "instance-a" },
  scenarios: [{ id: "appearance" }],
};

async function interruptedFieldRun(current) {
  const directory = await mkdtemp(join(tmpdir(), "plvs-recovery-test-"));
  const path = join(directory, "run.json");
  const store = await createRunJournalStore(path, {
    manifest,
    manifestPath: "C:/repo/scenario.json",
    initial: { revision: 4, uiGeneration: 0, applicationIdentity: "development" },
  });
  await store.transitionRun("preparing");
  await store.transitionRun("running");
  await store.update((draft) => {
    draft.scenarios[0].resources.push({
      type: "field",
      family: "view",
      key: "surfaceOpacity",
      before: 72,
      applied: 100,
      status: "owned",
    });
  });
  await store.transitionRun("needsRecovery");
  return { path, current };
}

describe("UI walkthrough interrupted recovery", () => {
  it("restores a field only while its applied value is still owned", async () => {
    const state = await interruptedFieldRun(100);
    const patches = new Map();
    const invoke = vi.fn(async (args) => {
      const command = args.join(" ");
      if (command.startsWith("capabilities")) return { applicationIdentity: "development" };
      if (command.startsWith("view inspect")) {
        return { revision: 4, view: { surfaceOpacity: state.current } };
      }
      if (command.startsWith("inspect")) return { revision: 4 };
      if (command.startsWith("view update")) {
        state.current = patches.get(args[2]).surfaceOpacity;
        return { revision: 5 };
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    const materialize = vi.fn(async (label, patch) => {
      patches.set(label, patch);
      return label;
    });

    const summary = await recoverUiVisualWalkthrough({
      journalStore: await openRunJournalStore(state.path),
      invoke,
      materialize,
    });

    expect(state.current).toBe(72);
    expect(summary.phase).toBe("complete");
    expect(summary.scenarios).toEqual([{ id: "appearance", phase: "complete" }]);
    expect(summary.outstanding).toEqual([]);
  });

  it("preserves a field changed after the interrupted run", async () => {
    const state = await interruptedFieldRun(85);
    const invoke = vi.fn(async (args) => {
      const command = args.join(" ");
      if (command.startsWith("capabilities")) return { applicationIdentity: "development" };
      if (command.startsWith("view inspect")) {
        return { revision: 5, view: { surfaceOpacity: state.current } };
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    const store = await openRunJournalStore(state.path);

    await expect(
      recoverUiVisualWalkthrough({ journalStore: store, invoke, materialize: vi.fn() })
    ).rejects.toThrow(/preserved divergent/i);

    expect(state.current).toBe(85);
    expect(summarizeRunJournal(store.current)).toMatchObject({
      phase: "preserved",
      failure: { reason: "recoveryDiverged", resources: ["view.surfaceOpacity"] },
    });
    expect(invoke.mock.calls.some(([args]) => args.slice(0, 2).join(" ") === "view update")).toBe(
      false
    );
  });

  it("rebases one revision conflict when the touched field remains owned", async () => {
    const state = await interruptedFieldRun(100);
    const patches = new Map();
    let updates = 0;
    let revision = 4;
    const invoke = vi.fn(async (args) => {
      const command = args.join(" ");
      if (command.startsWith("capabilities")) return { applicationIdentity: "development" };
      if (command.startsWith("view inspect")) {
        return { revision, view: { surfaceOpacity: state.current } };
      }
      if (command.startsWith("inspect")) return { revision };
      if (command.startsWith("view update")) {
        updates += 1;
        if (updates === 1) {
          revision += 1;
          const error = new Error("revision changed");
          error.reason = "revisionConflict";
          throw error;
        }
        state.current = patches.get(args[2]).surfaceOpacity;
        revision += 1;
        return { revision };
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    const materialize = vi.fn(async (label, patch) => {
      patches.set(label, patch);
      return label;
    });

    const summary = await recoverUiVisualWalkthrough({
      journalStore: await openRunJournalStore(state.path),
      invoke,
      materialize,
    });

    expect(updates).toBe(2);
    expect(state.current).toBe(72);
    expect(summary.phase).toBe("complete");
  });
});
