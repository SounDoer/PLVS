import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const tauriConfig = JSON.parse(
  readFileSync(join(process.cwd(), "src-tauri", "tauri.conf.json"), "utf8")
);
const defaultCapability = JSON.parse(
  readFileSync(join(process.cwd(), "src-tauri", "capabilities", "default.json"), "utf8")
);

describe("Tauri security configuration", () => {
  it("keeps a production CSP enabled", () => {
    expect(tauriConfig.app.security.csp).toEqual(expect.stringContaining("default-src 'self'"));
  });

  it("keeps local Vite HMR available only in dev CSP", () => {
    expect(tauriConfig.app.security.csp).not.toContain("ws://localhost");
    expect(tauriConfig.app.security.devCsp).toEqual(expect.stringContaining("ws://localhost:1421"));
  });

  it("allows production update checks to GitHub releases", () => {
    expect(tauriConfig.app.security.csp).toEqual(
      expect.stringContaining("connect-src ipc: http://ipc.localhost https://api.github.com")
    );
  });

  it("allows opening PLVS release links in the system browser", () => {
    expect(defaultCapability.permissions).toContainEqual({
      identifier: "opener:allow-open-url",
      allow: [{ url: "https://github.com/SounDoer/PLVS/releases/*" }],
    });
  });

  it("scopes default capabilities to known app windows", () => {
    expect(defaultCapability.windows).toContain("main");
    expect(defaultCapability.windows).not.toContain("*");
  });
});
