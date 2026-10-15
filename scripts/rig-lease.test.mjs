import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  LeaseBusyError,
  acquireLease,
  currentOwner,
  holderIsAlive,
  leasePath,
  releaseLease,
  waitForLease,
} from "./rig-lease.mjs";

const owner = (pid, label = "smoke-capture.mjs") => ({
  pid,
  processStartedAtMs: 1,
  worktree: `/repos/${label}`,
  command: label,
  startedAt: `2026-10-15T00:00:0${pid % 10}.000Z`,
});

let directory;
let path;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "plvs-rig-lease-"));
  path = leasePath(directory);
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("acquireLease and releaseLease", () => {
  it("records the owner and removes the file on release", () => {
    const lease = acquireLease(path, owner(11));
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(owner(11));
    releaseLease(lease);
    expect(existsSync(path)).toBe(false);
  });

  it("refuses while a live holder has it, naming that holder", () => {
    acquireLease(path, owner(11, "soak-capture.mjs"));
    let caught;
    try {
      acquireLease(path, owner(22), { isAlive: () => true });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(LeaseBusyError);
    expect(caught.holder.command).toBe("soak-capture.mjs");
    expect(caught.message).toContain("soak-capture.mjs");
  });

  it("takes over a lease whose holder is gone", () => {
    acquireLease(path, owner(11));
    const lease = acquireLease(path, owner(22), { isAlive: () => false });
    expect(lease.owner.pid).toBe(22);
    expect(JSON.parse(readFileSync(path, "utf8")).pid).toBe(22);
  });

  it("treats a young unreadable lease as busy and an old one as stale", () => {
    writeFileSync(path, "");
    expect(() => acquireLease(path, owner(22), { isAlive: () => true })).toThrow(LeaseBusyError);
    const old = new Date(Date.now() - 60_000);
    utimesSync(path, old, old);
    expect(acquireLease(path, owner(22)).owner.pid).toBe(22);
  });

  it("never releases a lease that has passed to someone else", () => {
    const first = acquireLease(path, owner(11));
    acquireLease(path, owner(22), { isAlive: () => false });
    releaseLease(first);
    expect(JSON.parse(readFileSync(path, "utf8")).pid).toBe(22);
  });
});

describe("holderIsAlive", () => {
  it("accepts the current process as described by currentOwner", () => {
    expect(holderIsAlive(currentOwner({ worktree: "/w", command: "test" }))).toBe(true);
  });

  it("rejects a PID that has exited", () => {
    const child = spawnSync(process.execPath, ["-e", "0"]);
    expect(holderIsAlive({ ...owner(child.pid), processStartedAtMs: Date.now() })).toBe(false);
  });

  it.runIf(process.platform === "win32")("rejects a live PID that started at another time", () => {
    expect(holderIsAlive({ ...owner(process.pid), processStartedAtMs: 0 })).toBe(false);
  });
});

describe("concurrent acquisition", () => {
  it("lets exactly one of several racing processes take the lease", async () => {
    const moduleUrl = pathToFileURL(join(import.meta.dirname, "rig-lease.mjs")).href;
    const script = `
      const { acquireLease, currentOwner } = await import(${JSON.stringify(moduleUrl)});
      await new Promise((resolve) => setTimeout(resolve, Number(process.argv[2]) - Date.now()));
      try {
        acquireLease(process.argv[1], currentOwner({ worktree: "w", command: "race" }));
        console.log("won");
      } catch (error) {
        console.log(error.holder ? "busy" : error.message);
      }
      // The winner stays alive while the others check it.
      setTimeout(() => {}, 4000);
    `;
    const startAt = String(Date.now() + 1000);
    const runs = Array.from({ length: 4 }, () => {
      const child = spawn(process.execPath, ["--input-type=module", "-e", script, path, startAt]);
      let out = "";
      child.stdout.on("data", (chunk) => (out += chunk));
      return new Promise((resolve) => child.on("close", () => resolve(out.trim())));
    });
    const results = await Promise.all(runs);
    expect(results.filter((result) => result === "won")).toHaveLength(1);
    expect(results.filter((result) => result === "busy")).toHaveLength(3);
  }, 30_000);
});

describe("waitForLease", () => {
  it("reports the holder once and takes the lease when it is released", async () => {
    const first = acquireLease(path, owner(11));
    const onBusy = vi.fn();
    const waiting = waitForLease(path, owner(22), { isAlive: () => true, pollMs: 10, onBusy });
    await new Promise((resolve) => setTimeout(resolve, 60));
    releaseLease(first);
    const lease = await waiting;
    expect(lease.owner.pid).toBe(22);
    expect(onBusy).toHaveBeenCalledTimes(1);
    expect(onBusy.mock.calls[0][0].pid).toBe(11);
  });
});
