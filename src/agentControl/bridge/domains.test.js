import { describe, expect, it, vi } from "vitest";
import { createDomainRunner, DOMAIN_NAMES } from "./domains.js";
import { createRevisionClock } from "./revisionClock.js";
import { createSettlementRegistry } from "./settlement.js";

function baseInputs(overrides = {}) {
  return {
    viewContext: { view: {} },
    workspace: {
      tree: null,
      panelsById: {},
      panelOrder: [],
      panelControlsById: {},
      pinnedPanelsById: {},
      axisViewports: {},
    },
    presets: { list: [], activeId: null, dirty: false },
    themeState: { appearance: { mode: "system" }, themes: [] },
    themeControl: null,
    themeSignature: "theme-0",
    loudnessSignature: "loudness-0",
    settings: { openAtLogin: false, clearShortcut: null, channelLabels: { mode: "auto" } },
    settingsContext: { autostartReady: true, clearShortcutReady: true },
    transport: {
      source: "live",
      live: { state: "stopped" },
      files: { sessions: [] },
      snapshot: { active: false },
    },
    device: null,
    dock: { enabled: false },
    visual: null,
    ...overrides,
  };
}

function setup() {
  const clock = createRevisionClock({ onWake: () => {} });
  const settlement = createSettlementRegistry(clock);
  const inputs = baseInputs();
  const observeCommit = createDomainRunner({
    clock,
    settlement,
    recordings: new Map(),
    initialInputs: inputs,
  });
  observeCommit(inputs);
  return { clock, settlement, inputs, observeCommit };
}

describe("createDomainRunner", () => {
  it("keeps the order of the effects it replaces", () => {
    expect(DOMAIN_NAMES).toEqual([
      "view",
      "workspace",
      "presets",
      "theme",
      "loudnessProfile",
      "settings",
      "transport",
      "device",
      "dock",
    ]);
  });

  it("does not advance the revision on the first commit or on an unchanged one", () => {
    const { clock, inputs, observeCommit } = setup();
    observeCommit({ ...inputs });
    expect(clock.current()).toBe(0);
  });

  it("advances the revision when a domain's public state changes", () => {
    const { clock, inputs, observeCommit } = setup();
    observeCommit({ ...inputs, presets: { list: [], activeId: "p1", dirty: false } });
    expect(clock.current()).toBe(1);
  });

  it("does not examine a domain whose inputs did not change", () => {
    const { settlement, inputs, observeCommit } = setup();
    const matches = vi.fn(() => true);
    settlement.arm("dock", { matches }).catch(() => {});
    observeCommit({ ...inputs, presets: { list: [], activeId: "p1", dirty: false } });
    expect(matches).not.toHaveBeenCalled();
    expect(settlement.peek("dock")).not.toBeNull();
  });

  it("resolves a domain's settlement once its inputs render the expected state", async () => {
    const { settlement, inputs, observeCommit } = setup();
    const committed = settlement.arm("dock", { matches: (dock) => dock.enabled === true });
    observeCommit({ ...inputs, dock: { enabled: true } });
    await expect(committed).resolves.toBe(1);
  });

  it("advances once when an import lands in two libraries in one commit", async () => {
    const { clock, settlement, inputs, observeCommit } = setup();
    const committed = settlement.arm("library", { families: ["preset", "loudnessProfile"] });
    observeCommit({
      ...inputs,
      presets: { list: [{ id: "p1" }], activeId: null, dirty: false },
      loudnessSignature: "loudness-1",
    });
    await expect(committed).resolves.toBe(1);
    expect(clock.current()).toBe(1);
  });

  it("leaves a library settlement alone when a library it did not write changes", () => {
    const { settlement, inputs, observeCommit } = setup();
    settlement.arm("library", { families: ["theme"] }).catch(() => {});
    observeCommit({ ...inputs, loudnessSignature: "loudness-1" });
    expect(settlement.peek("library")).not.toBeNull();
  });

  it("waits for both stores of a Loudness Profile change that also rewrites Presets", async () => {
    const { settlement, inputs, observeCommit } = setup();
    const presets = { list: [{ id: "p1" }], activeId: null, dirty: false };
    const committed = settlement.arm("loudnessProfile", {
      expected: {
        loudnessProfile: "loudness-1",
        presets: JSON.stringify({ list: presets.list, activeId: null, dirty: false }),
      },
      observed: new Set(),
    });
    observeCommit({ ...inputs, loudnessSignature: "loudness-1" });
    expect(settlement.peek("loudnessProfile")).not.toBeNull();
    observeCommit({ ...inputs, loudnessSignature: "loudness-1", presets });
    await expect(committed).resolves.toEqual(expect.any(Number));
  });
});
