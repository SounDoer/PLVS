/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { MeterRuntimeProvider } from "./MeterRuntimeContext.jsx";
import { SourceProvider, useSource } from "./SourceContext.jsx";

function wrapper({ children }) {
  return (
    <MeterRuntimeProvider>
      <SourceProvider>{children}</SourceProvider>
    </MeterRuntimeProvider>
  );
}

describe("SourceProvider", () => {
  it("reports no connected source in a browser build", () => {
    const { result } = renderHook(() => useSource(), { wrapper });

    expect(result.current.selectedSource).toBeNull();
    expect(result.current.sourceDisplayName).toBeNull();
    expect(result.current.footerSourceLabel).toBe("Not connected");
    expect(result.current.captureFormatSignature).toBe("");
    expect(result.current.audioOutputs).toEqual([]);
    expect(result.current.audioInputs).toEqual([]);
    expect(typeof result.current.onSelectCaptureDevice).toBe("function");
  });

  it("refuses the hook outside the provider", () => {
    expect(() => renderHook(() => useSource())).toThrow(
      "useSource must be used inside SourceProvider"
    );
  });
});
