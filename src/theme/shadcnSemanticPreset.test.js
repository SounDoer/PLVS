import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildThemeFallbackCss,
  oklchToHex,
  oklchSafe,
  applyShadcnSemanticTokensToDocument,
} from "./shadcnSemanticPreset";

describe("oklchToHex", () => {
  it("converts pure black oklch(0 0 0) to #000000", () => {
    expect(oklchToHex("oklch(0 0 0)")).toBe("#000000");
  });

  it("converts pure white oklch(1 0 0) to #ffffff", () => {
    expect(oklchToHex("oklch(1 0 0)")).toBe("#ffffff");
  });

  it("converts dark neutral gray oklch(0.145 0 0) to a near-black neutral (#0a0a0a)", () => {
    const hex = oklchToHex("oklch(0.145 0 0)");
    expect(hex).toBe("#0a0a0a");
  });

  it("converts oklch with alpha to rgba", () => {
    expect(oklchToHex("oklch(1 0 0 / 10%)")).toBe("rgba(255, 255, 255, 0.1)");
  });
});

describe("oklchSafe", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("passes non-oklch values through unchanged", () => {
    expect(oklchSafe("#22d3ee")).toBe("#22d3ee");
    expect(oklchSafe("rgba(255,255,255,0.1)")).toBe("rgba(255,255,255,0.1)");
  });

  it("converts oklch to hex when CSS doesn't support oklch", () => {
    vi.stubGlobal("CSS", { supports: () => false });
    expect(oklchSafe("oklch(0 0 0)")).toBe("#000000");
    expect(oklchSafe("oklch(1 0 0 / 10%)")).toBe("rgba(255, 255, 255, 0.1)");
  });

  it("passes oklch through when CSS supports oklch", () => {
    vi.stubGlobal("CSS", { supports: () => true });
    expect(oklchSafe("oklch(0 0 0)")).toBe("oklch(0 0 0)");
  });
});

describe("applyShadcnSemanticTokensToDocument", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.style.removeProperty("--background");
    document.documentElement.style.removeProperty("--primary");
  });

  it("sets hex fallback on DOM when CSS doesn't support oklch", () => {
    vi.stubGlobal("CSS", { supports: () => false });
    applyShadcnSemanticTokensToDocument({ background: "oklch(0.145 0 0)" });
    const val = document.documentElement.style.getPropertyValue("--background");
    expect(val).toBe("#0a0a0a");
  });

  it("passes non-oklch value to DOM unchanged", () => {
    applyShadcnSemanticTokensToDocument({ primary: "#22d3ee" });
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe("#22d3ee");
  });
});

// Minimal semantic used across tests
const BASE = { primary: "#22d3ee", primaryForeground: "oklch(0.145 0 0)" };

describe("buildThemeFallbackCss", () => {
  it("emits non-oklch value unchanged in base :root block", () => {
    const css = buildThemeFallbackCss({ primary: "#22d3ee" }, "0.5rem");
    expect(css).toMatch(/:root \{[^}]*--primary: #22d3ee/s);
  });

  it("emits a hex fallback for an oklch value inside the base :root block", () => {
    const css = buildThemeFallbackCss({ background: "oklch(0 0 0)" }, "0.5rem");
    const baseRoot = css.match(/:root \{([^}]+)\}/s)?.[1] ?? "";
    expect(baseRoot).toMatch(/--background:\s*#[0-9a-f]{6}/i);
  });

  it("emits oklch value inside a @supports block with original value", () => {
    const css = buildThemeFallbackCss({ background: "oklch(0 0 0)" }, "0.5rem");
    expect(css).toMatch(/@supports \(color: oklch\(0 0 0\)\)/);
    expect(css).toMatch(/--background:\s*oklch\(0 0 0\)/);
  });

  it("emits rgba fallback for oklch value with alpha percentage", () => {
    const css = buildThemeFallbackCss({ border: "oklch(1 0 0 / 10%)" }, "0.5rem");
    const baseRoot = css.match(/:root \{([^}]+)\}/s)?.[1] ?? "";
    expect(baseRoot).toMatch(/--border:\s*rgba\(255,\s*255,\s*255,\s*0\.1\)/);
  });

  it("collects all oklch tokens in a single @supports block", () => {
    const css = buildThemeFallbackCss(
      { background: "oklch(0 0 0)", foreground: "oklch(1 0 0)" },
      "0.5rem"
    );
    const count = (css.match(/@supports/g) ?? []).length;
    expect(count).toBe(1);
    expect(css).toMatch(/--background:\s*oklch\(0 0 0\)/);
    expect(css).toMatch(/--foreground:\s*oklch\(1 0 0\)/);
  });
});
