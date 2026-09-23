export function ownsCoordinatorResources() {
  return typeof window === "undefined" || window.__PLVS_INITIAL_STATE__?.isCoordinator !== false;
}

export function isParticipantInstance() {
  return typeof window !== "undefined" && window.__PLVS_INITIAL_STATE__?.isCoordinator === false;
}
