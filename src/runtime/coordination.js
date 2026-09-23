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

async function acknowledge(command, outcome, detail = null) {
  await invoke("runtime_ack_command", {
    commandId: command.commandId,
    outcome,
    detail,
  });
}

async function issue(action, id, instanceIds = null) {
  return invoke("runtime_issue_commands", {
    action,
    operationId: id,
    instanceIds,
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
  const now = Date.now();
  for (const [operationId, state] of prepared) {
    if (state.expiresAt > now) continue;
    if (state.wasRunning) await current.start();
    prepared.delete(operationId);
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
    if (command.action === "quitInstance") {
      if (current.blockingEditors.length) {
        await acknowledge(command, "blocked", current.blockingEditors.join(", "));
        return;
      }
      const wasRunning = await stopAndFlush(current);
      try {
        await invoke("runtime_retire_current_workspace");
      } catch (error) {
        if (wasRunning) await current.start();
        throw error;
      }
      await acknowledge(command, "completed");
      await exit(0);
      return;
    }
    if (command.action === "prepareGlobal") {
      if (prepared.has(command.operationId)) {
        prepared.get(command.operationId).expiresAt = Date.now() + PREPARED_LEASE_MS;
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
        expiresAt: Date.now() + PREPARED_LEASE_MS,
      });
      await acknowledge(command, "ready");
      return;
    }
    if (command.action === "abortGlobal") {
      if (prepared.get(command.operationId)?.wasRunning) await current.start();
      prepared.delete(command.operationId);
      await acknowledge(command, "completed");
      return;
    }
    if (command.action === "commitGlobal") {
      await flushPersistence();
      prepared.delete(command.operationId);
      await acknowledge(command, "completed");
      await exit(0);
    }
  } catch (error) {
    await acknowledge(command, "failed", String(error)).catch(() => {});
  }
}

export function useRuntimeCoordination({ blockingEditors, running, stop, start, show }) {
  const currentRef = useRef({ blockingEditors, running, stop, start, show });
  useLayoutEffect(() => {
    currentRef.current = { blockingEditors, running, stop, start, show };
  }, [blockingEditors, running, start, stop, show]);

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

export async function prepareGlobalOperation() {
  if (!lifecycle) throw new Error("Runtime coordination is not ready.");
  if (lifecycle.blockingEditors.length) {
    throw new Error(
      `Close the open editor before continuing: ${lifecycle.blockingEditors.join(", ")}`
    );
  }
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
  } catch (error) {
    await abortGlobalOperation({ id, issued, localWasRunning });
    throw error;
  }
  const refused = acknowledgements.find((ack) => ack.outcome !== "ready");
  if (refused) {
    await abortGlobalOperation({ id, issued, localWasRunning });
    throw new Error(
      refused.outcome === "blocked"
        ? `Another PLVS workbench has an open editor: ${refused.detail ?? refused.instanceId}`
        : (refused.detail ?? "Another PLVS workbench could not prepare.")
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

export async function commitGlobalOperation(operation) {
  await flushPersistence();
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

export async function issueInstanceCommand(instanceId, action) {
  const id = operationId();
  const issued = await issue(action, id, [instanceId]);
  const acknowledgements = await waitFor(issued);
  const failed = acknowledgements.find((ack) => ack.outcome !== "completed");
  if (failed) throw new Error(failed.detail ?? "The selected PLVS workbench refused the action.");
}

export async function quitAllInstances() {
  const operation = await prepareGlobalOperation();
  try {
    await commitGlobalOperation(operation);
    await exit(0);
  } catch (error) {
    await abortGlobalOperation(operation);
    throw error;
  }
}
