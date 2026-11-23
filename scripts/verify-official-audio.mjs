import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { unzipSync } from "fflate";
import { harnessArgs, locateHarness } from "./capture-rig.mjs";
import { withFileAnalysisSidecars } from "./file-analysis-sidecars.mjs";

// Tech 3341/3342 publish tolerances. Use a 0.1 LUFS comparison margin for
// the rounded BS.2217 surround reference.
const ebuCases = [
  [
    "seq-3341-1-16bit.wav",
    [
      ["integratedLufs", -23.1, -22.9],
      ["mMaxLufs", -23.1, -22.9],
      ["stMaxLufs", -23.1, -22.9],
    ],
  ],
  ["seq-3341-4-16bit-v02.wav", [["integratedLufs", -23.1, -22.9]]],
  ["seq-3341-16-24bit.wav.wav", [["truePeakMaxDbtp", -6.4, -5.8]]],
  ["seq-3342-1-16bit.wav", [["lra", 9, 11]]],
];

const ituCases = [
  ["R11020000010011ZIPM.zip", "1770-2_Comp_23LKFS_ChannelCheckLFE.wav", "LFE"],
  ["R11020000010012ZIPM.zip", "1770-2_Comp_23LKFS_ChannelCheckLs.wav", "Ls"],
];

function measure(harness, path, decoderDir) {
  const result = spawnSync(harness, harnessArgs(["analyze", path, "--json"]), {
    encoding: "utf8",
    env: { ...process.env, PLVS_FFMPEG_DIR: decoderDir },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Could not analyze ${path}: ${result.stderr.trim() || result.stdout.trim()}`);
  }
  return JSON.parse(result.stdout).summary;
}

function inRange(summary, field, min, max) {
  const value = summary[field];
  return [
    Number.isFinite(value) && value >= min && value <= max,
    `${field}=${value}, expected [${min}, ${max}]`,
  ];
}

async function extractWavs(archive, names, directory) {
  const entries = unzipSync(await readFile(archive), {
    filter: ({ name }) => names.includes(name),
  });
  for (const name of names) {
    if (!entries[name]) throw new Error(`Missing ${name} in ${archive}`);
    await writeFile(join(directory, name), entries[name]);
  }
}

async function verify(mediaDir) {
  const harness = locateHarness();
  await withFileAnalysisSidecars("plvs-official-audio-", async (directory) => {
    let failures = 0;
    function report(name, checks) {
      const failed = checks.some(([ok]) => !ok);
      if (failed) failures++;
      console.log(
        `${failed ? "FAIL" : "PASS"} ${name} (${checks.map(([, detail]) => detail).join("; ")})`
      );
    }

    const ebuZip = join(mediaDir, "loudness", "ebu", "ebu-loudness-test-setv05.zip");
    await extractWavs(
      ebuZip,
      ebuCases.map(([name]) => name),
      directory
    );
    for (const [name, limits] of ebuCases) {
      const summary = measure(harness, join(directory, name), directory);
      report(
        name,
        limits.map(([field, min, max]) => inRange(summary, field, min, max))
      );
    }

    for (const [zipName, name, role] of ituCases) {
      await extractWavs(join(mediaDir, "loudness", "itu-r", zipName), [name], directory);
      const summary = measure(harness, join(directory, name), directory);
      const active = summary.channelPeaks.filter((peak) => Number.isFinite(peak.samplePeakMaxDb));
      report(name, [
        [
          active.length === 1 && active[0].label === role,
          `active=${active.map((peak) => peak.label).join(",")}`,
        ],
        role === "LFE"
          ? [
              summary.integratedLufs === null && Number.isFinite(summary.truePeakMaxDbtp),
              `integratedLufs=${summary.integratedLufs}, truePeakMaxDbtp=${summary.truePeakMaxDbtp}`,
            ]
          : inRange(summary, "integratedLufs", -23.1, -22.9),
      ]);
    }

    const adm = join(mediaDir, "channel-layouts", "ebu", "channels_7_1_4_adm_bsldet.wav");
    const summary = measure(harness, adm, directory);
    const audible = summary.channelPeaks.filter((peak) =>
      Number.isFinite(peak.samplePeakMaxDb)
    ).length;
    report("EBU QC 7.1.4 ADM WAV", [
      [
        summary.channelCount === 12 && audible === 12,
        `channels=${summary.channelCount}, with peaks=${audible}`,
      ],
      [
        summary.loudnessLayout === "unknown" && !summary.loudnessLayoutKnown,
        `layout=${summary.loudnessLayout}`,
      ],
    ]);

    console.log("EBU test sequences © EBU.");
    if (failures > 0) throw new Error(`${failures} official audio cases failed.`);
  });
}

try {
  if (process.argv.length !== 3)
    throw new Error("Usage: npm run verify:official-audio -- <test-media-directory>");
  await verify(resolve(process.argv[2]));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
