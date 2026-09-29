import { compileTheme } from "./compileTheme.js";
import { themeContrastRatio, themeColorDistance } from "./colorMetrics.js";
export { themeContrastRatio, themeColorDistance } from "./colorMetrics.js";

const WCAG_TEXT_CONTRAST = "WCAG 2.2 SC 1.4.3";
const WCAG_NON_TEXT_CONTRAST = "WCAG 2.2 SC 1.4.11";

function warning({
  code,
  title,
  message,
  roleIds,
  target,
  section,
  metric,
  consumers,
  standard = null,
}) {
  return {
    id: `${code}:${roleIds.join("+")}`,
    severity: "warning",
    code,
    title,
    message,
    roleIds,
    target,
    section,
    metric,
    consumers,
    standard,
  };
}

function contrastWarning(resolved, spec) {
  const foreground = resolved.roles[spec.foreground];
  const background = resolved.roles[spec.background];
  const ratio = themeContrastRatio(foreground, background);
  if (ratio >= spec.targetRatio) return null;
  return warning({
    code: "contrast",
    title: `${spec.label} contrast is low`,
    message: `${spec.label} measures ${ratio.toFixed(2)}:1; the recommended target is ${spec.targetRatio.toFixed(1)}:1.`,
    roleIds: [spec.foreground, spec.background],
    target: spec.target,
    section: spec.section,
    metric: { label: "Contrast", value: Number(ratio.toFixed(3)), target: spec.targetRatio },
    consumers: spec.consumers,
    standard: spec.standard ?? null,
  });
}

function separationWarning(resolved, first, second, options) {
  const distance = themeColorDistance(resolved.roles[first], resolved.roles[second]);
  if (distance >= options.targetDistance) return null;
  return warning({
    code: "separation",
    title: `${options.label} are difficult to distinguish`,
    message: `${options.label} measure ${distance.toFixed(3)} OKLab distance; the recommended target is ${options.targetDistance.toFixed(2)}.`,
    roleIds: [first, second],
    target: options.target,
    section: options.section,
    metric: {
      label: "OKLab distance",
      value: Number(distance.toFixed(4)),
      target: options.targetDistance,
    },
    consumers: options.consumers,
  });
}

