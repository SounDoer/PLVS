import { useEffect, useLayoutEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { exit } from "@tauri-apps/plugin-process";
import { flushPersistence } from "../persistence/index.js";
import { isTauri } from "../ipc/env.js";

const COMMAND_POLL_MS = 250;
const COMMAND_TIMEOUT_MS = 10_000;
const PREPARED_LEASE_MS = 30_000;

let lifecycle = null;

function operationId() {
  return globalThis.crypto?.randomUUID?.() ?? `operation-${Date.now()}-${Math.random()}`;
}

/**
 * @param {string} outcome
 */
async function acknowledge(command, outcome, detail = null) {
  await invoke("runtime_ack_command", {
    commandId: command.commandId,
    outcome,
    detail,
  });
}

/**
 * @param {string} action
 * @param {string} id
 */
async function issue(action, id, instanceIds = null, payload = null) {
  return invoke("runtime_issue_commands", {
    action,
    operationId: id,
    instanceIds,
    ...(payload === null ? {} : { payload }),
  });
}

async function waitFor(issued) {
  if (!issued.length) return [];
  return invoke("runtime_wait_commands", { issued, timeoutMs: COMMAND_TIMEOUT_MS });
}

async function stopAndFlush(current) {
  const wasRunning = current.running === true;
  await current.stop();
  try {
    await flushPersistence();
  } catch (error) {
    if (wasRunning) await current.start();
    throw error;
  }
  return wasRunning;
}

async function recoverExpiredPreparations(current, prepared) {
  const now = performance.now();
  for (const [operationId, state] of prepared) {
    if (state.expiresAt > now) continue;
    prepared.delete(operationId);
    if (state.wasRunning) {
      try {
        await current.start();
      } catch (error) {
        console.warn("Unable to resume Live capture after an expired workbench operation:", error);
      }
    }
  }
}

/** Native commands reject with plain objects as well as Errors; keep their message readable. */
export function failureDetail(error) {
  if (typeof error === "string" || error instanceof Error) return String(error);
  if (typeof error?.message === "string" && error.message) {
    return typeof error.code === "string" ? `${error.code}: ${error.message}` : error.message;
  }
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

async function handleRuntimeCommand(command, prepared) {
  const current = lifecycle;
  if (!current) return;
  try {
    if (command.action === "show") {
      await current.show();
      await acknowledge(command, "completed");
      return;
    }
    if (["hide", "settings", "selectSource", "applyPreset"].includes(command.action)) {
      if (current.busy || prepared.size)
        throw new Error("PLVS is preparing an application operation.");
      const handler = current.actions?.[command.action];
      if (!handler) throw new Error("The workbench action is not available.");
      const accepted = await handler(command.payload);
      if (accepted === false) throw new Error("The workbench refused the action.");
      await acknowledge(command, "completed");
      return;
    }
    if (command.action === "quitInstance") {
      if (current.blockingEditors.length) {
        // The tray has nowhere to explain the refusal, so bring forward the editor that caused it.
        await Promise.resolve(current.show()).catch(() => {});
        await acknowledge(command, "blocked", current.blockingEditors.join(", "));
        return;
      }
      const wasRunning = await stopAndFlush(current);
      let retiredPosition = null;
      try {
        assertNoBlockingEditors(current);
        retiredPosition = await invoke("runtime_retire_current_workspace");
        await acknowledge(command, "completed");
        await exit(0);
      } catch (error) {
        const recoveries = [];
        if (Number.isInteger(retiredPosition))
          recoveries.push(
            invoke("runtime_restore_retired_workspace", { position: retiredPosition })
          );
        if (wasRunning) recoveries.push(Promise.resolve().then(() => current.start()));
        const failures = (await Promise.allSettled(recoveries)).filter(
          (result) => result.status === "rejected"
        );
        if (failures.length) {
          throw new AggregateError(
            [error, ...failures.map(({ reason }) => reason)],
            `${failureDetail(error)} Recovery failed: ${failures
              .map(({ reason }) => failureDetail(reason))
              .join(" ")}`,
            { cause: error }
          );
        }
        throw error;
      }
      return;
    }
    if (command.action === "prepareGlobal") {
      if (current.busy) {
        await acknowledge(command, "blocked", "This workbench is installing an update.");
        return;
      }
      if (prepared.has(command.operationId)) {
        prepared.get(command.operationId).expiresAt = performance.now() + PREPARED_LEASE_MS;
        await acknowledge(command, "ready");
        return;
      }
      if (prepared.size) {
        await acknowledge(
          command,
          "blocked",
          "Another identity-wide operation is awaiting recovery."
        );
        return;
      }
      if (current.blockingEditors.length) {
        await acknowledge(command, "blocked", current.blockingEditors.join(", "));
        return;
      }
      const wasRunning = await stopAndFlush(current);
      prepared.set(command.operationId, {
        wasRunning,
        expiresAt: performance.now() + PREPARED_LEASE_MS,
      });
      await acknowledge(command, "ready");
      return;
    }
    if (command.action === "abortGlobal") {
      const preparation = prepared.get(command.operationId);
      prepared.delete(command.operationId);
      if (preparation?.wasRunning) await current.start();
      await acknowledge(command, "completed");
      return;
    }
    if (command.action === "commitGlobal") {
      const preparation = prepared.get(command.operationId);
      if (!preparation || preparation.expiresAt <= performance.now()) {
        await acknowledge(command, "failed", "This workbench's preparation expired.");
        return;
      }
      if (current.blockingEditors.length) {
        await acknowledge(command, "blocked", current.blockingEditors.join(", "));
        return;
      }
      await flushPersistence();
      if (
        preparation.expiresAt <= performance.now() ||
        current.blockingEditors.length ||
        current.busy
      ) {
        await acknowledge(command, "blocked", "This workbench is no longer ready to close.");
        return;
      }
      await acknowledge(command, "completed");
      await exit(0);
      prepared.delete(command.operationId);
    }
  } catch (error) {
    await acknowledge(command, "failed", failureDetail(error)).catch(() => {});
  }
}

export function useRuntimeCoordination({
  blockingEditors,
  running,
  stop,
  start,
  show,
  actions = null,
  busy = false,
}) {
  const currentRef = useRef({ blockingEditors, running, stop, start, show, actions, busy });
  useLayoutEffect(() => {
    currentRef.current = { blockingEditors, running, stop, start, show, actions, busy };
  }, [blockingEditors, running, start, stop, show, actions, busy]);

  useEffect(() => {
    lifecycle = new Proxy(
      {},
      {
        get: (_, key) => currentRef.current[key],
      }
    );
    if (!isTauri()) {
      return () => {
        lifecycle = null;
      };
    }
    const prepared = new Map();
    let handling = false;
    const poll = async () => {
      if (handling) return;
      handling = true;
      try {
        const command = await invoke("runtime_poll_command");
        if (command) await handleRuntimeCommand(command, prepared);
        await recoverExpiredPreparations(currentRef.current, prepared);
      } catch (_) {
        // A transient read failure is retried; the command remains on disk until acknowledged.
      } finally {
        handling = false;
      }
    };
    void poll();
    const timer = window.setInterval(poll, COMMAND_POLL_MS);
    return () => {
      window.clearInterval(timer);
      lifecycle = null;
    };
  }, []);
}

function assertNoBlockingEditors(current) {
  if (!current) throw new Error("Runtime coordination is not ready.");
  if (current.blockingEditors.length) {
    throw new Error(
      `Close the open editor before continuing: ${current.blockingEditors.join(", ")}`
    );
  }
}

function assertLocalQuitAllowed() {
  assertNoBlockingEditors(lifecycle);
  if (lifecycle.busy) throw new Error("PLVS is installing an update.");
}

export async function prepareGlobalOperation() {
  assertNoBlockingEditors(lifecycle);
  const id = operationId();
  const localWasRunning = await stopAndFlush(lifecycle);
  let issued;
  try {
    issued = await issue("prepareGlobal", id);
  } catch (error) {
    await abortGlobalOperation({ id, issued: [], localWasRunning });
    throw error;
  }
  let acknowledgements;
  try {
    acknowledgements = await waitFor(issued);
    assertNoBlockingEditors(lifecycle);
  } catch (error) {
    await abortGlobalOperation({ id, issued, localWasRunning });
    throw error;
  }
  const refused = acknowledgements.find((ack) => ack.outcome !== "ready");
  if (refused) {
    await abortGlobalOperation({ id, issued, localWasRunning });
    throw new Error(
      refused.detail
        ? `Another PLVS workbench could not prepare: ${refused.detail}`
        : "Another PLVS workbench could not prepare."
    );
  }
  return { id, issued, localWasRunning };
}

export async function abortGlobalOperation(operation) {
  try {
    const aborts = await issue(
      "abortGlobal",
      operation.id,
      operation.issued.map((command) => command.instanceId)
    ).catch(() => []);
    await waitFor(aborts).catch(() => {});
    if (operation.localWasRunning) await lifecycle?.start();
  } finally {
    await invoke("runtime_finish_operation", { operationId: operation.id }).catch(() => {});
  }
}

export async function commitGlobalOperation(operation, beforeCommit = () => {}) {
  await flushPersistence();
  beforeCommit();
  const commits = await issue(
    "commitGlobal",
    operation.id,
    operation.issued.map((command) => command.instanceId)
  );
  const acknowledgements = await waitFor(commits);
  const failed = acknowledgements.find((ack) => ack.outcome !== "completed");
  if (failed) throw new Error(failed.detail ?? "Another PLVS workbench could not close.");
  await invoke("runtime_finish_operation", { operationId: operation.id });
}

/**
 * @param {string} action
 */
export async function issueInstanceCommand(instanceId, action, payload = null) {
  const id = operationId();
  const issued = await issue(action, id, [instanceId], payload);
  if (issued.length !== 1) throw new Error("The selected PLVS workbench is no longer running.");
  const acknowledgements = await waitFor(issued);
  const failed = acknowledgements.find((ack) => ack.outcome !== "completed");
  if (failed) throw new Error(failed.detail ?? "The selected PLVS workbench refused the action.");
}

export async function quitAllInstances() {
  await quitPreparedInstances(await prepareGlobalOperation());
}

/**
 * Finishes Quit PLVS once every workbench has stopped and saved. Agent Control prepares first so a
 * refusal (an open editor anywhere) reaches the caller before it is told the quit was accepted.
 */
export async function quitPreparedInstances(operation) {
  try {
    assertLocalQuitAllowed();
    await commitGlobalOperation(operation, assertLocalQuitAllowed);
    assertLocalQuitAllowed();
    await exit(0);
  } catch (error) {
    await abortGlobalOperation(operation);
    throw error;
  }
}
