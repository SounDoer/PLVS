import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const tauriConfig = JSON.parse(
  readFileSync(join(process.cwd(), "src-tauri", "tauri.conf.json"), "utf8")
);
const tauriWindowsConfig = JSON.parse(
  readFileSync(join(process.cwd(), "src-tauri", "tauri.windows.conf.json"), "utf8")
);
const nsisInstallerHooks = readFileSync(
  join(process.cwd(), "src-tauri", "nsis", "installer-hooks.nsh"),
  "utf8"
);
const nsisAgentDiscovery = readFileSync(
  join(process.cwd(), "src-tauri", "nsis", "agent-discovery.nsh"),
  "utf8"
);
const agentManifest = JSON.parse(
  readFileSync(join(process.cwd(), "src-tauri", "plvs-agent.json"), "utf8")
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

  it("allows dev update checks to GitHub releases", () => {
    expect(tauriConfig.app.security.devCsp).toEqual(
      expect.stringContaining("https://api.github.com")
    );
  });

  it("allows opening PLVS release links in the system browser", () => {
    const opener = defaultCapability.permissions.find(
      (permission) => permission?.identifier === "opener:allow-open-url"
    );
    expect(opener?.allow).toEqual(
      expect.arrayContaining([
        { url: "https://github.com/SounDoer/PLVS/releases" },
        { url: "https://github.com/SounDoer/PLVS/releases/*" },
      ])
    );
  });

  it("scopes default capabilities to known app windows", () => {
    expect(defaultCapability.windows).toContain("main");
    expect(defaultCapability.windows).not.toContain("*");
  });

  it("keeps the Windows installer current-user scoped", () => {
    expect(tauriWindowsConfig.bundle.windows.nsis.installMode).toBe("currentUser");
  });

  it("uses the PLVS icon for the Windows installer and uninstaller", () => {
    expect(tauriWindowsConfig.bundle.windows.nsis.installerIcon).toBe("icons/icon.ico");
    expect(tauriWindowsConfig.bundle.windows.nsis.uninstallerIcon).toBe("icons/icon.ico");
  });

  it("keeps desktop shortcut creation opt-in on the NSIS finish page", () => {
    expect(tauriWindowsConfig.bundle.windows.nsis.installerHooks).toBe("nsis/installer-hooks.nsh");
    expect(nsisInstallerHooks).toContain("MUI_FINISHPAGE_SHOWREADME_NOTCHECKED");
  });

  it("ships an agent discovery manifest with per-platform CLI paths", () => {
    expect(tauriConfig.bundle.resources).toContain("plvs-agent.json");
    expect(agentManifest).toMatchObject({
      schemaVersion: 2,
      productName: "PLVS",
      identifier: tauriConfig.identifier,
      version: tauriConfig.version,
      cli: {
        relativePath: {
          windows: "plvs-cli.exe",
          macos: "Contents/MacOS/plvs-cli",
        },
        doctor: ["doctor", "--json"],
      },
    });
  });

  it("writes installed CLI discovery to current-user Windows registry", () => {
    expect(nsisInstallerHooks).toContain("BEGIN GENERATED PLVS AGENT DISCOVERY");
    expect(nsisInstallerHooks).toContain(`!define PLVS_AGENT_VERSION "${tauriConfig.version}"`);
    expect(nsisInstallerHooks).toContain('!define PLVS_AGENT_REG_KEY "Software\\SounDoer\\PLVS"');
    expect(nsisInstallerHooks).toContain("NSIS_HOOK_POSTINSTALL");
    expect(nsisInstallerHooks).toContain('WriteRegStr HKCU "${PLVS_AGENT_REG_KEY}" "CliPath"');
    expect(nsisInstallerHooks).toContain("NSIS_HOOK_POSTUNINSTALL");
    expect(nsisInstallerHooks).toContain('DeleteRegKey HKCU "${PLVS_AGENT_REG_KEY}"');
    expect(nsisAgentDiscovery).toContain(`!define PLVS_AGENT_VERSION "${tauriConfig.version}"`);
    expect(nsisAgentDiscovery).toContain('!define PLVS_AGENT_REG_KEY "Software\\SounDoer\\PLVS"');
  });
});
