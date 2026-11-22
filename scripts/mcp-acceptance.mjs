import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import process from "node:process";
import { createInterface } from "node:readline";

/** The eight tools `plvs-cli mcp` offers, and which of them may change PLVS. */
export const MCP_TOOLS = Object.freeze({
  plvs_capabilities: "read",
  plvs_inspect: "read",
  plvs_describe: "read",
  plvs_query: "read",
  plvs_wait: "read",
  plvs_screenshot: "read",
  plvs_change: "change",
  plvs_change_risky: "risky",
});

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const RESPONSE_TIMEOUT_MS = 60_000;

/**
 * Checks the advertised tool list: exactly the eight tools, read-only hints on reads, and the
 * destructive hint on the risky change tool alone.
 *
 * @param {Array<{ name: string, annotations?: { readOnlyHint?: boolean, destructiveHint?: boolean } }>} tools
 */
export function checkToolList(tools) {
  assert.deepEqual(tools.map(({ name }) => name).sort(), Object.keys(MCP_TOOLS).sort());
  for (const tool of tools) {
    const kind = MCP_TOOLS[tool.name];
    assert.equal(tool.annotations?.readOnlyHint, kind === "read", `${tool.name} readOnlyHint`);
    assert.equal(tool.annotations?.destructiveHint, kind === "risky", `${tool.name} destructive`);
  }
}

/** @param {string} base64 */
export function isPng(base64) {
  return Buffer.from(base64, "base64").subarray(0, 8).equals(PNG_SIGNATURE);
}

/**
 * A newline-delimited JSON-RPC client for one `plvs-cli mcp` process, as a chat app runs it.
 *
 * @param {string} executable
 * @param {{ env?: NodeJS.ProcessEnv, spawnImpl?: typeof spawn }} [options]
 */
export function startMcpClient(executable, { env = process.env, spawnImpl = spawn } = {}) {
  const child = spawnImpl(executable, ["mcp"], { env, stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map();
  let nextId = 0;
  let stderr = "";
  child.stderr?.on("data", (chunk) => (stderr += chunk));
  const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
  createInterface({ input: child.stdout }).on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const waiter = pending.get(message.id);
    if (waiter) {
      pending.delete(message.id);
      waiter(message);
    }
  });
  const write = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  return {
    /** @param {string} method @param {object} params */
    request(method, params) {
      nextId += 1;
      const id = nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(
            new Error(`MCP ${method} did not answer within ${RESPONSE_TIMEOUT_MS} ms. ${stderr}`)
          );
        }, RESPONSE_TIMEOUT_MS);
        pending.set(id, (message) => {
          clearTimeout(timer);
          if (message.error) reject(new Error(`MCP ${method} failed: ${message.error.message}`));
          else resolve(message.result);
        });
        write({ jsonrpc: "2.0", id, method, params });
      });
    },
    /** @param {string} method */
    notify(method) {
      write({ jsonrpc: "2.0", method });
    },
    /** @param {string} name @param {object} args */
    async call(name, args = {}) {
      const result = await this.request("tools/call", { name, arguments: args });
      return { ...result, envelope: result.structuredContent };
    },
    async close() {
      child.stdin.end();
      return exited;
    },
  };
}

/**
 * Drives `plvs-cli mcp` against the running app the way a chat app would. Changes only dry-run;
 * nothing in PLVS is modified.
 *
 * @param {{ executable: string, instanceId: string, env?: NodeJS.ProcessEnv }} options
 */
export async function runMcpContract({ executable, instanceId, env }) {
  const client = startMcpClient(executable, { env });
  const instance = { instance: instanceId };
  try {
    const initialized = await client.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "plvs-acceptance", version: "1" },
    });
    assert.match(initialized.serverInfo.name, /^plvs(-dev|-preview)?$/);
    assert.ok(initialized.instructions?.includes("plvs_inspect"));
    client.notify("notifications/initialized");
    checkToolList((await client.request("tools/list", {})).tools);

    const described = await client.call("plvs_describe", { command: "loudnessProfile.select" });
    assert.equal(described.envelope.result.tool, "plvs_change");

    const inspected = await client.call("plvs_inspect", instance);
    assert.equal(inspected.isError, false);
    const revision = inspected.envelope.result.revision;
    assert.ok(Number.isSafeInteger(revision));

    const dryRun = await client.call("plvs_change", {
      command: "view.update",
      params: { patch: {}, expectedRevision: revision, dryRun: true },
      ...instance,
    });
    assert.equal(dryRun.isError, false, JSON.stringify(dryRun.envelope));
    assert.equal(dryRun.envelope.result.dryRun, true);

    const conflict = await client.call("plvs_change", {
      command: "view.update",
      params: { patch: {}, expectedRevision: revision + 1000, dryRun: true },
      ...instance,
    });
    assert.equal(conflict.envelope.error?.code, "revisionConflict");

    const misrouted = await client.call("plvs_change", { command: "config.reset", ...instance });
    assert.match(misrouted.envelope.error?.message ?? "", /plvs_change_risky/);

    const relative = await client.call("plvs_change", {
      command: "transport.file.analyze",
      params: { path: "mix.wav", expectedRevision: revision },
      ...instance,
    });
    assert.match(relative.envelope.error?.message ?? "", /absolute path/);

    const waited = await client.call("plvs_wait", {
      command: "app.wait",
      params: { afterRevision: revision, timeoutMs: 300 },
      ...instance,
    });
    assert.ok(
      ["stillWaiting", "changed"].includes(waited.envelope.result?.outcome),
      JSON.stringify(waited.envelope)
    );

    const screenshot = await client.call("plvs_screenshot", instance);
    const image = screenshot.content.find((block) => block.type === "image");
    assert.equal(image?.mimeType, "image/png");
    assert.ok(isPng(image.data), "screenshot is not a PNG");
    assert.equal(screenshot.envelope.result.artifact.stagedPath, undefined);

    return [
      "Initialized plvs-cli mcp and verified eight tools with read-only and destructive hints.",
      "Dry-ran a change, passed a revision conflict through, refused a risky command on the ordinary tool and a relative audio path.",
      `Segmented app.wait answered ${waited.envelope.result.outcome}; the screenshot came back as an inline PNG.`,
    ];
  } finally {
    const code = await client.close();
    assert.equal(code, 0, "plvs-cli mcp did not exit cleanly when the client closed");
  }
}
