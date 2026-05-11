export const METER_HEALTH = {
  ok: "ok",
  degraded: "degraded",
  stopped: "stopped",
  error: "error",
};

/**
 * @param {keyof typeof METER_HEALTH | string | null | undefined} health
 */
export function normalizeMeterHealth(health) {
  if (health === METER_HEALTH.degraded) return METER_HEALTH.degraded;
  if (health === METER_HEALTH.stopped) return METER_HEALTH.stopped;
  if (health === METER_HEALTH.error) return METER_HEALTH.error;
  return METER_HEALTH.ok;
}

/**
 * Public view-model for the status bar badge.
 * @param {keyof typeof METER_HEALTH | string | null | undefined} health
 */
export function meterHealthBadgeModel(health) {
  const h = normalizeMeterHealth(health);
  if (h === METER_HEALTH.error) {
    return { health: h, label: "Meter: Error", tone: "error" };
  }
  if (h === METER_HEALTH.stopped) {
    return { health: h, label: "Meter: Stopped", tone: "warn" };
  }
  if (h === METER_HEALTH.degraded) {
    return { health: h, label: "Meter: Degraded", tone: "warn" };
  }
  return { health: h, label: "Meter: OK", tone: "ok" };
}
