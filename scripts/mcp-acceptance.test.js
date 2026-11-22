import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { MCP_TOOLS, checkToolList, isPng, startMcpClient } from "./mcp-acceptance.mjs";

function tools(overrides = {}) {
  return Object.entries(MCP_TOOLS).map(([name, kind]) => ({
    name,
    annotations: { readOnlyHint: kind === "read", destructiveHint: kind === "risky" },
    ...overrides[name],
  }));
}

describe("MCP acceptance", () => {
  it("accepts exactly the eight tools with their hints", () => {
    expect(() => checkToolList(tools())).not.toThrow();
    expect(() => checkToolList(tools().slice(1))).toThrow();
    expect(() =>
      checkToolList(
        tools({ plvs_change: { annotations: { readOnlyHint: false, destructiveHint: true } } })
      )
    ).toThrow(/plvs_change destructive/);
  });

  it("recognizes a PNG by its signature", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]).toString("base64");
    expect(isPng(png)).toBe(true);
    expect(isPng(Buffer.from("GIF89a").toString("base64"))).toBe(false);
  });

  it("matches newline-delimited responses to requests and closes stdin", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const child = Object.assign(new EventEmitter(), { stdin, stdout, stderr: new PassThrough() });
    const written = [];
    stdin.on("data", (chunk) => {
      for (const line of chunk.toString().split("\n").filter(Boolean)) {
        const message = JSON.parse(line);
        written.push(message);
        if (message.id) {
          stdout.write("not json\n");
          stdout.write(
            `${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { echo: message.method } })}\n`
          );
        }
      }
    });
    stdin.on("finish", () => child.emit("exit", 0));
    const client = startMcpClient("plvs-cli", { spawnImpl: /** @type {any} */ (() => child) });

    await expect(client.request("tools/list", {})).resolves.toEqual({ echo: "tools/list" });
    client.notify("notifications/initialized");
    await expect(client.close()).resolves.toBe(0);
    expect(written.map(({ method }) => method)).toEqual([
      "tools/list",
      "notifications/initialized",
    ]);
  });
});
