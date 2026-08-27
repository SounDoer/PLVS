/**
 * Cumulative Max Hold for the Spectrum: the per-band maximum of the smoothed curve since the hold
 * was switched on or last cleared. Distinct from Max Decay, which is the engine's decaying peak
 * envelope and stays on the Rust side.
 *
 * A band that has never carried a finite value holds -Infinity, which the display scale clamps to
 * the bottom of the range (`spectrumDbToYViewBox`) — the hold reads as "nothing seen here", which
 * is what it is.
 */

const EMPTY_PLANE = new Float32Array(0);

/**
 * Folds one frame into the hold. Returns the same buffer while the band count is unchanged, so the
 * live path allocates once per hold rather than once per frame.
 *
 * @param {Float32Array|null} previous
 * @param {ArrayLike<number>} dbList
 * @returns {Float32Array|null}
 */
export function accumulateSpectrumMaxHold(previous, dbList) {
  const bandCount = dbList?.length ?? 0;
  if (bandCount === 0) return previous ?? null;

  const held =
    previous && previous.length === bandCount
      ? previous
      : new Float32Array(bandCount).fill(-Infinity);
  for (let band = 0; band < bandCount; band += 1) {
    const value = dbList[band];
    if (Number.isFinite(value) && value > held[band]) held[band] = value;
  }
  return held;
}

function foldRowInto(target, row, secondary = false) {
  const bandCount = target.length;
  for (let band = 0; band < bandCount; band += 1) {
    const accessor = secondary ? row?.dbBAt : row?.dbAt;
    const values = secondary ? row?.dbListB : row?.dbList;
    const value = typeof accessor === "function" ? accessor.call(row, band) : values?.[band];
    if (Number.isFinite(value) && value > target[band]) target[band] = value;
  }
}

/**
 * One cumulative prefix per bucket of `bucketRows` rows, for both curves, over a frozen history.
 * Bucket `b` covers rows `[0, (b + 1) * bucketRows)`, so a query starts from the previous bucket
 * and replays fewer than `bucketRows` rows instead of folding from row 0 every time.
 *
 * @param {{ length: number, rowAt: (index: number) => object|undefined }} history
 * @param {number} bucketRows
 */
export function buildSpectrumMaxHoldTable(history, bucketRows) {
  const length = history?.length ?? 0;
  if (typeof history?.maxHoldAt === "function") {
    return { length, history, incremental: true };
  }
  const firstRow = length > 0 ? history.rowAt(0) : null;
  const bandCount = firstRow?.dbList?.length ?? 0;
  const bandCountB = firstRow?.dbListB?.length ?? 0;
  const bucketCount = bandCount > 0 ? Math.ceil(length / bucketRows) : 0;

  const tableA = new Float32Array(bucketCount * bandCount).fill(-Infinity);
  const tableB = new Float32Array(bucketCount * bandCountB).fill(-Infinity);
  const runningA = new Float32Array(bandCount).fill(-Infinity);
  const runningB = new Float32Array(bandCountB).fill(-Infinity);

  for (let index = 0; index < length && bandCount > 0; index += 1) {
    const row = history.rowAt(index);
    foldRowInto(runningA, row);
    if (bandCountB > 0) foldRowInto(runningB, row, true);
    if ((index + 1) % bucketRows === 0 || index === length - 1) {
      const bucket = Math.floor(index / bucketRows);
      tableA.set(runningA, bucket * bandCount);
      if (bandCountB > 0) tableB.set(runningB, bucket * bandCountB);
    }
  }

  return { tableA, tableB, bandCount, bandCountB, length, bucketRows, history };
}

/**
 * The hold as it stood at `index`: the previous bucket's prefix, then a replay of the rows since.
 * Exact — the bucket saves work, it does not approximate.
 *
 * @returns {{ dbList: Float32Array, dbListB: Float32Array }|null}
 */
export function spectrumMaxHoldAt(built, index) {
  if (!built || index < 0 || index >= built.length) return null;
  if (built.incremental) return built.history.maxHoldAt(index);
  const { tableA, tableB, bandCount, bandCountB, bucketRows, history } = built;

  const dbList = new Float32Array(bandCount).fill(-Infinity);
  const dbListB = bandCountB > 0 ? new Float32Array(bandCountB).fill(-Infinity) : EMPTY_PLANE;
  const bucket = Math.floor(index / bucketRows);
  if (bucket > 0) {
    dbList.set(tableA.subarray((bucket - 1) * bandCount, bucket * bandCount));
    if (bandCountB > 0) {
      dbListB.set(tableB.subarray((bucket - 1) * bandCountB, bucket * bandCountB));
    }
  }
  for (let rowIndex = bucket * bucketRows; rowIndex <= index; rowIndex += 1) {
    const row = history.rowAt(rowIndex);
    foldRowInto(dbList, row);
    if (bandCountB > 0) foldRowInto(dbListB, row, true);
  }
  return { dbList, dbListB };
}
