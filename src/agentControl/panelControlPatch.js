import { normalizePanelControls } from "../lib/panelControls.js";
import { STATS_CANONICAL_ORDER } from "../lib/statsCatalog.js";

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const arraysEqual = (left, right) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const LEVEL_METER_FIELDS = new Set([
  "mode",
  "playbackMax",
  "floatingValue",
  "tpMaxMarker",
  "levelRangeDbfs",
  "loudnessRangeLufs",
]);
const LEVEL_METER_MODES = new Set(["peak", "rms", "momentary", "shortTerm"]);
const STATS_IDS = new Set(STATS_CANONICAL_ORDER);

function issue(code, path, message) {
  return { code, path, message };
}

function validateBoolean(value, path, issues) {
  if (typeof value !== "boolean")
    issues.push(issue("invalidType", path, `${path} must be a boolean.`));
}

function validateRange(value, path, min, max, minSpan, issues) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    issues.push(issue("invalidType", path, `${path} must be a range object.`));
    return;
  }
  for (const key of Object.keys(value)) {
    if (key !== "min" && key !== "max") {
      issues.push(issue("unknownControl", `${path}.${key}`, `Unknown range field: ${key}.`));
    }
  }
  if (!Number.isFinite(value.min)) {
    issues.push(issue("invalidType", `${path}.min`, `${path}.min must be a finite number.`));
  }
  if (!Number.isFinite(value.max)) {
    issues.push(issue("invalidType", `${path}.max`, `${path}.max must be a finite number.`));
  }
  if (
    Number.isFinite(value.min) &&
    Number.isFinite(value.max) &&
    (value.min < min || value.max > max || value.max - value.min < minSpan)
  ) {
    issues.push(issue("outOfRange", path, `${path} is outside its allowed range.`));
  }
}

