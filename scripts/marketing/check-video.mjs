import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseArgs } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";

const execute = promisify(execFile);
const run = async (exe, args) =>
  (
    await execute(exe, args, {
      windowsHide: true,
      timeout: 30 * 60 * 1000,
      maxBuffer: 4 * 1024 * 1024,
    })
  ).stdout;

export function validateConfig(config) {
  const allowed = [
    "width",
    "height",
    "fps",
    "duration",
    "durationTolerance",
    "requireAudio",
    "samples",
    "transitions",
    "transitionOffsets",
  ];
  for (const key of Object.keys(config))
    if (!allowed.includes(key)) throw new Error(`Unknown configuration key: ${key}`);
  for (const key of ["width", "height", "fps", "duration", "durationTolerance"]) {
    if (config[key] !== undefined && (!Number.isFinite(config[key]) || config[key] <= 0))
      throw new Error(`Invalid ${key}`);
  }
  for (const key of ["width", "height"])
    if (config[key] !== undefined && !Number.isInteger(config[key]))
      throw new Error(`Invalid ${key}`);
  if (config.requireAudio !== undefined && typeof config.requireAudio !== "boolean")
    throw new Error("Invalid requireAudio");
  for (const key of ["samples", "transitions", "transitionOffsets"]) {
    if (
      config[key] !== undefined &&
      (!Array.isArray(config[key]) ||
        config[key].length > 200 ||
        config[key].some((n) => !Number.isFinite(n)))
    )
      throw new Error(`Invalid ${key}`);
  }
  return config;
}

export function sampleTimes(config, duration) {
  const requested = [...(config.samples ?? [duration * 0.1, duration * 0.5, duration * 0.9])];
  for (const cue of config.transitions ?? []) {
    for (const offset of config.transitionOffsets ?? [-0.1, 0, 0.1]) requested.push(cue + offset);
  }
  if (requested.length > 200) throw new Error("At most 200 frame samples are allowed");
  for (const time of requested)
    if (time < 0 || time >= duration)
      throw new Error(`Sample ${time}s is outside video duration ${duration}s`);
  return [...new Set(requested)].sort((a, b) => a - b);
}

function rate(text) {
  const [a, b = 1] = String(text).split("/").map(Number);
  return a / b;
}

