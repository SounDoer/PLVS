// Absolute, field-specific allowances for visual floating-point output only. Source identity,
// analysis requests, clocks, measurements, history shape and unknown fields remain exact.
// Bounds follow the 2026-11-01 numerical and pixel comparisons; they are not audio tolerances.
const RULES = {
  frequency: { limit: 1e-9, unit: "Hz" },
  spectrum: { limit: 1e-4, unit: "dB" },
  spectrogram: { limit: 0.002, unit: "dB" },
  centroid: { limit: 0.002, unit: "Hz" },
  tonality: { limit: 2e-7, unit: "ratio" },
  power: { limit: 1e-9, unit: "power" },
};

function visualRule(path) {
  if (path[0] !== "visuals" || typeof path.at(-1) !== "number") return null;
  if (path.length === 3 && path[1] === "bandCentersHz") return "frequency";
  if (path.length === 5) {
    if (
      path[1] === "spectrumResultsByKey" &&
      ["smoothDb", "peakDb", "smoothDbB", "peakDbB"].includes(path[3])
    )
      return "spectrum";
    if (path[1] === "waveform" && typeof path[2] === "number") {
      if (path[3] === "spectralCentroidHz") return "centroid";
      if (path[3] === "tonality") return "tonality";
    }
    if (path[1] === "stereoMapResultsByKey") {
      if (path[3] === "bandCentersHz") return "frequency";
      if (["pl", "pr", "c"].includes(path[3])) return "power";
    }
  }
  if (
    path.length === 6 &&
    path[1] === "spectrogramByKey" &&
    typeof path[3] === "number" &&
    ["db", "dbB"].includes(path[4])
  )
    return "spectrogram";
  return null;
}

function pointer(path) {
  return path.length
    ? `/${path.map((key) => String(key).replaceAll("~", "~0").replaceAll("/", "~1")).join("/")}`
    : "/";
}

/** Compare parsed JSON without changing either input. Diagnostic samples are bounded. */
export function comparePreviewFixtures(expected, actual) {
  const result = {
    matches: true,
    mismatchCount: 0,
    examples: [],
    toleratedCount: 0,
    tolerated: {},
  };
  function mismatch(path, reason, details = {}) {
    result.matches = false;
    result.mismatchCount++;
    if (result.examples.length < 5)
      result.examples.push({ path: pointer(path), reason, ...details });
  }
  function visit(left, right, path) {
    if (typeof left !== typeof right) return mismatch(path, "type changed");
    if (typeof left === "number") {
      if (!Number.isFinite(left) || !Number.isFinite(right)) {
        return mismatch(path, "non-finite number");
      }
      if (left === right) return;
      const rule = visualRule(path);
      const delta = Math.abs(left - right);
      const details = { expected: left, actual: right, delta };
      if (rule && delta <= RULES[rule].limit) {
        result.toleratedCount++;
        const previous = result.tolerated[rule];
        result.tolerated[rule] = {
          ...(previous && previous.delta >= delta ? previous : { path: pointer(path), ...details }),
          count: (previous?.count ?? 0) + 1,
          limit: RULES[rule].limit,
          unit: RULES[rule].unit,
        };
        return;
      }
      return mismatch(path, rule ? "visual difference exceeds limit" : "exact number changed", {
        ...details,
        ...(rule ? RULES[rule] : {}),
      });
    }
    if (left === null || right === null) {
      if (left !== right) mismatch(path, "null changed");
      return;
    }
    if (typeof left === "object") {
      if (Array.isArray(left) !== Array.isArray(right))
        return mismatch(path, "array/object changed");
      if (Array.isArray(left)) {
        if (left.length !== right.length) {
          mismatch(path, "array length changed", { expected: left.length, actual: right.length });
        }
        for (let i = 0; i < Math.min(left.length, right.length); i++)
          visit(left[i], right[i], [...path, i]);
      } else {
        for (const key of Object.keys(left)) {
          if (!Object.hasOwn(right, key)) mismatch([...path, key], "field missing");
          else visit(left[key], right[key], [...path, key]);
        }
        for (const key of Object.keys(right)) {
          if (!Object.hasOwn(left, key)) mismatch([...path, key], "unexpected field");
        }
      }
      return;
    }
    if (!["string", "boolean"].includes(typeof left)) return mismatch(path, "invalid JSON value");
    if (left !== right) mismatch(path, "value changed", { expected: left, actual: right });
  }
  visit(expected, actual, []);
  return result;
}

export function describeFixtureComparison(result) {
  const failures = result.examples.map(
    ({ path, reason, expected, actual, delta, limit, unit }) =>
      `${path}: ${reason}${expected !== undefined ? ` (expected ${expected}, actual ${actual})` : ""}` +
      `${delta !== undefined ? `; delta ${delta}${limit !== undefined ? `, limit ${limit} ${unit}` : ""}` : ""}`
  );
  const tolerated = Object.entries(result.tolerated).map(
    ([rule, item]) =>
      `${rule}: ${item.count} values; max delta ${item.delta} ${item.unit} ` +
      `(limit ${item.limit}) at ${item.path}`
  );
  return [...failures, ...tolerated].join("\n");
}
