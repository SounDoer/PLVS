import { spawn } from "node:child_process";
import { createReadStream, watch } from "node:fs";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, relative, resolve, sep } from "node:path";
import process from "node:process";

const root = process.cwd();
const developmentRoot = resolve(root, "artifacts", "website-dev");
const content = resolve(root, "sharesets", "catalogue");
const buildScript = resolve(root, "scripts", "build-website.mjs");
const host = "127.0.0.1";
const port = 4173;
const reloadPath = "/_plvs/website-reload";
const reloadScript = `<script>new EventSource("${reloadPath}").addEventListener("reload",()=>location.reload())</script>`;

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".webp", "image/webp"],
  [".woff2", "font/woff2"],
  [".plvsloudness", "application/octet-stream"],
  [".plvspreset", "application/octet-stream"],
  [".plvstheme", "application/octet-stream"],
]);

let buildNumber = 0;
let currentOutput;

function runBuild(output) {
  return new Promise((resolveBuild, rejectBuild) => {
    const child = spawn(process.execPath, [buildScript, content, output], {
      cwd: root,
      stdio: "inherit",
    });
    child.on("error", rejectBuild);
    child.on("exit", (code, signal) => {
      if (code === 0) resolveBuild();
      else {
        rejectBuild(
          new Error(`Website build failed${signal ? ` after ${signal}` : ` with exit ${code}`}.`)
        );
      }
    });
  });
}

async function buildNext() {
  const output = join(developmentRoot, `build-${Date.now()}-${(buildNumber += 1)}`);
  await runBuild(output);
  const previous = currentOutput;
  currentOutput = output;
  if (previous) {
    try {
      await rm(previous, { recursive: true, force: true });
    } catch (error) {
      process.stderr.write(
        `Could not remove previous website build ${previous}: ${error instanceof Error ? error.message : String(error)}\n`
      );
    }
  }
}

function isWithin(parent, child) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}

async function resolveRequest(pathname) {
  const decoded = decodeURIComponent(pathname);
  const requested = resolve(currentOutput, `.${normalize(decoded)}`);
  if (!isWithin(currentOutput, requested)) return null;
  try {
    return (await stat(requested)).isDirectory() ? join(requested, "index.html") : requested;
  } catch (error) {
    if (error?.code === "ENOENT" && !extname(requested)) {
      const index = join(requested, "index.html");
      try {
        await stat(index);
        return index;
      } catch (indexError) {
        if (indexError?.code !== "ENOENT") throw indexError;
      }
    }
    if (error?.code !== "ENOENT") throw error;
    return null;
  }
}

const reloadClients = new Set();
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${host}:${port}`);
    if (url.pathname === reloadPath) {
      response.writeHead(200, {
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Content-Type": "text/event-stream",
      });
      response.write("retry: 500\n\n");
      reloadClients.add(response);
      request.on("close", () => reloadClients.delete(response));
      return;
    }

    const path = await resolveRequest(url.pathname);
    if (!path) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not Found\n");
      return;
    }

    const extension = extname(path).toLowerCase();
    const headers = {
      "Cache-Control": "no-store",
      "Content-Type": contentTypes.get(extension) ?? "application/octet-stream",
    };
    if (extension === ".html") {
      const html = await readFile(path, "utf8");
      response.writeHead(200, headers);
      response.end(
        html.includes("</body>") ? html.replace("</body>", `${reloadScript}</body>`) : html
      );
      return;
    }
    response.writeHead(200, headers);
    createReadStream(path).pipe(response);
  } catch (error) {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(`${error instanceof Error ? error.message : String(error)}\n`);
  }
});

await new Promise((resolveListen, rejectListen) => {
  server.once("error", rejectListen);
  server.listen(port, host, resolveListen);
});
try {
  await rm(developmentRoot, { recursive: true, force: true });
  await mkdir(developmentRoot, { recursive: true });
  await buildNext();
} catch (error) {
  await new Promise((resolveClose) => server.close(resolveClose));
  throw error;
}
process.stdout.write(
  `Website:  http://${host}:${port}/\nSharesets: http://${host}:${port}/sharesets/\n`
);

const watchedDirectories = [
  resolve(root, "website"),
  resolve(root, "docs", "user"),
  resolve(root, "sharesets", "catalogue"),
];
const watchedScripts = new Set([
  "build-website.mjs",
  "build-user-docs.mjs",
  "build-sharesets-site.mjs",
  "validate-website.mjs",
  "site-components.mjs",
  "preset-presentation.mjs",
]);
let timer;
let rebuilding = false;
let queued = false;

function scheduleRebuild() {
  clearTimeout(timer);
  timer = setTimeout(() => void rebuild(), 120);
}

const watchers = watchedDirectories.map((directory) =>
  watch(directory, { recursive: true }, scheduleRebuild)
);
watchers.push(
  watch(resolve(root, "scripts"), (_event, filename) => {
    if (filename && watchedScripts.has(String(filename))) scheduleRebuild();
  }),
  watch(resolve(root, "src", "workspace"), (_event, filename) => {
    if (String(filename) === "moduleCatalog.js") scheduleRebuild();
  })
);

async function rebuild() {
  if (rebuilding) {
    queued = true;
    return;
  }
  rebuilding = true;
  try {
    await buildNext();
    for (const client of reloadClients) client.write("event: reload\ndata: ready\n\n");
    process.stdout.write(`Website rebuilt at ${new Date().toLocaleTimeString()}.\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  } finally {
    rebuilding = false;
    if (queued) {
      queued = false;
      void rebuild();
    }
  }
}

async function close() {
  clearTimeout(timer);
  for (const watcher of watchers) watcher.close();
  for (const client of reloadClients) client.end();
  await new Promise((resolveClose) => server.close(resolveClose));
  process.exit(0);
}

process.on("SIGINT", () => void close());
process.on("SIGTERM", () => void close());
