/**
 * The public Agent Control revision and the rules for advancing it.
 *
 * Several watchers can report a change for one user-visible operation. Outside a batch, bumps in
 * the same turn collapse into one. Inside a batch -- one mutation carrying `expectedRevision` --
 * the whole command advances the revision once, however many turns it spans, and the wake for
 * revision waiters is held until the batch ends.
 *
 * @param {{ onWake: (revision: number) => void }} options
 */
export function createRevisionClock({ onWake }) {
  let revision = 0;
  let bumpedThisTurn = false;
  let workspaceBumpedThisTurn = false;
  let wakeScheduled = false;
  /** @type {{ startRevision: number, bumped: boolean, wakePending: boolean } | null} */
  let batch = null;

  const publishWake = () => {
    if (wakeScheduled) return;
    wakeScheduled = true;
    queueMicrotask(() => {
      wakeScheduled = false;
      onWake(revision);
    });
  };
  const scheduleWake = () => {
    if (batch) {
      batch.wakePending = true;
      return;
    }
    publishWake();
  };
  const bump = () => {
    if (batch) {
      if (batch.bumped) return;
      batch.bumped = true;
      revision += 1;
      return;
    }
    if (bumpedThisTurn) return;
    bumpedThisTurn = true;
    revision += 1;
    queueMicrotask(() => {
      bumpedThisTurn = false;
    });
  };
  const bumpWorkspace = () => {
    if (workspaceBumpedThisTurn) return;
    workspaceBumpedThisTurn = true;
    bump();
    queueMicrotask(() => {
      workspaceBumpedThisTurn = false;
    });
    scheduleWake();
  };

  return {
    current: () => revision,
    bump,
    bumpWorkspace,
    scheduleWake,
    activeBatch: () => batch,
    beginBatch() {
      batch = { startRevision: revision, bumped: false, wakePending: false };
      return batch;
    },
    /**
     * Identity-checked, so a command that finishes late cannot clear a later command's batch.
     *
     * @param {{ wakePending: boolean } | null} owned
     */
    endBatch(owned) {
      if (!owned || batch !== owned) return;
      batch = null;
      if (owned.wakePending) publishWake();
    },
    /// For the request backstop. The abandoned command has not reached its own cleanup, so its
    /// batch would stay installed and swallow every later revision bump.
    abandonBatch() {
      const abandoned = batch;
      batch = null;
      if (abandoned?.wakePending) publishWake();
    },
  };
}
