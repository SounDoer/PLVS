import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { BUILTIN_THEMES_V2 } from "../src/theme/builtinThemesV2.js";
import { compileTheme } from "../src/theme/compileTheme.js";

export const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
export const defaultManifestPath = join(
  repositoryRoot,
  "scripts",
  "theme-gallery",
  "manifest.json"
);

export async function readGalleryManifest(path = defaultManifestPath) {
  return JSON.parse(await readFile(path, "utf8"));
}

export function validateGalleryManifest(manifest) {
  const issues = [];
  if (manifest?.version !== 1) issues.push("$.version must be 1.");
  for (const section of ["semantic", "product"]) {
    const themes = manifest?.[section]?.themes;
    if (!Array.isArray(themes) || themes.length === 0) {
      issues.push(`$.${section}.themes must be a non-empty array.`);
      continue;
    }
    for (const id of themes) {
      if (!BUILTIN_THEMES_V2[id]) issues.push(`$.${section}.themes contains unknown Theme ${id}.`);
    }
  }
  const scenes = manifest?.product?.scenes;
  if (
    manifest?.product?.compositor?.mode !== "opaque-baseline" ||
    manifest?.product?.compositor?.surfaceOpacity !== 100
  ) {
    issues.push("$.product.compositor must define the 100% opaque baseline.");
  }
  if (!Array.isArray(scenes) || scenes.length === 0) {
    issues.push("$.product.scenes must be a non-empty array.");
  } else {
    const ids = new Set();
    for (const [index, scene] of scenes.entries()) {
      if (typeof scene.id !== "string" || !scene.id)
        issues.push(`$.product.scenes[${index}].id is required.`);
      else if (ids.has(scene.id))
        issues.push(`$.product.scenes[${index}].id duplicates ${scene.id}.`);
      else ids.add(scene.id);
      if (!["empty", "file"].includes(scene.state))
        issues.push(`$.product.scenes[${index}].state is invalid.`);
      if (!["main", "workspace", "panel"].includes(scene.target))
        issues.push(`$.product.scenes[${index}].target is invalid.`);
      if (scene.target === "panel" && typeof scene.panelId !== "string")
        issues.push(`$.product.scenes[${index}].panelId is required.`);
      if (
        scene.axisPatch &&
        (!["frequency", "time"].includes(scene.axisPatch.kind) ||
          !scene.axisPatch.range ||
          typeof scene.axisPatch.range !== "object")
      ) {
        issues.push(`$.product.scenes[${index}].axisPatch is invalid.`);
      }
      if (!Array.isArray(scene.covers) || scene.covers.length === 0)
        issues.push(`$.product.scenes[${index}].covers is required.`);
    }
  }
  return issues;
}

