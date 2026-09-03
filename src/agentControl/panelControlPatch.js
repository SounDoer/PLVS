import { normalizePanelControls } from "../lib/panelControls.js";

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

const LEVEL_METER_FIELDS = new Set([
  "mode",
  "playbackMax",
  "floatingValue",
  "tpMaxMarker",
  "levelRangeDbfs",
  "loudnessRangeLufs",
]);
const LEVEL_METER_MODES = new Set(["peak", "rms", "momentary", "shortTerm"]);

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

export function planPublicPanelControlPatch(moduleId, currentPanelControls, patch) {
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

  return { panelControls, changed, warnings: [], issues: [] };
}