export function planPublicPanelControlPatch(moduleId, currentPanelControls, patch, context = {}) {
  const current = normalizePanelControls(currentPanelControls);
  const panelControls = { ...current };
  const changed = [];

  if (moduleId === "levelMeter") {
    const issues = [];
    for (const key of Object.keys(patch)) {
      if (!LEVEL_METER_FIELDS.has(key)) {
        issues.push(issue("unknownControl", `$.${key}`, `Unknown Level Meter control: ${key}.`));
      }
    }
    if (hasOwn(patch, "mode") && !LEVEL_METER_MODES.has(patch.mode)) {
      issues.push(issue("invalidEnum", "$.mode", "mode is not a supported Level Meter mode."));
    }
    for (const key of ["playbackMax", "floatingValue", "tpMaxMarker"]) {
      if (hasOwn(patch, key)) validateBoolean(patch[key], `$.${key}`, issues);
    }
    if (hasOwn(patch, "levelRangeDbfs")) {
      validateRange(patch.levelRangeDbfs, "$.levelRangeDbfs", -60, 3, 12, issues);
    }
    if (hasOwn(patch, "loudnessRangeLufs")) {
      validateRange(patch.loudnessRangeLufs, "$.loudnessRangeLufs", -64, 0, 12, issues);
    }
    if (issues.length > 0) {
      return { panelControls: current, changed: [], warnings: [], issues };
    }

    if (hasOwn(patch, "mode") && patch.mode !== current.levelMeterMode) {
      panelControls.levelMeterMode = patch.mode;
      changed.push("controls.mode");
    }
    for (const [publicKey, internalKey] of [
      ["playbackMax", "levelMeterPlaybackMax"],
      ["floatingValue", "levelMeterValueMarker"],
      ["tpMaxMarker", "levelMeterTpMaxMarker"],
    ]) {
      if (hasOwn(patch, publicKey) && patch[publicKey] !== current[internalKey]) {
        panelControls[internalKey] = patch[publicKey];
        changed.push(`controls.${publicKey}`);
      }
    }
    if (hasOwn(patch, "levelRangeDbfs")) {
      if (patch.levelRangeDbfs.min !== current.levelMeterYMinDb) {
        panelControls.levelMeterYMinDb = patch.levelRangeDbfs.min;
        changed.push("controls.levelRangeDbfs.min");
      }
      if (patch.levelRangeDbfs.max !== current.levelMeterYMaxDb) {
        panelControls.levelMeterYMaxDb = patch.levelRangeDbfs.max;
        changed.push("controls.levelRangeDbfs.max");
      }
    }
    if (hasOwn(patch, "loudnessRangeLufs")) {
      if (patch.loudnessRangeLufs.min !== current.loudnessYMinDb) {
        panelControls.loudnessYMinDb = patch.loudnessRangeLufs.min;
        changed.push("controls.loudnessRangeLufs.min");
      }
      if (patch.loudnessRangeLufs.max !== current.loudnessYMaxDb) {
        panelControls.loudnessYMaxDb = patch.loudnessRangeLufs.max;
        changed.push("controls.loudnessRangeLufs.max");
      }
    }
    const finalMode = panelControls.levelMeterMode;
    const loudnessMode = finalMode === "momentary" || finalMode === "shortTerm";
    const warnings = [];
    const warn = (publicKey, inactiveReason) => {
      if (hasOwn(patch, publicKey)) {
        warnings.push({
          code: "currentlyInactive",
          path: `controls.${publicKey}`,
          inactiveReason,
        });
      }
    };
    if (finalMode === "peak") warn("playbackMax", "peakMode");
    if (!loudnessMode) warn("floatingValue", "nonLoudnessMode");
    if (finalMode !== "peak") warn("tpMaxMarker", "nonPeakMode");
    if (loudnessMode) warn("levelRangeDbfs", "loudnessMode");
    if (!loudnessMode) warn("loudnessRangeLufs", "levelMode");
    return { panelControls, changed, warnings, issues };
  }

  if (moduleId === "vectorscope") {
    const issues = [];
    const allowed = new Set(["channelPair", "mode", "maxHold"]);
    for (const key of Object.keys(patch)) {
      if (!allowed.has(key)) {
        issues.push(issue("unknownControl", `$.${key}`, `Unknown Vectorscope control: ${key}.`));
      }
    }
    if (hasOwn(patch, "channelPair")) {
      const pair = patch.channelPair;
      const channelCount =
        Number.isInteger(context.channelCount) && context.channelCount > 0
          ? context.channelCount
          : 2;
      if (
        pair === null ||
        typeof pair !== "object" ||
        Array.isArray(pair) ||
        !Number.isInteger(pair.x) ||
        !Number.isInteger(pair.y)
      ) {
        issues.push(
          issue("invalidType", "$.channelPair", "channelPair must contain integer x and y.")
        );
      } else if (pair.x < 0 || pair.y >= channelCount || pair.x >= pair.y) {
        issues.push(
          issue("outOfRange", "$.channelPair", "channelPair must be an available ordered pair.")
        );
      }
    }
    if (
      hasOwn(patch, "mode") &&
      !new Set(["lissajous", "polarSample", "polarLevel"]).has(patch.mode)
    ) {
      issues.push(issue("invalidEnum", "$.mode", "mode is not a supported Vectorscope mode."));
    }
    if (hasOwn(patch, "maxHold")) validateBoolean(patch.maxHold, "$.maxHold", issues);
    if (issues.length > 0) {
      return { panelControls: current, changed: [], warnings: [], issues };
    }

    if (hasOwn(patch, "channelPair")) {
      if (patch.channelPair.x !== current.vectorscopePair.x) changed.push("controls.channelPair.x");
      if (patch.channelPair.y !== current.vectorscopePair.y) changed.push("controls.channelPair.y");
      panelControls.vectorscopePair = { ...patch.channelPair };
    }
    if (hasOwn(patch, "mode") && patch.mode !== current.vectorscopeMode) {
      panelControls.vectorscopeMode = patch.mode;
      changed.push("controls.mode");
    }
    if (hasOwn(patch, "maxHold") && patch.maxHold !== current.vectorscopePolarLevelMaxHold) {
      panelControls.vectorscopePolarLevelMaxHold = patch.maxHold;
      changed.push("controls.maxHold");
    }
    const warnings =
      hasOwn(patch, "maxHold") && panelControls.vectorscopeMode !== "polarLevel"
        ? [
            {
              code: "currentlyInactive",
              path: "controls.maxHold",
              inactiveReason: "nonPolarLevelMode",
            },
          ]
        : [];
    return { panelControls, changed, warnings, issues };
  }

  if (moduleId === "waveform") {
    const issues = [];
    const allowed = new Set(["frequencyColor", "frequencyBandsHz", "centroid"]);
    for (const key of Object.keys(patch)) {
      if (!allowed.has(key)) {
        issues.push(issue("unknownControl", `$.${key}`, `Unknown Waveform control: ${key}.`));
      }
    }
    for (const key of ["frequencyColor", "centroid"]) {
      if (hasOwn(patch, key)) validateBoolean(patch[key], `$.${key}`, issues);
    }
    if (hasOwn(patch, "frequencyBandsHz")) {
      const bands = patch.frequencyBandsHz;
      if (
        bands === null ||
        typeof bands !== "object" ||
        Array.isArray(bands) ||
        !Number.isInteger(bands.lowMid) ||
        !Number.isInteger(bands.midHigh)
      ) {
        issues.push(
          issue(
            "invalidType",
            "$.frequencyBandsHz",
            "frequencyBandsHz must contain integer lowMid and midHigh values."
          )
        );
      } else if (bands.lowMid < 20 || bands.midHigh > 20000 || bands.lowMid >= bands.midHigh) {
        issues.push(
          issue(
            "outOfRange",
            "$.frequencyBandsHz",
            "frequencyBandsHz must satisfy 20 <= lowMid < midHigh <= 20000."
          )
        );
      }
    }
    if (issues.length > 0) {
      return { panelControls: current, changed: [], warnings: [], issues };
    }

    if (
      hasOwn(patch, "frequencyColor") &&
      patch.frequencyColor !== current.waveformFrequencyColor
    ) {
      panelControls.waveformFrequencyColor = patch.frequencyColor;
      changed.push("controls.frequencyColor");
    }
    if (hasOwn(patch, "frequencyBandsHz")) {
      if (patch.frequencyBandsHz.lowMid !== current.waveformLowMidSplitHz) {
        panelControls.waveformLowMidSplitHz = patch.frequencyBandsHz.lowMid;
        changed.push("controls.frequencyBandsHz.lowMid");
      }
      if (patch.frequencyBandsHz.midHigh !== current.waveformMidHighSplitHz) {
        panelControls.waveformMidHighSplitHz = patch.frequencyBandsHz.midHigh;
        changed.push("controls.frequencyBandsHz.midHigh");
      }
    }
    if (hasOwn(patch, "centroid") && patch.centroid !== current.waveformCentroid) {
      panelControls.waveformCentroid = patch.centroid;
      changed.push("controls.centroid");
    }
    const warnings =
      hasOwn(patch, "frequencyBandsHz") && !panelControls.waveformFrequencyColor
        ? [
            {
              code: "currentlyInactive",
              path: "controls.frequencyBandsHz",
              inactiveReason: "frequencyColorOff",
            },
          ]
        : [];
    return { panelControls, changed, warnings, issues };
  }

  if (moduleId === "loudness") {
    const issues = [];
    const allowed = new Set(["layers", "loudnessRangeLufs"]);
    for (const key of Object.keys(patch)) {
      if (!allowed.has(key)) {
        issues.push(issue("unknownControl", `$.${key}`, `Unknown Loudness control: ${key}.`));
      }
    }
    if (hasOwn(patch, "layers")) {
      if (!Array.isArray(patch.layers) || patch.layers.some((id) => typeof id !== "string")) {
        issues.push(issue("invalidType", "$.layers", "layers must be an array of strings."));
      } else {
        const known = new Set(["momentary", "shortTerm", "reference"]);
        if (
          patch.layers.some((id) => !known.has(id)) ||
          new Set(patch.layers).size !== patch.layers.length
        ) {
          issues.push(
            issue("invalidEnum", "$.layers", "layers contains an unknown or duplicate value.")
          );
        }
        if (patch.layers.includes("reference") && context.hasLoudnessReference !== true) {
          issues.push(
            issue(
              "controlUnavailable",
              "$.layers",
              "reference is unavailable under the active Profile."
            )
          );
        }
      }
    }
    if (hasOwn(patch, "loudnessRangeLufs")) {
      validateRange(patch.loudnessRangeLufs, "$.loudnessRangeLufs", -64, 0, 12, issues);
    }
    if (issues.length > 0) {
      return { panelControls: current, changed: [], warnings: [], issues };
    }

    if (hasOwn(patch, "layers")) {
      const canonicalPublic = ["momentary", "shortTerm", "reference"].filter((id) =>
        patch.layers.includes(id)
      );
      const currentPublic = ["momentary", "shortTerm"]
        .filter((id) => current.loudnessHistoryVisibleLayerIds.includes(id))
        .concat(
          context.hasLoudnessReference === true &&
            current.loudnessHistoryVisibleLayerIds.includes("ref")
            ? ["reference"]
            : []
        );
      if (!arraysEqual(canonicalPublic, currentPublic)) changed.push("controls.layers");
      const nextInternal = canonicalPublic.map((id) => (id === "reference" ? "ref" : id));
      if (
        context.hasLoudnessReference !== true &&
        current.loudnessHistoryVisibleLayerIds.includes("ref")
      ) {
        nextInternal.push("ref");
      }
      panelControls.loudnessHistoryVisibleLayerIds = nextInternal;
    }
    if (hasOwn(patch, "loudnessRangeLufs")) {
      if (patch.loudnessRangeLufs.min !== current.loudnessYMinDb) {
        panelControls.loudnessYMinDb = patch.loudnessRangeLufs.min;
        changed.push("controls.loudnessRangeLufs.min");
      }
      if (patch.loudnessRangeLufs.max !== current.loudnessYMaxDb) {
        panelControls.loudnessYMaxDb = patch.loudnessRangeLufs.max;
        changed.push("controls.loudnessRangeLufs.max");
      }
    }
    return { panelControls, changed, warnings: [], issues };
  }

  if (moduleId === "stats") {
    const issues = [];
    for (const key of Object.keys(patch)) {
      if (key !== "metrics") {
        issues.push(issue("unknownControl", `$.${key}`, `Unknown Stats control: ${key}.`));
      }
    }
    const rawMetrics = patch.metrics;
    const metrics =
      rawMetrics !== null && typeof rawMetrics === "object" && !Array.isArray(rawMetrics)
        ? rawMetrics
        : {};
    if (
      hasOwn(patch, "metrics") &&
      (rawMetrics === null || typeof rawMetrics !== "object" || Array.isArray(rawMetrics))
    ) {
      issues.push(issue("invalidType", "$.metrics", "metrics must be an object."));
    } else if (hasOwn(patch, "metrics")) {
      for (const key of Object.keys(metrics)) {
        if (key !== "visible" && key !== "order") {
          issues.push(
            issue("unknownControl", `$.metrics.${key}`, `Unknown Stats metrics field: ${key}.`)
          );
        }
      }
      if (hasOwn(metrics, "visible")) {
        if (
          !Array.isArray(metrics.visible) ||
          metrics.visible.some((id) => typeof id !== "string")
        ) {
          issues.push(
            issue(
              "invalidType",
              "$.metrics.visible",
              "metrics.visible must be an array of strings."
            )
          );
        } else if (
          metrics.visible.some((id) => !STATS_IDS.has(id)) ||
          new Set(metrics.visible).size !== metrics.visible.length
        ) {
          issues.push(
            issue(
              "invalidEnum",
              "$.metrics.visible",
              "metrics.visible contains an unknown or duplicate metric."
            )
          );
        }
      }
      if (hasOwn(metrics, "order")) {
        if (!Array.isArray(metrics.order) || metrics.order.some((id) => typeof id !== "string")) {
          issues.push(
            issue("invalidType", "$.metrics.order", "metrics.order must be an array of strings.")
          );
        } else if (
          metrics.order.length !== STATS_CANONICAL_ORDER.length ||
          new Set(metrics.order).size !== metrics.order.length ||
          metrics.order.some((id) => !STATS_IDS.has(id))
        ) {
          issues.push(
            issue(
              "invalidEnum",
              "$.metrics.order",
              "metrics.order must be a complete permutation of all Stats metrics."
            )
          );
        }
      }
    }
    if (issues.length > 0) {
      return { panelControls: current, changed: [], warnings: [], issues };
    }

    const finalOrder = hasOwn(metrics, "order") ? [...metrics.order] : [...current.statsOrder];
    const submittedVisible = hasOwn(metrics, "visible") ? metrics.visible : current.statsVisibleIds;
    const visibleSet = new Set(submittedVisible);
    const finalVisible = finalOrder.filter((id) => visibleSet.has(id));
    const currentVisibleSet = new Set(current.statsVisibleIds);
    const currentVisible = current.statsOrder.filter((id) => currentVisibleSet.has(id));
    if (!arraysEqual(finalVisible, currentVisible)) changed.push("controls.metrics.visible");
    if (!arraysEqual(finalOrder, current.statsOrder)) changed.push("controls.metrics.order");
    panelControls.statsVisibleIds = finalVisible;
    panelControls.statsOrder = finalOrder;
    return { panelControls, changed, warnings: [], issues };
  }

  return { panelControls, changed, warnings: [], issues: [] };
}