function hexChannels(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function luminance(hex) {
  const values = hexChannels(hex).map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}

export function contrastRatio(a, b) {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

function colorOf(value) {
  return typeof value === "string" ? value : value.color;
}

function escapeXml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function swatch(x, y, width, height, fill, label, foreground, border = "none") {
  return `<g><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="10" fill="${fill}" stroke="${border}"/><text x="${x + 14}" y="${y + 25}" fill="${foreground}" font-size="14" font-weight="600">${escapeXml(label)}</text><text x="${x + 14}" y="${y + height - 14}" fill="${foreground}" font-size="12" opacity="0.78">${escapeXml(fill)}</text></g>`;
}

export function buildSemanticGallerySvg(themeId, manifest) {
  const resolved = compileTheme(BUILTIN_THEMES_V2[themeId]);
  const width = manifest.semantic.width;
  const height = manifest.semantic.height;
  const role = (id) => colorOf(resolved.roles[id]);
  const workspace = role("core.workspace");
  const panel = role("interface.surface.panel");
  const primary = role("interface.text.primary");
  const secondary = role("interface.text.secondary");
  const annotation = role("interface.text.annotation");
  const border = role("interface.border.default");
  const sections = [];
  sections.push(`<rect width="${width}" height="${height}" fill="${workspace}"/>`);
  sections.push(
    `<text x="48" y="60" fill="${primary}" font-size="28" font-weight="700">Semantic Gallery · ${escapeXml(resolved.name)}</text>`
  );
  sections.push(
    `<text x="48" y="88" fill="${secondary}" font-size="14">Compiler output · Theme ${escapeXml(themeId)} · Manifest v${manifest.version}</text>`
  );
  sections.push(
    `<rect x="40" y="116" width="1360" height="210" rx="18" fill="${panel}" stroke="${border}"/>`
  );
  sections.push(
    `<text x="64" y="154" fill="${primary}" font-size="18" font-weight="700">Surfaces</text>`
  );
  const surfaceRoles = [
    ["Workspace", "core.workspace"],
    ["Panel", "interface.surface.panel"],
    ["Raised", "interface.surface.raised"],
    ["Control", "interface.surface.control"],
    ["Muted", "interface.surface.muted"],
    ["Selected", "interface.surface.selected"],
  ];
  surfaceRoles.forEach(([label, id], index) =>
    sections.push(swatch(64 + index * 218, 174, 198, 124, role(id), label, primary, border))
  );

  sections.push(
    `<rect x="40" y="350" width="660" height="250" rx="18" fill="${panel}" stroke="${border}"/>`
  );
  sections.push(
    `<text x="64" y="390" fill="${primary}" font-size="18" font-weight="700">Text &amp; Content</text>`
  );
  sections.push(
    `<text x="64" y="438" fill="${primary}" font-size="22" font-weight="700">Primary value  −14.2 LUFS</text>`
  );
  sections.push(
    `<text x="64" y="478" fill="${secondary}" font-size="16">Secondary description and metadata</text>`
  );
  sections.push(
    `<text x="64" y="516" fill="${annotation}" font-size="12" font-weight="600">ANNOTATION · Hz · dBFS · 00:12.500</text>`
  );
  sections.push(
    swatch(
      64,
      540,
      180,
      42,
      role("core.interfaceAccent"),
      "Accent",
      role("interface.content.onAccent"),
      border
    )
  );
  sections.push(
    swatch(258, 540, 180, 42, role("palette.status.warning"), "Warning", primary, border)
  );
  sections.push(
    swatch(
      452,
      540,
      180,
      42,
      role("palette.interface.danger"),
      "Danger",
      role("interface.content.onDanger"),
      border
    )
  );

  sections.push(
    `<rect x="724" y="350" width="676" height="250" rx="18" fill="${panel}" stroke="${border}"/>`
  );
  sections.push(
    `<text x="748" y="390" fill="${primary}" font-size="18" font-weight="700">Data, Status &amp; Frequency</text>`
  );
  const data = [
    ["Primary", "core.primaryData"],
    ["Secondary", "core.secondaryData"],
    ["Snapshot", "data.snapshot.primary"],
    ["Selection", "data.selection"],
    ["Safe", "palette.status.safe"],
    ["Warning", "palette.status.warning"],
    ["Critical", "palette.status.critical"],
    ["Low", "palette.frequency.low"],
    ["Mid", "palette.frequency.mid"],
    ["High", "palette.frequency.high"],
  ];
  data.forEach(([label, id], index) => {
    const column = index % 5;
    const row = Math.floor(index / 5);
    sections.push(
      swatch(748 + column * 126, 414 + row * 82, 112, 66, role(id), label, primary, border)
    );
  });

  sections.push(
    `<rect x="40" y="624" width="1360" height="436" rx="18" fill="${panel}" stroke="${border}"/>`
  );
  sections.push(
    `<text x="64" y="664" fill="${primary}" font-size="18" font-weight="700">Instrument relationships</text>`
  );
  const lineRoles = [
    ["Loudness Momentary", "loudness.momentary"],
    ["Loudness Short-term", "loudness.shortTerm"],
    ["Spectrum Primary", "spectrum.primary"],
    ["Spectrum Secondary", "spectrum.secondary"],
    ["Waveform Trace", "waveform.trace"],
    ["Vectorscope Trace", "vectorscope.trace"],
  ];
  lineRoles.forEach(([label, id], index) => {
    const y = 708 + index * 46;
    sections.push(
      `<text x="64" y="${y + 5}" fill="${secondary}" font-size="14">${escapeXml(label)}</text><line x1="270" y1="${y}" x2="760" y2="${y}" stroke="${role(id)}" stroke-width="${index % 2 ? 2 : 4}"/><circle cx="790" cy="${y}" r="7" fill="${role(id)}"/>`
    );
  });
  const stops = resolved.roles["palette.intensity.stops"];
  const gradient = stops
    .map((stop) => `<stop offset="${stop.position * 100}%" stop-color="${stop.color}"/>`)
    .join("");
  sections.push(`<defs><linearGradient id="intensity">${gradient}</linearGradient></defs>`);
  sections.push(
    `<text x="860" y="714" fill="${secondary}" font-size="14">Intensity</text><rect x="860" y="732" width="492" height="64" rx="10" fill="url(#intensity)"/>`
  );
  sections.push(
    `<text x="860" y="838" fill="${secondary}" font-size="14">Focus / border / shadow effects</text>`
  );
  sections.push(
    `<rect x="860" y="862" width="492" height="128" rx="14" fill="${role("interface.surface.raised")}" stroke="${border}" stroke-width="2"/><rect x="890" y="892" width="180" height="54" rx="9" fill="${role("interface.surface.control")}" stroke="${role("interface.focusRing")}" stroke-width="3"/><text x="914" y="926" fill="${primary}" font-size="15">Focused Control</text>`
  );
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Inter, Segoe UI, sans-serif">${sections.join("")}</svg>`,
    resolved,
  };
}

export function buildSemanticMetrics(themeId, resolved) {
  const color = (id) => colorOf(resolved.roles[id]);
  const pairs = [
    ["primary-on-panel", "interface.text.primary", "interface.surface.panel", 4.5],
    ["secondary-on-panel", "interface.text.secondary", "interface.surface.panel", 4.5],
    ["annotation-on-panel", "interface.text.annotation", "interface.surface.panel", 4.5],
    ["accent-on-panel", "core.interfaceAccent", "interface.surface.panel", 3],
    ["primary-data-on-panel", "core.primaryData", "interface.surface.panel", 3],
    ["secondary-data-on-panel", "core.secondaryData", "interface.surface.panel", 3],
    ["warning-on-panel", "palette.status.warning", "interface.surface.panel", 3],
  ];
  return {
    themeId,
    colorScheme: resolved.colorScheme,
    contrast: pairs.map(([id, foreground, background, target]) => {
      const ratio = contrastRatio(color(foreground), color(background));
      return {
        id,
        foreground,
        background,
        ratio: Number(ratio.toFixed(3)),
        target,
        pass: ratio >= target,
      };
    }),
  };
}

export async function generateSemanticGallery({ manifest, outDir }) {
  const semanticDir = join(outDir, "semantic");
  await mkdir(semanticDir, { recursive: true });
  const artifacts = [];
  for (const themeId of manifest.semantic.themes) {
    const { svg, resolved } = buildSemanticGallerySvg(themeId, manifest);
    const svgPath = join(semanticDir, `${themeId}.svg`);
    const pngPath = join(semanticDir, `${themeId}.png`);
    await writeFile(svgPath, `${svg}\n`, "utf8");
    await sharp(Buffer.from(svg)).png().toFile(pngPath);
    const contents = await readFile(pngPath);
    artifacts.push({
      themeId,
      svgPath,
      pngPath,
      bytes: contents.length,
      sha256: createHash("sha256").update(contents).digest("hex"),
      metrics: buildSemanticMetrics(themeId, resolved),
    });
  }
  const contactPath = join(semanticDir, "contact-sheet.png");
  const images = await Promise.all(
    artifacts.map(({ pngPath }) => sharp(pngPath).resize({ width: 720 }).toBuffer())
  );
  const metadata = await sharp(images[0]).metadata();
  await sharp({
    create: { width: 1440, height: metadata.height, channels: 4, background: "#202020" },
  })
    .composite(images.map((input, index) => ({ input, left: index * 720, top: 0 })))
    .png()
    .toFile(contactPath);
  return { artifacts, contactPath };
}

export function createStereoFixtureWav({ durationSeconds, sampleRate, channels }) {
  const frames = durationSeconds * sampleRate;
  const bytesPerSample = 2;
  const dataBytes = frames * channels * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);
  for (let frame = 0; frame < frames; frame += 1) {
    const t = frame / sampleRate;
    const envelope = t < 1 ? t : t > durationSeconds - 1 ? durationSeconds - t : 1;
    const left = 0.42 * Math.sin(2 * Math.PI * 220 * t) + 0.18 * Math.sin(2 * Math.PI * 1760 * t);
    const right =
      0.34 * Math.sin(2 * Math.PI * 330 * t + 0.4) + 0.22 * Math.sin(2 * Math.PI * 3520 * t);
    const values = [left, right];
    for (let channel = 0; channel < channels; channel += 1) {
      const value = Math.max(-1, Math.min(1, values[channel % values.length] * envelope));
      buffer.writeInt16LE(Math.round(value * 32767), 44 + (frame * channels + channel) * 2);
    }
  }
  return buffer;
}