export const THEME_CONTRAST_CHECKS = [
  {
    label: "Primary Text on Panel",
    foreground: "interface.text.primary",
    background: "interface.surface.panel",
    targetRatio: 4.5,
    target: { page: "advanced", id: "interface.text.primary" },
    section: "Interface",
    consumers: ["headings", "values", "body text"],
    standard: WCAG_TEXT_CONTRAST,
  },
  {
    label: "Secondary Text on Panel",
    foreground: "interface.text.secondary",
    background: "interface.surface.panel",
    targetRatio: 4.5,
    target: { page: "advanced", id: "interface.text.secondary" },
    section: "Interface",
    consumers: ["descriptions", "metadata", "supporting labels"],
    standard: WCAG_TEXT_CONTRAST,
  },
  {
    label: "Annotation Text on Panel",
    foreground: "interface.text.annotation",
    background: "interface.surface.panel",
    targetRatio: 4.5,
    target: { page: "advanced", id: "interface.text.annotation" },
    section: "Interface",
    consumers: ["chart axes", "units", "technical readouts"],
    standard: WCAG_TEXT_CONTRAST,
  },
  {
    label: "Content on Accent",
    foreground: "interface.content.onAccent",
    background: "core.interfaceAccent",
    targetRatio: 4.5,
    target: { page: "advanced", id: "interface.content.onAccent" },
    section: "Interface",
    consumers: ["primary controls", "selected solid controls"],
    standard: WCAG_TEXT_CONTRAST,
  },
  ...[
    ["Success", "success"],
    ["Warning", "warning"],
    ["Danger", "danger"],
  ].flatMap(([label, key]) => [
    {
      label: `Content on ${label}`,
      foreground: `interface.content.on${label}`,
      background: `interface.${key}`,
      targetRatio: 4.5,
      target: { page: "advanced", id: `interface.content.on${label}` },
      section: "Interface",
      consumers: [`solid ${key} controls`, `${key} chips`],
      standard: WCAG_TEXT_CONTRAST,
    },
    {
      label: `${label} feedback on Panel`,
      foreground: `interface.feedback.${key}`,
      background: "interface.surface.panel",
      targetRatio: 3,
      target: { page: "advanced", id: `interface.feedback.${key}` },
      section: "Interface",
      consumers: [`${key} messages`, `${key} badges`],
    },
  ]),
  ...[
    ["Loudness Momentary", "loudness.momentary"],
    ["Loudness Short-term", "loudness.shortTerm"],
    ["Loudness Momentary Snapshot", "loudness.momentarySnapshot"],
    ["Loudness Short-term Snapshot", "loudness.shortTermSnapshot"],
    ["Spectrum Primary", "spectrum.primary"],
    ["Spectrum Secondary", "spectrum.secondary"],
    ["Spectrum Primary Snapshot", "spectrum.primarySnapshot"],
    ["Spectrum Secondary Snapshot", "spectrum.secondarySnapshot"],
    ["Waveform Trace", "waveform.trace"],
    ["Waveform Snapshot", "waveform.snapshot"],
    ["Vectorscope Trace", "vectorscope.trace"],
    ["Vectorscope Snapshot", "vectorscope.snapshot"],
    ["Stereo Map Primary", "stereoMap.primary"],
    ["Stereo Map Secondary", "stereoMap.secondary"],
    ["Stereo Map Primary Snapshot", "stereoMap.primarySnapshot"],
    ["Stereo Map Secondary Snapshot", "stereoMap.secondarySnapshot"],
    ["Spectrogram Axis Labels", "spectrogram.axisLabel"],
    ["Stats Warning Value", "stats.warningValue"],
    ["Stats Critical Value", "stats.criticalValue"],
  ].map(([label, foreground]) => ({
    label: label + " on Panel",
    foreground,
    background: "interface.surface.panel",
    targetRatio:
      foreground.startsWith("stats.") || foreground === "spectrogram.axisLabel" ? 4.5 : 3,
    target: targetFor(foreground),
    section: "Modules",
    consumers: [label],
    standard:
      foreground.startsWith("stats.") || foreground === "spectrogram.axisLabel"
        ? WCAG_TEXT_CONTRAST
        : WCAG_NON_TEXT_CONTRAST,
  })),
  ...[
    ["Workspace", "core.workspace", "interface.text.primary"],
    ["Raised", "interface.surface.raised", "interface.content.onRaised"],
    ["Control", "interface.surface.control", "interface.content.onControl"],
    ["Selected", "interface.surface.selected", "interface.content.onSelected"],
  ].map(([label, background, foreground]) => ({
    label: "Primary Text on " + label,
    foreground,
    background,
    targetRatio: 4.5,
    target: targetFor("interface.text.primary"),
    section: "Interface",
    consumers: [label + " content"],
    standard: WCAG_TEXT_CONTRAST,
  })),
];

export const THEME_SEPARATION_CHECKS = [
  ...[
    ["loudness.momentary", "loudness.momentarySnapshot", "Loudness Momentary and Snapshot"],
    ["loudness.shortTerm", "loudness.shortTermSnapshot", "Loudness Short-term and Snapshot"],
    ["spectrum.primary", "spectrum.primarySnapshot", "Spectrum Primary and Snapshot"],
    ["spectrum.secondary", "spectrum.secondarySnapshot", "Spectrum Secondary and Snapshot"],
    ["waveform.trace", "waveform.snapshot", "Waveform Trace and Snapshot"],
    ["vectorscope.trace", "vectorscope.snapshot", "Vectorscope Trace and Snapshot"],
    ["stereoMap.primary", "stereoMap.primarySnapshot", "Stereo Map Primary and Snapshot"],
    ["stereoMap.secondary", "stereoMap.secondarySnapshot", "Stereo Map Secondary and Snapshot"],
    ["spectrum.primary", "spectrum.secondary", "Spectrum Primary and Secondary"],
    ["stereoMap.primary", "stereoMap.secondary", "Stereo Map Primary and Secondary"],
    ["waveform.frequencyLow", "waveform.frequencyMid", "Waveform Low and Mid Frequency"],
    ["waveform.frequencyMid", "waveform.frequencyHigh", "Waveform Mid and High Frequency"],
    ["level.safe", "level.warning", "Level Safe and Warning"],
    ["level.warning", "level.critical", "Level Warning and Critical"],
    ["stereoMap.safeRange", "stereoMap.warningRange", "Stereo Map Safe and Warning"],
    ["stereoMap.warningRange", "stereoMap.criticalRange", "Stereo Map Warning and Critical"],
  ].map(([first, second, label]) => [first, second, label, second]),
  [
    "palette.status.safe",
    "palette.status.warning",
    "Status Safe and Warning",
    "palette.status.safe",
  ],
  [
    "palette.status.warning",
    "palette.status.critical",
    "Status Warning and Critical",
    "palette.status.warning",
  ],
  [
    "palette.frequency.low",
    "palette.frequency.mid",
    "Frequency Low and Mid",
    "palette.frequency.low",
  ],
  [
    "palette.frequency.mid",
    "palette.frequency.high",
    "Frequency Mid and High",
    "palette.frequency.mid",
  ],
];

