import { useSyncExternalStore } from "react";

/**
 * @type {boolean}
 */
let coordinatorOverride;
const listeners = new Set();

function bootRole() {
  return typeof window === "undefined" || window.__PLVS_INITIAL_STATE__?.isCoordinator !== false;
}

function currentRole() {
  return coordinatorOverride ?? bootRole();
}

export function ownsCoordinatorResources() {
  return currentRole();
}

export function isParticipantInstance() {
  return !currentRole();
}

/**
 * @param {boolean} isCoordinator
 */
export function setCoordinatorRole(isCoordinator) {
  const previous = currentRole();
  coordinatorOverride = typeof isCoordinator === "boolean" ? isCoordinator : undefined;
  if (currentRole() !== previous) listeners.forEach((listener) => listener());
}

export function useCoordinatorRole() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    currentRole,
    () => true
  );
}
