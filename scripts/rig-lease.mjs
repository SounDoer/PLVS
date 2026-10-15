/**
 * An exclusive lease on the capture rig, shared by every worktree of the repository (ADR 0028).
 *
 * VB-Cable and the VLC test tone exist once per machine. Two runs at once sum their tones and
 * both read +6.02 dB, which is how the rig's 2026-10-15 soak was spoiled. The lease is a file in
 * the Git common directory: creating it exclusively takes the rig, deleting it gives it back.
 *
 * It is advisory. It holds only while the rig is driven through the scripts that take it.
 */
import { spawnSync } from "node:child_process";
import { closeSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";

export const LEASE_FILE_NAME = "plvs-capture-rig.lock";

/** A process start time read back from the OS differs from Node's own estimate by this much. */
const START_TIME_TOLERANCE_MS = 5000;

/** An unreadable lease younger than this may be one another process is still writing. */
const UNREADABLE_GRACE_MS = 10_000;

const UNKNOWN_HOLDER = {
  command: "an unidentified run",
  worktree: "unknown",
  pid: "?",
  startedAt: "?",
};

export class LeaseBusyError extends Error {
  constructor(holder) {
    super(`The capture rig is in use by ${describeHolder(holder)}.`);
    this.holder = holder;
  }
}

export function leasePath(gitCommonDir) {
  return join(gitCommonDir, LEASE_FILE_NAME);
}

export function describeHolder(holder) {
  return `"${holder.command}" in ${holder.worktree} (pid ${holder.pid}, since ${holder.startedAt})`;
}

export function currentOwner({ worktree, command }) {
  return {
    pid: process.pid,
    processStartedAtMs: Math.round(Date.now() - process.uptime() * 1000),
    worktree,
    command,
    startedAt: new Date().toISOString(),
  };
}

function processStartTimeMs(pid) {
  if (process.platform !== "win32") return null;
  const result = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`,
    ],
    { encoding: "utf8", windowsHide: true }
  );
  if (result.status !== 0) return null;
  const parsed = Date.parse(result.stdout.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Alive means the PID exists and, on Windows, started when the holder said it did: Windows
 * reuses PIDs, so a live PID alone can belong to an unrelated process. Elsewhere only the PID is
 * checked; the rig is Windows-only today.
 */
export function holderIsAlive(holder) {
  try {
    process.kill(holder.pid, 0);
  } catch (error) {
    if (error.code === "ESRCH") return false;
  }
  if (process.platform !== "win32") return true;
  const started = processStartTimeMs(holder.pid);
  if (started === null) return false;
  return Math.abs(started - holder.processStartedAtMs) <= START_TIME_TOLERANCE_MS;
}

function readHolder(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function leaseAgeMs(path) {
  try {
    return Date.now() - statSync(path).mtimeMs;
  } catch {
    return Infinity;
  }
}

function sameHolder(a, b) {
  return a?.pid === b?.pid && a?.startedAt === b?.startedAt;
}

/**
 * Takes the lease or throws `LeaseBusyError`. A lease whose holder is gone is removed and the
 * create retried once. An unreadable lease is busy while it is young, because its holder may be
 * between creating and writing it, and stale once it is old.
 */
export function acquireLease(path, owner, { isAlive = holderIsAlive } = {}) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(path, "wx");
      try {
        writeSync(fd, JSON.stringify(owner));
      } finally {
        closeSync(fd);
      }
      return { path, owner };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    const holder = readHolder(path);
    if (holder ? isAlive(holder) : leaseAgeMs(path) < UNREADABLE_GRACE_MS) {
      throw new LeaseBusyError(holder ?? UNKNOWN_HOLDER);
    }
    // Remove only the stale lease just read, not one another process took in the meantime.
    if (sameHolder(readHolder(path), holder)) {
      try {
        unlinkSync(path);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }
  throw new LeaseBusyError(readHolder(path) ?? UNKNOWN_HOLDER);
}

/** Retries `acquireLease` until it succeeds, reporting the holder once. */
export async function waitForLease(path, owner, { isAlive, pollMs = 5000, onBusy } = {}) {
  let reported = false;
  for (;;) {
    try {
      return acquireLease(path, owner, { isAlive });
    } catch (error) {
      if (!(error instanceof LeaseBusyError)) throw error;
      if (!reported) onBusy?.(error.holder);
      reported = true;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

/** Gives the lease back, unless it has meanwhile passed to someone else. */
export function releaseLease(lease) {
  if (!lease || !sameHolder(readHolder(lease.path), lease.owner)) return;
  try {
    unlinkSync(lease.path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
