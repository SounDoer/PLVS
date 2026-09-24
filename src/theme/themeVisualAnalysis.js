import { compileTheme } from "./compileTheme.js";
import { hexToOklch } from "./colorTransform.js";

function channels(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function luminance(hex) {
  const [r, g, b] = channels(hex).map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

export function themeContrastRatio(a, b) {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

export function themeColorDistance(a, b) {
  const first = hexToOklch(a);
  const second = hexToOklch(b);
  const a1 = first.C * Math.cos((first.H * Math.PI) / 180);
  const b1 = first.C * Math.sin((first.H * Math.PI) / 180);
  const a2 = second.C * Math.cos((second.H * Math.PI) / 180);
  const b2 = second.C * Math.sin((second.H * Math.PI) / 180);
  return Math.hypot(first.L - second.L, a1 - a2, b1 - b2);
}

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
  publicationBlocker = null,
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
    publicationBlocker,
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
    publicationBlocker: spec.standard
      ? {
          code: "accessibilityContrast",
          standard: spec.standard,
        }
      : null,
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

const CONTRAST_CHECKS = [
  {
    label: "Primary Text on Panel",
    foreground: "interface.text.primary",
    background: "interface.surface.panel",
    targetRatio: 4.5,
    target: { page: "core", id: "core.text" },
    section: "Core",
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
    ["Primary Data", "data.primary", "core.primaryData"],
    ["Primary Snapshot", "data.snapshot.primary", "waveform.snapshot"],
    ["Secondary Data", "data.secondary", "core.secondaryData"],
    ["Secondary Snapshot", "data.snapshot.secondary", "spectrum.secondarySnapshot"],
  ].map(([label, foreground, targetId]) => ({
    label: `${label} on Panel`,
    foreground,
    background: "interface.surface.panel",
    targetRatio: 3,
    target: targetFor(targetId),
    section: targetId.startsWith("core.") ? "Core" : "Modules",
    consumers: ["essential chart lines", "measurement traces", "small data markers"],
    standard: WCAG_NON_TEXT_CONTRAST,
  })),
];

const SEPARATION_CHECKS = [
  ["data.primary", "data.snapshot.primary", "Primary Data and Snapshot", "waveform.snapshot"],
  [
    "data.secondary",
    "data.snapshot.secondary",
    "Secondary Data and Snapshot",
    "spectrum.secondarySnapshot",
  ],
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
  const resolved = compileTheme(theme);
  const warnings = CONTRAST_CHECKS.map((spec) => contrastWarning(resolved, spec)).filter(Boolean);

  for (const [first, second, label, targetId] of SEPARATION_CHECKS) {
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

  const blockers = warnings
    .filter((item) => item.publicationBlocker)
    .map((item) => ({
      warningId: item.id,
      ...item.publicationBlocker,
      roleIds: item.roleIds,
      metric: item.metric,
    }));

  return {
    warnings,
    communityPublication: {
      eligible: blockers.length === 0,
      blockers,
      scope: "coveredContrastChecks",
    },
  };
}
