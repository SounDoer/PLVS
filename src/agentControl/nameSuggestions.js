/**
 * "Did you mean" support for Agent Control errors. A caller that names something that does not
 * exist -- a Panel ID, a control in a patch -- gets the closest existing names back in the error
 * details, so it can correct itself without a separate discovery round trip.
 */

const MAX_SUGGESTIONS = 3;

/** Optimal string alignment distance: Levenshtein plus adjacent transpositions ("gird" → "grid"). */
function editDistance(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d = Array.from({ length: rows }, (_, i) => {
    const row = new Array(cols).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j < cols; j += 1) d[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[rows - 1][cols - 1];
}

/** Lower case without separators, so `spectrum_grid`, `Spectrum-Grid` and `spectrumGrid` agree. */
function normalized(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The existing names closest to `input`, best first: a spelling or case variant, a near typo, or a
 * name that contains the input or is contained in it.
 *
 * @param {unknown} input
 * @param {Iterable<string>} candidates
 * @returns {string[]}
 */
export function suggestNames(input, candidates) {
  if (typeof input !== "string" || input.length === 0) return [];
  const wanted = normalized(input);
  if (!wanted) return [];
  const allowance = Math.max(1, Math.floor(wanted.length / 3));
  const scored = [];
  for (const candidate of new Set(candidates)) {
    if (typeof candidate !== "string" || candidate === input) continue;
    const name = normalized(candidate);
    if (!name) continue;
    let score;
    if (name === wanted) score = 0;
    else if (wanted.length >= 3 && (name.includes(wanted) || wanted.includes(name))) {
      score = 1 + Math.abs(name.length - wanted.length) / 100;
    } else {
      const distance = editDistance(wanted, name);
      if (distance > allowance) continue;
      score = 1 + distance;
    }
    scored.push({ candidate, score });
  }
  scored.sort((a, b) => a.score - b.score || a.candidate.localeCompare(b.candidate));
  return scored.slice(0, MAX_SUGGESTIONS).map(({ candidate }) => candidate);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The value at a `$.a.b` issue path inside `root`, or undefined. Array indexes are not followed. */
function valueAtPath(root, segments) {
  let value = root;
  for (const segment of segments) {
    if (!isRecord(value)) return undefined;
    value = value[segment];
  }
  return value;
}

/**
 * Adds `suggestions` to each `unknownControl` issue, drawn from the names that exist at the same
 * place in `current`, the public state the patch is applied to. When the patch repeats the wrapper
 * that inspection puts around that state (`{ "controls": { ... } }` for a Panel), the issue says to
 * remove it instead.
 *
 * @param {Array<{ code: string, path: string, message: string }>} issues
 * @param {unknown} current
 * @param {{ wrapper?: string, command?: string }} [options]
 */
export function withControlSuggestions(issues, current, { wrapper, command } = {}) {
  return issues.map((entry) => {
    if (entry?.code !== "unknownControl" || typeof entry.path !== "string") return entry;
    const match = /^\$((?:\.[A-Za-z0-9_-]+)+)$/.exec(entry.path);
    if (!match) return entry;
    const segments = match[1].slice(1).split(".");
    const name = segments.at(-1);
    if (wrapper && segments.length === 1 && name === wrapper) {
      return {
        ...entry,
        message: `${command ?? "This command"} takes the fields inside "${wrapper}" directly: remove the "${wrapper}" wrapper that inspection shows around them.`,
      };
    }
    const siblings = valueAtPath(current, segments.slice(0, -1));
    if (!isRecord(siblings)) return entry;
    const suggestions = suggestNames(name, Object.keys(siblings));
    return suggestions.length > 0 ? { ...entry, suggestions } : entry;
  });
}
