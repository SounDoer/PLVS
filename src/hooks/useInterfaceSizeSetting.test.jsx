/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useInterfaceSizeSetting } from "./useInterfaceSizeSetting.js";

describe("useInterfaceSizeSetting", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.style.cssText = "";
  });

  it("defaults to the enlarged Default interface profile", () => {
    const { result } = renderHook(() => useInterfaceSizeSetting());

    expect(result.current.interfaceSize).toBe("default");
    expect(document.documentElement.style.getPropertyValue("--ui-fs-body")).toBe("15px");
  });

  it("persists and applies a selected profile", async () => {
    const { result } = renderHook(() => useInterfaceSizeSetting());

    act(() => result.current.setInterfaceSize("extra-large"));

    await waitFor(() => {
      expect(result.current.interfaceSize).toBe("extra-large");
      expect(JSON.parse(localStorage.getItem("plvs:settings")).interfaceSize).toBe("extra-large");
      expect(document.documentElement.style.getPropertyValue("--ui-fs-body")).toBe("19px");
      expect(document.documentElement.style.getPropertyValue("--ui-icon-panel-action")).toBe(
        "17px"
      );
    });
  });

  it("normalizes invalid persisted values", () => {
    localStorage.setItem("plvs:settings", JSON.stringify({ interfaceSize: "huge" }));

    const { result } = renderHook(() => useInterfaceSizeSetting());

    expect(result.current.interfaceSize).toBe("default");
  });
});
