import { afterEach, describe, expect, it, vi } from "vitest";
import { SETTLEMENT_TIMEOUT_MS } from "./failures.js";
import { createSettlementRegistry, SETTLEMENT_SLOTS } from "./settlement.js";

afterEach(() => vi.useRealTimers());

describe("createSettlementRegistry", () => {
  it("resolves an armed slot with the revision current at that moment", async () => {
    let revision = 3;
    const registry = createSettlementRegistry({ current: () => revision });
    const committed = registry.arm("settings", { signature: "s" });
    expect(registry.peek("settings").signature).toBe("s");
    revision = 4;
    registry.resolve("settings");
    await expect(registry.observed("settings", committed, "The Settings change")).resolves.toBe(4);
    expect(registry.peek("settings")).toBeNull();
  });

  it("fails with commitNotObserved and clears the slot after the settlement timeout", async () => {
    vi.useFakeTimers();
    const registry = createSettlementRegistry({ current: () => 0 });
    const committed = registry.arm("dock", { matches: () => false });
    const assertion = expect(
      registry.observed("dock", committed, "The Dock change")
    ).rejects.toMatchObject({
      reason: "commitNotObserved",
      code: -32031,
      message: `The Dock change was applied but the commit was not observed within ${SETTLEMENT_TIMEOUT_MS} ms.`,
      details: { stateCommitted: true },
    });
    await vi.advanceTimersByTimeAsync(SETTLEMENT_TIMEOUT_MS);
    await assertion;
    expect(registry.peek("dock")).toBeNull();
  });

  it("rejects every pending slot on unmount, Device included", async () => {
    const registry = createSettlementRegistry({ current: () => 0 });
    const pending = SETTLEMENT_SLOTS.map((name) => registry.arm(name, {}));
    registry.rejectAll(new Error("Agent-control bridge unmounted."));
    const settled = await Promise.allSettled(pending);
    expect(settled.map(({ status }) => status)).toEqual(SETTLEMENT_SLOTS.map(() => "rejected"));
    expect(SETTLEMENT_SLOTS).toContain("device");
    for (const name of SETTLEMENT_SLOTS) expect(registry.peek(name)).toBeNull();
  });

  it("does nothing when asked to resolve an empty slot", () => {
    const registry = createSettlementRegistry({ current: () => 0 });
    expect(() => registry.resolve("view")).not.toThrow();
  });

  it("refuses a slot the domain table does not define", () => {
    const registry = createSettlementRegistry({ current: () => 0 });
    expect(() => registry.arm("sidebar", {})).toThrow("Unknown settlement slot: sidebar");
  });
});
