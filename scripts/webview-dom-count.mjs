/**
 * Counts the DOM mutations the running app makes, per panel, per second.
 *
 * The canvas counter (`webview-draw-count.mjs`) answers this for the panels that paint. The
 * readout panels -- Level Meter, Loudness, Stats -- draw nothing: they re-render React elements
 * and write attributes, and their per-frame cost is the number of nodes they touch. A CPU profile
 * shows `setAttribute` near the top without saying which panel issued the writes or how many a
 * single update makes, and those are the two numbers that decide whether anything is worth doing.
 *
 * Prerequisites are the profiler's (see `docs/working/perf/README.md`):
 *
 *   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 npm run desktop
 *   node scripts/webview-dom-count.mjs --seconds 5
 *
 * **Frames have to be moving.** A still window mutates nothing, which reads exactly like a panel
 * that is already efficient. In a remote session file analysis is the way to move them.
 *
 * **The observer costs something**, and it is removed again when this finishes -- never leave it
 * installed and then record a profile.
 */
import { pathToFileURL } from "node:url";

import { connectToPage } from "./webview-draw-count.mjs";

const DEFAULTS = { port: 9222, seconds: 5, top: 6 };

export function parseArgs(argv) {
  const options = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inline] = argv[i].split("=");
    const take = () => inline ?? argv[++i];
    if (flag === "--port") options.port = Number(take());
    else if (flag === "--seconds") options.seconds = Number(take());
    else if (flag === "--top") options.top = Number(take());
    else if (flag === "--help" || flag === "-h") options.help = true;
    else throw new Error(`unknown flag: ${flag}`);
  }
  if (!Number.isFinite(options.port) || options.port <= 0) throw new Error("--port must be > 0");
  if (!Number.isFinite(options.seconds) || options.seconds <= 0) {
    throw new Error("--seconds must be > 0");
  }
  return options;
}

function pageInstaller() {
  if (globalThis.__PLVS_DOM_COUNT__) globalThis.__PLVS_DOM_COUNT__.uninstall();

  const counts = new Map();
  let startedAt = performance.now();

  /**
   * Names a mutation by the workspace slot it happened in. `data-leaf-path` is what separates two
   * panels of the same kind; the title is what makes the row readable. Read at mutation time, so a
   * subtree React replaces keeps its identity.
   */
  const labelFor = (node) => {
    const element = node?.nodeType === 1 ? node : node?.parentElement;
    const leaf = element?.closest?.("[data-leaf]");
    if (!leaf) return element ? "(outside any panel)" : "(detached)";
    const title = leaf.querySelector("[data-panel-title-group]")?.textContent?.trim();
    return title ? `${title} @ ${leaf.dataset.leafPath}` : `leaf ${leaf.dataset.leafPath}`;
  };

  const rowFor = (label) => {
    let row = counts.get(label);
    if (!row) {
      row = { label, attributes: 0, childList: 0, characterData: 0, attributeNames: {} };
      counts.set(label, row);
    }
    return row;
  };

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const row = rowFor(labelFor(record.target));
      if (record.type === "attributes") {
        row.attributes += 1;
        const name = record.attributeName ?? "(unnamed)";
        row.attributeNames[name] = (row.attributeNames[name] ?? 0) + 1;
      } else if (record.type === "childList") {
        row.childList += record.addedNodes.length + record.removedNodes.length;
      } else {
        row.characterData += 1;
      }
    }
  });

  globalThis.__PLVS_DOM_COUNT__ = {
    reset() {
      counts.clear();
      startedAt = performance.now();
    },
    read() {
      const elapsedSec = (performance.now() - startedAt) / 1000;
      const rows = [...counts.values()]
        .map((row) => ({
          ...row,
          total: row.attributes + row.childList + row.characterData,
          attributeNames: Object.entries(row.attributeNames)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4),
        }))
        .sort((a, b) => b.total - a.total);
      return { elapsedSec, rows };
    },
    uninstall() {
      observer.disconnect();
      delete globalThis.__PLVS_DOM_COUNT__;
    },
  };

  observer.observe(document.body, {
    subtree: true,
    attributes: true,
    childList: true,
    characterData: true,
  });
  return true;
}

export function formatReport({ elapsedSec, rows }, top = DEFAULTS.top) {
  if (rows.length === 0) {
    return [
      `Nothing mutated in ${elapsedSec.toFixed(1)}s. A still window looks exactly like this one:`,
      "start capture, or drive file analysis, then count again.",
    ];
  }
  const lines = [`Over ${elapsedSec.toFixed(1)}s, per second:`, ""];
  for (const row of rows.slice(0, top)) {
    const perSec = (value) => (value / elapsedSec).toFixed(1);
    lines.push(
      `  ${row.label}` +
        `\n      ${perSec(row.total).padStart(8)} mutations/s` +
        `  (attributes ${perSec(row.attributes)}, nodes ${perSec(row.childList)}` +
        `, text ${perSec(row.characterData)})`
    );
    if (row.attributeNames.length > 0) {
      const named = row.attributeNames
        .map(([name, count]) => `${name} ${perSec(count)}/s`)
        .join(", ");
      lines.push(`      attributes written: ${named}`);
    }
  }
  if (rows.length > top) lines.push(`  ... and ${rows.length - top} quieter rows`);
  return lines;
}

export async function countDomMutations({ port, seconds, top }, log = console.log) {
  const { target, socket, evaluate } = await connectToPage(port);
  log(`Attached to ${target.url}`);
  try {
    await evaluate(`(${pageInstaller.toString()})()`);
    await evaluate("globalThis.__PLVS_DOM_COUNT__.reset(), true");
    log(`Counting for ${seconds}s — make sure frames are actually moving.`);
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    const reading = await evaluate("globalThis.__PLVS_DOM_COUNT__.read()");
    await evaluate("globalThis.__PLVS_DOM_COUNT__.uninstall(), true");
    log("");
    for (const line of formatReport(reading, top)) log(line);
    return reading;
  } finally {
    socket.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: node scripts/webview-dom-count.mjs [--port 9222] [--seconds 5] [--top 6]");
  } else {
    await countDomMutations(options);
  }
}
