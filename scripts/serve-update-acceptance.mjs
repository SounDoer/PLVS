import { createServer } from "node:http";
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  acceptanceFeedManifest,
  parseFeedFault,
  resolveReceiptFile,
  validateAcceptanceReceipt,
} from "./update-acceptance-lib.mjs";

const usage = "Usage: node scripts/serve-update-acceptance.mjs <artifact-root> [--fault <mode>]";

export function parseServeArguments(args) {
  const root = args[0];
  if (!root || root.startsWith("--")) throw new Error(usage);
  let fault = "valid";
  for (let index = 1; index < args.length; index += 2) {
    if (args[index] !== "--fault" || !args[index + 1]) throw new Error(usage);
    fault = parseFeedFault(args[index + 1]);
  }
  return { root: path.resolve(root), fault };
}

export function createAcceptanceFeed({ root, fault = "valid", onRequest }) {
  const selectedFault =
    typeof fault === "function"
      ? () => parseFeedFault(fault())
      : (() => {
          const fixed = parseFeedFault(fault);
          return () => fixed;
        })();
  const receipt = JSON.parse(readFileSync(path.join(root, "acceptance.json"), "utf8"));
  const { descriptor, latest } = validateAcceptanceReceipt(receipt, root);
  const packageFile = resolveReceiptFile(root, latest.file);
  return createServer((request, response) => {
    const requestFault = selectedFault();
    const event = { time: new Date().toISOString(), path: request.url, fault: requestFault };
    appendFileSync(path.join(root, "requests.jsonl"), `${JSON.stringify(event)}\n`);
    onRequest?.(event);
    if (request.url === "/latest.json") {
      if (requestFault === "manifest-unavailable") {
        response.statusCode = 503;
        response.end("Acceptance manifest unavailable");
        return;
      }
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(acceptanceFeedManifest(receipt, requestFault)));
      return;
    }
    if (request.url === descriptor.packageEndpoint) {
      let bytes = readFileSync(packageFile);
      if (requestFault === "truncated-package") {
        bytes = bytes.subarray(0, Math.max(1, bytes.length >> 1));
      }
      response.setHeader("Content-Length", bytes.length);
      response.end(bytes);
      return;
    }
    response.statusCode = 404;
    response.end();
  });
}

export function startAcceptanceFeed({ root, fault = "valid", log = console.log }) {
  const receipt = JSON.parse(readFileSync(path.join(root, "acceptance.json"), "utf8"));
  validateAcceptanceReceipt(receipt, root);
  const server = createAcceptanceFeed({ root, fault });
  server.listen(receipt.feed.port, receipt.feed.host, () => {
    log(
      `Local acceptance feed (${fault}): http://${receipt.feed.host}:${receipt.feed.port}/latest.json`
    );
  });
  return server;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    startAcceptanceFeed(parseServeArguments(process.argv.slice(2)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
