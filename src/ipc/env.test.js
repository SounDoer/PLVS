import { afterEach, describe, expect, it, vi } from "vitest";
import { assertTauriBuildEnvironment } from "./env.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("assertTauriBuildEnvironment", () => {
  it("throws inside a Tauri webview when the build lacks the Tauri environment", () => {
    vi.stubEnv("TAURI_ENV_PLATFORM", "");
    vi.stubEnv("TAURI_PLATFORM", "");
    expect(() => assertTauriBuildEnvironment({ __TAURI_INTERNALS__: {} })).toThrow(
      /TAURI_ENV_PLATFORM/
    );
  });

  it("passes inside a Tauri webview built with the Tauri environment", () => {
    vi.stubEnv("TAURI_ENV_PLATFORM", "windows");
    expect(() => assertTauriBuildEnvironment({ __TAURI_INTERNALS__: {} })).not.toThrow();
  });

  it("passes in a plain browser", () => {
    vi.stubEnv("TAURI_ENV_PLATFORM", "");
    vi.stubEnv("TAURI_PLATFORM", "");
    expect(() => assertTauriBuildEnvironment({})).not.toThrow();
  });
});