function targetFor(id) {
  if (id.startsWith("palette.")) return { page: "palettes", id };
  if (id.startsWith("core.")) return { page: "core", id };
  return { page: "advanced", id };
}

export function analyzeThemeVisuals(theme) {
  return analyzeResolvedThemeVisuals(compileTheme(theme));
}

export function analyzeResolvedThemeVisuals(resolved) {
  const warnings = THEME_CONTRAST_CHECKS.map((spec) => contrastWarning(resolved, spec)).filter(
    Boolean
  );

  for (const [first, second, label, targetId] of THEME_SEPARATION_CHECKS) {
    const target = targetFor(targetId);
    const result = separationWarning(resolved, first, second, {
      label,
      targetDistance: 0.08,
      target,
      section: target.page === "palettes" ? "Palettes" : "Modules",
      consumers: ["thin traces", "small markers", "overlapping data"],
    });
    if (result) warnings.push(result);
  }

  const surfacePairs = [
    ["interface.surface.panel", "interface.surface.raised", "Panel and Raised Surface", 0.015],
    ["interface.surface.control", "interface.surface.muted", "Control and Muted Surface", 0.04],
    [
      "interface.surface.control",
      "interface.surface.selected",
      "Control and Selected Surface",
      0.04,
    ],
  ];
  for (const [first, second, label, targetDistance] of surfacePairs) {
    const distance = themeColorDistance(resolved.roles[first], resolved.roles[second]);
    if (distance >= targetDistance) continue;
    warnings.push(
      warning({
        code: "surfaceCollision",
        title: `${label} are difficult to distinguish`,
        message: `${label} measure ${distance.toFixed(3)} OKLab distance; their hierarchy or state may disappear.`,
        roleIds: [first, second],
        target: { page: "advanced", id: second },
        section: "Interface",
        metric: {
          label: "Color distance",
          value: Number(distance.toFixed(4)),
          target: targetDistance,
        },
        consumers: ["panels", "controls", "selected and muted states"],
      })
    );
  }

  const stops = resolved.roles["palette.intensity.stops"];
  for (let index = 1; index < stops.length; index += 1) {
    const distance = themeColorDistance(stops[index - 1].color, stops[index].color);
    if (distance >= 0.035) continue;
    warnings.push(
      warning({
        code: "intensityCollision",
        title: `Intensity stops ${index} and ${index + 1} are difficult to distinguish`,
        message: `Adjacent Intensity stops measure ${distance.toFixed(3)} OKLab distance; the recommended target is 0.04.`,
        roleIds: ["palette.intensity.stops"],
        target: { page: "palettes", id: `palette.intensity.stops.${index}` },
        section: "Palettes",
        metric: { label: "OKLab distance", value: Number(distance.toFixed(4)), target: 0.035 },
        consumers: ["Spectrogram heatmap", "Spectrogram 3D colorized modes"],
      })
    );
  }

  return {
    warnings,
    communityPublication: {
      eligible: true,
      blockers: [],
      scope: "visualReviewOnly",
    },
  };
}
