// sRGB gamma <-> linear
function toLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function toGamma(c) {
  const x = Math.max(0, Math.min(1, c));
  return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

/** @param {string} hex e.g. "#fb923c" @returns {{L:number,C:number,H:number}} */
export function hexToOklch(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = toLinear(((n >> 16) & 255) / 255);
  const g = toLinear(((n >> 8) & 255) / 255);
  const b = toLinear((n & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(a, bb);
  let H = (Math.atan2(bb, a) * 180) / Math.PI;
  if (H < 0) H += 360;
  return { L, C, H };
}

/** @param {{L:number,C:number,H:number}} o @returns {string} hex */
export function oklchToHex({ L, C, H }) {
  const hRad = (H * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l3 = l_ ** 3;
  const m3 = m_ ** 3;
  const s3 = s_ ** 3;
  const r = toGamma(4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3);
  const g = toGamma(-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3);
  const bl = toGamma(-0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3);
  const hx = (v) =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${hx(r)}${hx(g)}${hx(bl)}`;
}

/**
 * @param {{L:number,C:number,H:number}} o
 * @param {{dL?:number,dC?:number,dH?:number}} d
 * @returns {{L:number,C:number,H:number}}
 */
export function transform(o, { dL = 0, dC = 0, dH = 0 }) {
  return {
    L: Math.max(0, Math.min(1, o.L + dL)),
    C: Math.max(0, o.C + dC),
    H: (((o.H + dH) % 360) + 360) % 360,
  };
}
