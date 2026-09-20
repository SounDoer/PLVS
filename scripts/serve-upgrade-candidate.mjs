#!/usr/bin/env node
/**
 * HTTPS origin for a private upgrade candidate. The lab proxy/DNS layer may route only PLVS's
 * baked GitHub latest.json request here. Certificate creation/trust and network interception are
 * deliberately outside this script so it cannot silently modify a tester's trust store.
 */
import { createReadStream, readFileSync, statSync } from "node:fs";
import { createServer } from "node:https";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LATEST_PATH = "/SounDoer/PLVS/releases/latest/download/latest.json";

export function parseFaultMode(value = "none") {
  if (value === "none" || value === "http-503") return { kind: value };
  const match = /^drop:(0(?:\.\d+)?|1(?:\.0+)?)$/.exec(value);
  if (!match) throw new Error(`Invalid asset fault mode: ${value}`);
  return { kind: "drop", fraction: Number(match[1]) };
}

export function resolveCandidateRequest(root, pathname) {
  if (pathname === LATEST_PATH || pathname === "/latest.json") {
    return resolve(root, "latest.json");
  }
  const decoded = decodeURIComponent(pathname).replace(/^\/+/, "");
  if (!decoded || decoded !== basename(decoded)) return null;
  const target = resolve(root, decoded);
  const child = relative(resolve(root), target);
  return child && !child.startsWith("..") && !isAbsolute(child) ? target : null;
}

function option(name, fallback = null) {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function log(event) {
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);
}

export function startServer({ root, cert, key, host, port, assetFault }) {
  const fault = parseFaultMode(assetFault);
  const server = createServer(
    { cert: readFileSync(cert), key: readFileSync(key) },
    (request, response) => {
      const url = new URL(request.url, `https://${request.headers.host ?? host}`);
      const path = resolveCandidateRequest(root, url.pathname);
      if (!path) {
        response.writeHead(404).end();
        log({ path: url.pathname, status: 404 });
        return;
      }

      let size;
      try {
        size = statSync(path).size;
      } catch {
        response.writeHead(404).end();
        log({ path: url.pathname, status: 404 });
        return;
      }

      const isManifest = path.endsWith("latest.json");
      if (!isManifest && fault.kind === "http-503") {
        response.writeHead(503, { "Cache-Control": "no-store" }).end("Injected failure\n");
        log({ path: url.pathname, status: 503, fault: fault.kind });
        return;
      }

      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Length": size,
        "Content-Type": isManifest ? "application/json" : "application/octet-stream",
      });

      if (!isManifest && fault.kind === "drop") {
        const cutoff = Math.floor(size * fault.fraction);
        let sent = 0;
        const stream = createReadStream(path);
        stream.on("data", (chunk) => {
          const remaining = cutoff - sent;
          if (remaining <= 0) {
            stream.destroy();
            response.destroy();
            return;
          }
          const slice = chunk.subarray(0, remaining);
          sent += slice.length;
          response.write(slice);
          if (sent >= cutoff) {
            stream.destroy();
            response.destroy();
          }
        });
        log({ path: url.pathname, status: 200, fault: fault.kind, cutoff, size });
        return;
      }

      createReadStream(path).pipe(response);
      log({ path: url.pathname, status: 200, size });
    }
  );
  server.listen(port, host, () => log({ listening: true, host, port, root, assetFault }));
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = option("root");
  const cert = option("cert");
  const key = option("key");
  if (!root || !cert || !key) {
    console.error(
      "Usage: node scripts/serve-upgrade-candidate.mjs --root=<dir> --cert=<pem> --key=<pem> [--host=127.0.0.1] [--port=8443] [--asset-fault=none|http-503|drop:0.5]"
    );
    process.exit(1);
  }
  startServer({
    root,
    cert,
    key,
    host: option("host", "127.0.0.1"),
    port: Number(option("port", "8443")),
    assetFault: option("asset-fault", "none"),
  });
}
