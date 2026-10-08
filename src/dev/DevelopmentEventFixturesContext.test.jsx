/** @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { BlockingEditorsProvider } from "../hooks/BlockingEditorsContext.jsx";
import { UiNavigationProvider, useUiSurface } from "../uiNavigation/UiNavigationContext.jsx";
import {
  DevelopmentEventFixturesProvider,
  useDevelopmentEventFixtureAdapter,
  useDevelopmentEventFixtures,
} from "./DevelopmentEventFixturesContext.jsx";

function wrapper({ children }) {
  return (
    <BlockingEditorsProvider>
      <UiNavigationProvider getRevision={() => 4} settlementTimeoutMs={100}>
        <DevelopmentEventFixturesProvider enabled getRevision={() => 4} settlementTimeoutMs={100}>
          {children}
        </DevelopmentEventFixturesProvider>
      </UiNavigationProvider>
    </BlockingEditorsProvider>
  );
}

function useCloseFixtureHarness() {
  const [fixtureId, setFixtureId] = useState(null);
  const fixtureIdRef = useRef(fixtureId);
  fixtureIdRef.current = fixtureId;
  const establish = useRef(vi.fn((id) => setFixtureId(id))).current;
  const reset = useRef(
    vi.fn((id) => {
      if (id === fixtureIdRef.current) setFixtureId(null);
    })
  ).current;
  useDevelopmentEventFixtureAdapter("close-confirmation.requested", {
    establish,
    reset,
    matches: (id) => fixtureId === id,
    surface: { kind: "closeConfirmation", target: { phase: "decision" } },
  });
  useUiSurface({
    active: fixtureId !== null,
    kind: "closeConfirmation",
    origin: "event",
    blocking: true,
    dismissible: true,
    supportedActions: ["cancel"],
    target: { phase: "decision" },
    onCancel: () => setFixtureId(null),
  });
  return { fixtures: useDevelopmentEventFixtures(), establish, reset };
}

function unsettledWrapper({ children }) {
  return (
    <BlockingEditorsProvider>
      <UiNavigationProvider getRevision={() => 4} settlementTimeoutMs={5}>
        <DevelopmentEventFixturesProvider enabled getRevision={() => 4} settlementTimeoutMs={5}>
          {children}
        </DevelopmentEventFixturesProvider>
      </UiNavigationProvider>
    </BlockingEditorsProvider>
  );
}

function useUnsettledFixtureHarness() {
  const [fixtureId, setFixtureId] = useState(null);
  const reset = useRef(vi.fn()).current;
  useDevelopmentEventFixtureAdapter("close-confirmation.requested", {
    establish: setFixtureId,
    reset,
    matches: (id) => fixtureId === id,
    surface: { kind: "closeConfirmation", target: { phase: "decision" } },
  });
  return { fixtures: useDevelopmentEventFixtures(), fixtureId, reset };
}

describe("development event fixture controller", () => {
  it("establishes one exact fixture, settles on the production surface, and is idempotent", async () => {
    const { result } = renderHook(useCloseFixtureHarness, { wrapper });
    let pending;
    await act(async () => {
      pending = result.current.fixtures.establish({
        name: "close-confirmation.requested",
        expectedRevision: 4,
        expectedUiGeneration: 0,
      });
      await Promise.resolve();
    });
    const established = await /** @type {Promise<any>} */ (pending);
    expect(established).toMatchObject({
      changed: true,
      committed: true,
      name: "close-confirmation.requested",
      revision: 4,
      surface: { kind: "closeConfirmation", target: { phase: "decision" } },
    });
    expect(established.fixtureId).toMatch(/^fixture-/);
    expect(result.current.establish).toHaveBeenCalledTimes(1);

    const repeated = await result.current.fixtures.establish({
      name: "close-confirmation.requested",
      expectedRevision: 4,
      expectedUiGeneration: established.uiGeneration,
    });
    expect(repeated.changed).toBe(false);
    expect(repeated.fixtureId).toBe(established.fixtureId);
    expect(result.current.establish).toHaveBeenCalledTimes(1);
  });

  it("requires exact current tokens and exact reset identity", async () => {
    const { result } = renderHook(useCloseFixtureHarness, { wrapper });
    await expect(
      result.current.fixtures.establish({
        name: "close-confirmation.requested",
        expectedRevision: 3,
        expectedUiGeneration: 0,
      })
    ).rejects.toMatchObject({ reason: "revisionConflict" });
    await expect(
      result.current.fixtures.establish({
        name: "close-confirmation.requested",
        expectedRevision: 4,
        expectedUiGeneration: 9,
      })
    ).rejects.toMatchObject({ reason: "uiGenerationConflict" });

    let pending;
    await act(async () => {
      pending = result.current.fixtures.establish({
        name: "close-confirmation.requested",
        expectedRevision: 4,
        expectedUiGeneration: 0,
      });
      await Promise.resolve();
    });
    const established = await /** @type {Promise<any>} */ (pending);
    await expect(
      result.current.fixtures.reset({
        fixtureId: "fixture-bbbbbbbbbbbbbbbb",
        expectedRevision: 4,
        expectedUiGeneration: established.uiGeneration,
      })
    ).rejects.toMatchObject({ reason: "fixtureNotFound" });

    let resetPending;
    await act(async () => {
      resetPending = result.current.fixtures.reset({
        fixtureId: established.fixtureId,
        expectedRevision: 4,
        expectedUiGeneration: established.uiGeneration,
      });
      await Promise.resolve();
    });
    const reset = await /** @type {Promise<any>} */ (resetPending);
    expect(reset).toMatchObject({ changed: true, committed: true, revision: 4 });
    expect(result.current.reset).toHaveBeenCalledWith(established.fixtureId);
  });

  it("refuses a second fixture or real event without replacing the visible scene", async () => {
    const { result } = renderHook(useCloseFixtureHarness, { wrapper });
    let pending;
    await act(async () => {
      pending = result.current.fixtures.establish({
        name: "close-confirmation.requested",
        expectedRevision: 4,
        expectedUiGeneration: 0,
      });
      await Promise.resolve();
    });
    const established = await /** @type {Promise<any>} */ (pending);
    await expect(
      result.current.fixtures.establish({
        name: "crash-report.pending",
        expectedRevision: 4,
        expectedUiGeneration: established.uiGeneration,
      })
    ).rejects.toMatchObject({ reason: "fixtureConflict" });
    expect(result.current.establish).toHaveBeenCalledTimes(1);
  });

  it("reports a committed fixture and preserves it when the public surface cannot settle", async () => {
    const { result } = renderHook(useUnsettledFixtureHarness, { wrapper: unsettledWrapper });
    /** @type {any} */
    let failure;
    await act(async () => {
      try {
        await result.current.fixtures.establish({
          name: "close-confirmation.requested",
          expectedRevision: 4,
          expectedUiGeneration: 0,
        });
      } catch (error) {
        failure = error;
      }
    });

    expect(failure).toMatchObject({
      reason: "uiNotSettled",
      details: {
        committed: true,
        name: "close-confirmation.requested",
        fixtureId: expect.stringMatching(/^fixture-/),
      },
    });
    expect(result.current.fixtureId).toBe(failure.details.fixtureId);
    expect(result.current.reset).not.toHaveBeenCalled();
  });
});
