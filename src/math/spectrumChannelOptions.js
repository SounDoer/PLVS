/**
 * @typedef {{ type: "pair"; x: number; y: number } | { type: "single"; ch: number }} SpectrumChannelSel
 * @typedef {{ key: string; label: string; sel: SpectrumChannelSel }} SpectrumChannelOption
 */

const KNOWN_LAYOUTS = {
  stereo: { pairs: [[0, 1]], singles: [] },
  5.1: {
    pairs: [
      [0, 1],
      [4, 5],
    ],
    singles: [2, 3],
  },
  7.1: {
    pairs: [
      [0, 1],
      [4, 5],
      [6, 7],
    ],
    singles: [2, 3],
  },
};

/**
 * @param {number} channelCount
 * @param {string[]} labels
 * @returns {SpectrumChannelOption[]}
 */
export function buildSpectrumChannelOptions(channelCount, labels) {
  const n = Math.max(0, Math.floor(Number(channelCount)));
  if (n < 2) return [];

  const layout = n === 2 ? "stereo" : n === 6 ? "5.1" : n === 8 ? "7.1" : null;

  if (layout) {
    const { pairs, singles } = KNOWN_LAYOUTS[layout];
    const opts = [];
    for (const [x, y] of pairs) {
      const lx = labels[x] ?? `Ch ${x + 1}`;
      const ly = labels[y] ?? `Ch ${y + 1}`;
      opts.push({ key: `p-${x}-${y}`, label: `${lx}+${ly}`, sel: { type: "pair", x, y } });
    }
    for (const ch of singles) {
      const lc = labels[ch] ?? `Ch ${ch + 1}`;
      opts.push({ key: `s-${ch}`, label: lc, sel: { type: "single", ch } });
    }
    return opts;
  }

  // Unknown channel count: adjacent pairs only.
  const opts = [];
  for (let i = 0; i + 1 < n; i += 2) {
    const lx = labels[i] ?? `Ch ${i + 1}`;
    const ly = labels[i + 1] ?? `Ch ${i + 2}`;
    opts.push({
      key: `p-${i}-${i + 1}`,
      label: `${lx}+${ly}`,
      sel: { type: "pair", x: i, y: i + 1 },
    });
  }
  return opts;
}

/** @returns {SpectrumChannelSel} */
export function defaultSpectrumChannel() {
  return { type: "pair", x: 0, y: 1 };
}

/**
 * @param {SpectrumChannelSel | null} sel
 * @param {SpectrumChannelOption[]} options
 * @returns {SpectrumChannelSel}
 */
export function clampSpectrumChannelToAvailable(sel, options) {
  if (!sel || options.length === 0) return defaultSpectrumChannel();
  const key = sel.type === "pair" ? `p-${sel.x}-${sel.y}` : `s-${sel.ch}`;
  return options.some((o) => o.key === key) ? sel : (options[0]?.sel ?? defaultSpectrumChannel());
}
