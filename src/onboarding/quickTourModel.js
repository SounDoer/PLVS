export const QUICK_TOUR_STEPS = Object.freeze([
  {
    target: "transport",
    title: "Start Monitoring",
    body: "Play some audio, then click Start to begin metering your selected source. Automatic uses your default system output.",
  },
  {
    target: "sources",
    title: "Choose Your Source",
    body: "Choose a system output, an input device, or a supported application. Automatic follows your default system output.",
  },
  {
    target: "profile",
    title: "Loudness Profile",
    body: "Choose reference lines and warning thresholds for your session. Edit a profile to match your requirements.",
  },
  {
    target: "modules",
    title: "Manage Your Panels",
    body: "Add, rename, or remove panels. Add multiple instances to view the same meter in different ways.",
  },
  {
    target: "views",
    title: "Adjust Your View",
    body: "Keep PLVS on top, simplify the interface, or adjust transparency.",
  },
  {
    target: "presets",
    title: "Save Your Workspace",
    body: "Save your layout and configuration as a Preset, then switch between setups for different tasks.",
  },
  {
    target: "panel-settings",
    title: "Panel Settings",
    body: "Each panel has its own settings. Open this menu to adjust its analysis and display options.",
  },
  {
    target: "history",
    title: "Inspect a Moment",
    body: "Click a history chart to inspect that moment across all meters. Live capture continues in the background.",
  },
  {
    target: "clear",
    title: "Clear Measurement",
    body: "Clear resets the current measurement data so you can begin a fresh measurement. You don't need to clear anything to continue the tour.",
  },
  {
    target: "settings",
    title: "Application Settings",
    body: "Open Settings for application preferences. Quick Tour is at the bottom if you'd like to view this guide again.",
  },
]);

export function tourStepContent(
  step,
  { running, snapshot, hasHistory, dockSupported, applicationsSupported }
) {
  const content = { ...QUICK_TOUR_STEPS[step] };
  if (step === 0 && snapshot) {
    content.body =
      "You're viewing a Snapshot. Return to Live using this button to access Start or Stop.";
  } else if (step === 0 && running) {
    content.body = "Metering is running. You can stop it at any time using the same button.";
  }
  if (step === 1 && !applicationsSupported) {
    content.body =
      "Choose a system output or an input device. Automatic follows your default system output.";
  }
  if (step === 4 && dockSupported)
    content.body += " Use Dock for a slim meter strip at the screen edge.";
  if (step === 7 && snapshot) {
    content.target = "transport";
    content.body = "You're viewing a Snapshot. Click here to return to live readings.";
  } else if (step === 7 && !hasHistory) {
    content.body =
      "After measurement history accumulates, click a history chart to inspect a moment across all meters. You can continue the tour now.";
  }
  return content;
}

/** Keep a card in the viewport, preferring a side that does not cover its target. CSS px only. */
export function positionTourCard(target, card, viewport) {
  const gap = 12;
  const margin = 8;
  const clamp = (value, max) => Math.max(margin, Math.min(value, max - margin));
  if (!target)
    return {
      left: clamp(viewport.width - card.width - margin, viewport.width - card.width),
      top: margin,
    };
  const candidates = [
    { left: target.left, top: target.bottom + gap },
    { left: target.left, top: target.top - card.height - gap },
    { left: target.right + gap, top: target.top },
    { left: target.left - card.width - gap, top: target.top },
  ].map((point) => ({
    left: clamp(point.left, viewport.width - card.width),
    top: clamp(point.top, viewport.height - card.height),
  }));
  const overlap = ({ left, top }) =>
    Math.max(0, Math.min(left + card.width, target.right) - Math.max(left, target.left)) *
    Math.max(0, Math.min(top + card.height, target.bottom) - Math.max(top, target.top));
  return candidates.reduce((best, point) => (overlap(point) < overlap(best) ? point : best));
}