export async function checkVideo({
  input,
  output,
  config = {},
  referenceAudio,
  ffmpeg = "ffmpeg",
  ffprobe = "ffprobe",
}) {
  validateConfig(config);
  input = resolve(input);
  output = resolve(output);
  await mkdir(output); // Exclusive: a report must never replace another review.
  const report = {
    version: 1,
    input,
    status: "running",
    checks: [],
    frames: [],
    manualReview: [
      "Check full-resolution frames for glyph clipping, alignment and UI state.",
      "Watch continuously with sound for pacing, freezes and synchronization. Sampled frames are not exhaustive motion review.",
    ],
  };
  const save = () => writeFile(join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
  const check = (name, passed, details) =>
    report.checks.push({ name, status: passed ? "passed" : "failed", details });
  try {
    const probe = JSON.parse(
      await run(ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", input])
    );
    report.media = probe;
    const video = probe.streams?.find(
      (s) => s.codec_type === "video" && !s.disposition?.attached_pic
    );
    if (!video) throw new Error("No video stream");
    const duration = Number(video.duration ?? probe.format?.duration);
    if (!Number.isFinite(duration) || duration <= 0)
      throw new Error("No finite positive video duration");
    const audio = probe.streams.filter((s) => s.codec_type === "audio");
    check(
      "audio presence",
      config.requireAudio === false || audio.length > 0,
      `${audio.length} audio stream(s)`
    );
    for (const key of ["width", "height"])
      if (config[key] !== undefined)
        check(key, video[key] === config[key], { actual: video[key], expected: config[key] });
    if (config.fps !== undefined)
      check("average frame rate", Math.abs(rate(video.avg_frame_rate) - config.fps) < 0.001, {
        actual: rate(video.avg_frame_rate),
        expected: config.fps,
      });
    if (config.duration !== undefined)
      check("duration", Math.abs(duration - config.duration) <= (config.durationTolerance ?? 0.1), {
        actual: duration,
        expected: config.duration,
      });
    const times = sampleTimes(config, duration);
    await run(ffmpeg, [
      "-v",
      "error",
      "-xerror",
      "-err_detect",
      "explode",
      "-i",
      input,
      "-map",
      "0:v",
      "-map",
      "0:a?",
      "-f",
      "null",
      "-",
    ]);
    check("complete decode", true);
    if (referenceAudio) {
      // Compare decoded PCM, preserving sample rate and channel layout. No resampling or trim.
      const pcmHash = async (file) =>
        (
          await run(ffmpeg, [
            "-v",
            "error",
            "-xerror",
            "-i",
            resolve(file),
            "-map",
            "0:a:0",
            "-vn",
            "-c:a",
            "pcm_s32le",
            "-f",
            "hash",
            "-hash",
            "sha256",
            "-",
          ])
        ).trim();
      const ref = JSON.parse(
        await run(ffprobe, ["-v", "error", "-show_streams", "-of", "json", resolve(referenceAudio)])
      );
      const ra = ref.streams.find((s) => s.codec_type === "audio");
      if (!audio[0] || !ra) throw new Error("Audio comparison requires audio in both files");
      const actual = await pcmHash(input);
      const expected = await pcmHash(referenceAudio);
      check(
        "exact decoded audio",
        actual === expected &&
          audio[0].sample_rate === ra.sample_rate &&
          audio[0].channels === ra.channels &&
          audio[0].channel_layout === ra.channel_layout,
        { actual, expected, reference: resolve(referenceAudio) }
      );
    }
    for (const [i, time] of times.entries()) {
      const file = `frame-${String(i + 1).padStart(3, "0")}.png`;
      await run(ffmpeg, [
        "-v",
        "error",
        "-xerror",
        "-ss",
        String(time),
        "-i",
        input,
        "-map",
        `0:${video.index}`,
        "-frames:v",
        "1",
        "-n",
        join(output, file),
      ]);
      await sharp(join(output, file)).metadata(); // A seek past the last actual frame can produce no file.
      report.frames.push({ requestedSeconds: time, file });
    }
    // Paginate rather than constructing an unbounded image for a long review plan.
    report.contactSheets = [];
    for (let start = 0; start < report.frames.length; start += 12) {
      const page = report.frames.slice(start, start + 12);
      const tiles = [];
      for (const [i, frame] of page.entries()) {
        const left = (i % 3) * 480,
          top = Math.floor(i / 3) * 300;
        tiles.push({
          input: await sharp(join(output, frame.file))
            .resize(480, 270, { fit: "contain", background: "#222222" })
            .png()
            .toBuffer(),
          left,
          top: top + 30,
        });
        tiles.push({
          input: Buffer.from(
            `<svg width="480" height="30"><text x="10" y="21" fill="white" font-size="16">${frame.requestedSeconds.toFixed(3)} s</text></svg>`
          ),
          left,
          top,
        });
      }
      const file = `contact-${report.contactSheets.length + 1}.jpg`;
      await sharp({
        create: {
          width: 1440,
          height: Math.ceil(page.length / 3) * 300,
          channels: 3,
          background: "#222222",
        },
      })
        .composite(tiles)
        .jpeg()
        .toFile(join(output, file));
      report.contactSheets.push(file);
    }
    report.status = report.checks.some((c) => c.status === "failed") ? "failed" : "passed";
  } catch (error) {
    report.status = "failed";
    report.error = error.message;
  }
  await save();
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { values, positionals } = parseArgs({
      allowPositionals: true,
      options: {
        out: { type: "string" },
        config: { type: "string" },
        "reference-audio": { type: "string" },
        ffmpeg: { type: "string" },
        ffprobe: { type: "string" },
        help: { type: "boolean" },
      },
    });
    if (values.help)
      console.log(
        "node scripts/marketing/check-video.mjs VIDEO --out NEW_DIRECTORY [--config JSON] [--reference-audio VIDEO] [--ffmpeg PATH] [--ffprobe PATH]"
      );
    else {
      if (positionals.length !== 1 || !values.out)
        throw new Error("VIDEO and --out NEW_DIRECTORY are required; see --help");
      const config = values.config ? JSON.parse(await readFile(values.config, "utf8")) : {};
      const report = await checkVideo({
        input: positionals[0],
        output: values.out,
        config,
        referenceAudio: values["reference-audio"],
        ffmpeg: values.ffmpeg,
        ffprobe: values.ffprobe,
      });
      console.log(
        `${report.status}: ${join(resolve(values.out), "report.json")}; visual review remains manual.`
      );
      process.exitCode = report.status === "passed" ? 0 : 1;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
