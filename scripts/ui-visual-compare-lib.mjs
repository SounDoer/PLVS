import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import sharp from "sharp";

async function pngFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) files.push(...(await pngFiles(root, path)));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".png")) {
      files.push(relative(root, path).replaceAll("\\", "/"));
    }
  }
  return files.sort();
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

export async function comparePngDirectories({ beforeDir, afterDir, diffDir }) {
  const beforeFiles = await pngFiles(beforeDir);
  const afterFiles = await pngFiles(afterDir);
  const names = [...new Set([...beforeFiles, ...afterFiles])].sort();
  const results = [];

  for (const name of names) {
    if (!beforeFiles.includes(name)) {
      results.push({ path: name, status: "missingBefore" });
      continue;
    }
    if (!afterFiles.includes(name)) {
      results.push({ path: name, status: "missingAfter" });
      continue;
    }

    const beforeContents = await readFile(join(beforeDir, name));
    const afterContents = await readFile(join(afterDir, name));
    const before = await sharp(beforeContents)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const after = await sharp(afterContents)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const dimensions = {
      before: { width: before.info.width, height: before.info.height },
      after: { width: after.info.width, height: after.info.height },
    };
    if (
      before.info.width !== after.info.width ||
      before.info.height !== after.info.height ||
      before.info.channels !== after.info.channels
    ) {
      results.push({
        path: name,
        status: "sizeMismatch",
        dimensions,
        beforeSha256: sha256(beforeContents),
        afterSha256: sha256(afterContents),
      });
      continue;
    }

    let changedPixels = 0;
    let maxChannelDelta = 0;
    const diff = Buffer.alloc(before.data.length);
    for (let offset = 0; offset < before.data.length; offset += 4) {
      let changed = false;
      let pixelDelta = 0;
      for (let channel = 0; channel < 4; channel += 1) {
        const delta = Math.abs(before.data[offset + channel] - after.data[offset + channel]);
        pixelDelta = Math.max(pixelDelta, delta);
        if (delta !== 0) changed = true;
      }
      if (changed) changedPixels += 1;
      maxChannelDelta = Math.max(maxChannelDelta, pixelDelta);
      diff[offset] = changed ? 255 : Math.round(before.data[offset] * 0.2);
      diff[offset + 1] = changed ? 0 : Math.round(before.data[offset + 1] * 0.2);
      diff[offset + 2] = changed ? 255 : Math.round(before.data[offset + 2] * 0.2);
      diff[offset + 3] = 255;
    }

    let diffPath = null;
    if (changedPixels > 0) {
      diffPath = join(diffDir, name);
      await sharp(diff, {
        raw: {
          width: before.info.width,
          height: before.info.height,
          channels: 4,
        },
      })
        .png()
        .toFile(diffPath);
    }
    const totalPixels = before.info.width * before.info.height;
    results.push({
      path: name,
      status: changedPixels === 0 ? "identical" : "changed",
      dimensions,
      changedPixels,
      totalPixels,
      changedPercent: totalPixels === 0 ? 0 : (changedPixels / totalPixels) * 100,
      maxChannelDelta,
      beforeSha256: sha256(beforeContents),
      afterSha256: sha256(afterContents),
      diffPath,
    });
  }

  const summary = {
    compared: results.filter(({ status }) => ["identical", "changed"].includes(status)).length,
    identical: results.filter(({ status }) => status === "identical").length,
    changed: results.filter(({ status }) => status === "changed").length,
    missingBefore: results.filter(({ status }) => status === "missingBefore").length,
    missingAfter: results.filter(({ status }) => status === "missingAfter").length,
    sizeMismatch: results.filter(({ status }) => status === "sizeMismatch").length,
  };
  return {
    schemaVersion: 1,
    beforeDir,
    afterDir,
    diffDir,
    passed:
      summary.changed === 0 &&
      summary.missingBefore === 0 &&
      summary.missingAfter === 0 &&
      summary.sizeMismatch === 0,
    summary,
    results,
  };
}
