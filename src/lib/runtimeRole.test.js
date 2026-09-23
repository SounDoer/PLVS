/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  isParticipantInstance,
  ownsCoordinatorResources,
  setCoordinatorRole,
  useCoordinatorRole,
} from "./runtimeRole.js";

describe("runtime coordinator role", () => {
  afterEach(() => {
    delete window.__PLVS_INITIAL_STATE__;
    setCoordinatorRole(undefined);
  });

  it("notifies mounted resource owners when a participant is promoted", () => {
    window.__PLVS_INITIAL_STATE__ = { isCoordinator: false };
    const { result } = renderHook(() => useCoordinatorRole());

    expect(result.current).toBe(false);
    expect(isParticipantInstance()).toBe(true);

    act(() => setCoordinatorRole(true));

    expect(result.current).toBe(true);
    expect(ownsCoordinatorResources()).toBe(true);
    expect(isParticipantInstance()).toBe(false);
  });
});
