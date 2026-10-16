import { createServer } from "node:http";
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
const root = path.resolve(process.argv[2] ?? "");
const config = JSON.parse(readFileSync(path.join(root, "acceptance.json"), "utf8"));
const latest = config.artifacts.at(-1);
if (config.artifacts.length !== 2 || !config.identity.startsWith("com.soundoer.plvs.updatetest."))
  throw new Error("Not a complete isolated acceptance build");
createServer((request, response) => {
  appendFileSync(
    path.join(root, "requests.jsonl"),
    JSON.stringify({ time: new Date().toISOString(), path: request.url }) + "\n"
  );
  if (request.url === "/latest.json") {
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        version: latest.version,
        notes: `# Update Acceptance ${latest.version}\n\n- Verify Offline Installation\n- Restore Workbenches and Dock`,
        platforms: {
          "windows-x86_64": {
            url: `http://127.0.0.1:${config.port}/package.exe`,
            signature: latest.signature,
          },
        },
      })
    );
  } else if (request.url === "/package.exe") {
    const bytes = readFileSync(path.join(root, latest.file));
    response.setHeader("Content-Length", bytes.length);
    response.end(bytes);
  } else {
    response.statusCode = 404;
    response.end();
  }
}).listen(config.port, "127.0.0.1", () =>
  console.log(`Local acceptance feed: http://127.0.0.1:${config.port}/latest.json`)
);
