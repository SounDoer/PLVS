/** Opaque sRGB mixing, also used to flatten legacy effects during migration. */
/**
 * Opaque sRGB mixing, also used to flatten legacy effects during migration.
 * @param {string} to
 * @param {number} amount
 */
export function mixOpaqueColors(from, to, amount) {
  const channels = (/** @type {string} */ hex) => {
    const value = Number.parseInt(hex.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  };
  const a = channels(from);
  const b = channels(to);
  return `#${a
    .map((value, index) =>
      Math.round(value + (b[index] - value) * amount)
        .toString(16)
        .padStart(2, "0")
    )
    .join("")}`;
}
