import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { releaseAssetNames } from "./release-assets.mjs";

const html = readFileSync(new URL("../landing/index.html", import.meta.url), "utf8");
const releaseScript = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];

async function renderRelease(payload, { ok = true } = {}) {
  const dom = new JSDOM(
    `
    <a id="download-version"></a>
    <div id="hero-actions"></div>
    <div id="platform-grid"></div>
  `,
    { runScripts: "outside-only", url: "https://plvs.app/" }
  );
  dom.window.fetch = vi.fn().mockResolvedValue({ ok, json: async () => payload });
  dom.window.eval(releaseScript);
  await dom.window.loadRelease();
  return dom.window.document;
}

describe("landing release links", () => {
  it("resolves the installer and portable ZIP from real release asset names", async () => {
    const names = releaseAssetNames("0.16.0");
    const assets = [
      { name: names.windowsPortable, browser_download_url: "https://downloads/portable.zip" },
      { name: names.windowsInstaller, browser_download_url: "https://downloads/setup.exe" },
      { name: names.macosDmg, browser_download_url: "https://downloads/plvs.dmg" },
      {
        name: "PLVS-v0.16.0-x64-portable.exe",
        browser_download_url: "https://downloads/wrong.exe",
      },
    ];

    const document = await renderRelease({ tag_name: "v0.16.0", assets });
    expect(document.querySelector("#download-version").textContent).toBe("v0.16.0");
    expect(document.querySelector("#download-version").href).toBe(
      "https://github.com/SounDoer/PLVS/releases/tag/v0.16.0"
    );
    const windowsCard = document.querySelector(".windows-card");
    expect(windowsCard.querySelector(".btn").href).toBe("https://downloads/setup.exe");
    expect(windowsCard.querySelector(".portable-link").href).toBe("https://downloads/portable.zip");
  });

  it("falls back to GitHub Releases when the API or an asset is unavailable", async () => {
    const names = releaseAssetNames("0.16.0");
    const document = await renderRelease({
      tag_name: "v0.16.0",
      assets: [
        { name: names.windowsInstaller, browser_download_url: "https://downloads/setup.exe" },
      ],
    });
    const windowsCard = document.querySelector(".windows-card");
    expect(windowsCard.querySelector(".portable-link").href).toBe(
      "https://github.com/SounDoer/PLVS/releases"
    );

    const failedDocument = await renderRelease({}, { ok: false });
    expect(failedDocument.querySelector("#download-version").textContent).toBe("Latest release");
    expect(failedDocument.querySelector("#download-version").href).toBe(
      "https://github.com/SounDoer/PLVS/releases"
    );
    expect(failedDocument.querySelector(".windows-card .btn").href).toBe(
      "https://github.com/SounDoer/PLVS/releases"
    );
  });
});
