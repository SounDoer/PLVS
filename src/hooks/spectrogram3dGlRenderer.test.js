import { describe, expect, it } from "vitest";

import {
  createSurfaceRenderer,
  FLOOR_VERTEX_FLOATS,
  floorLineGeometry,
} from "./spectrogram3dGlRenderer.js";

/**
 * A WebGL2 stand-in that records calls. GL enum constants come back as their own names, so a call
 * reads as `blendFunc("ONE", "ONE_MINUS_SRC_ALPHA")`; every method returns a truthy handle.
 */
function recordingCanvas() {
  const calls = [];
  const contextOptions = [];
  const gl = new Proxy(
    {},
    {
      get(_target, name) {
        if (typeof name !== "string") return undefined;
        if (/^[A-Z0-9_]+$/.test(name)) return name;
        return (...args) => {
          calls.push([name, ...args]);
          return {};
        };
      },
    }
  );
  const canvas = {
    width: 300,
    height: 150,
    addEventListener() {},
    removeEventListener() {},
    getContext(kind, options) {
      contextOptions.push({ kind, options });
      return gl;
    },
  };
  return { canvas, calls, contextOptions };
}

function drawOnce(renderer) {
  renderer.draw({
    mesh: {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
    },
    uniforms: {
      origin: [0, 0],
      tAxis: [1, 0],
      fAxis: [0, 1],
      hy: 1,
      viewport: [300, 150],
      depthRange: [0, 1],
      slopeGain: 1,
    },
    lut: new Uint32Array(256 * 64),
    lutToken: {},
    floor: true,
    floorLineWidth: 2,
    gridColour: [0.1, 0.2, 0.3, 1],
    highlightBand: [1, 0],
    highlightColour: [1, 1, 1, 1],
  });
}

function vertices(geometry, first, count) {
  const out = [];
  for (let index = first; index < first + count; index += 1) {
    const at = index * FLOOR_VERTEX_FLOATS;
    const v = geometry.vertices.slice(at, at + FLOOR_VERTEX_FLOATS);
    out.push({ a: [v[0], v[1]], b: [v[2], v[3]], along: v[4], side: v[5], cap: v[6] });
  }
  return out;
}

describe("floorLineGeometry", () => {
  it("builds each floor line as two triangles, so its width is not limited to one device pixel", () => {
    const geometry = floorLineGeometry();
    // 4 outline edges and 3 + 3 divisions, 6 vertices each.
    expect(geometry.outlineCount).toBe(24);
    expect(geometry.divisionCount).toBe(36);
    expect(geometry.vertices).toHaveLength(60 * FLOOR_VERTEX_FLOATS);
  });

  it("spans both ends and both sides of every segment", () => {
    const quad = vertices(floorLineGeometry(), 0, 6);
    expect(quad.every(({ a, b }) => a[0] === 0 && a[1] === 0 && b[0] === 1 && b[1] === 0)).toBe(
      true
    );
    expect(quad.map(({ along, side }) => [along, side])).toEqual([
      [0, -1],
      [1, -1],
      [1, 1],
      [0, -1],
      [1, 1],
      [0, 1],
    ]);
  });

  it("caps the closed outline so its corners meet, and leaves divisions butt-ended like the 2D floor", () => {
    const geometry = floorLineGeometry();
    const outline = vertices(geometry, 0, geometry.outlineCount);
    const divisions = vertices(geometry, geometry.outlineCount, geometry.divisionCount);
    expect(outline.every(({ cap }) => cap === 1)).toBe(true);
    expect(divisions.every(({ cap }) => cap === 0)).toBe(true);
    expect(divisions[0]).toMatchObject({ a: [0.25, 0], b: [0.25, 1] });
  });
});

// Incident guard. The WebGL port shipped `premultipliedAlpha: false` with a blend that had already
// multiplied colour by alpha, so every translucent pixel was composited at alpha squared: quiet
// terrain lost its fade and the thin floor grid rendered darker than the background. See
// "Rendering changes" in docs/pitfalls.md. These three halves only work together.
describe("createSurfaceRenderer alpha compositing", () => {
  it("asks for a premultiplied-alpha canvas", () => {
    const { canvas, contextOptions } = recordingCanvas();
    createSurfaceRenderer(canvas);
    expect(contextOptions[0]).toMatchObject({
      kind: "webgl2",
      options: { premultipliedAlpha: true },
    });
  });

  it("blends premultiplied colour, so alpha is applied exactly once", () => {
    const { canvas, calls } = recordingCanvas();
    drawOnce(createSurfaceRenderer(canvas));
    const blends = calls.filter(([name]) => name.startsWith("blendFunc"));
    expect(blends).toEqual([["blendFunc", "ONE", "ONE_MINUS_SRC_ALPHA"]]);
  });

  it("uses the same resolved Grid colour for the floor outline and subdivisions", () => {
    const { canvas, calls } = recordingCanvas();
    drawOnce(createSurfaceRenderer(canvas));
    const gridUploads = calls.filter(
      ([name, , value]) =>
        name === "uniform4fv" && JSON.stringify(value) === JSON.stringify([0.1, 0.2, 0.3, 1])
    );

    expect(gridUploads).toHaveLength(2);
  });

  it("writes premultiplied colour from every fragment shader", () => {
    const { canvas, calls } = recordingCanvas();
    createSurfaceRenderer(canvas);
    const fragmentSources = calls
      .filter(([name, , source]) => name === "shaderSource" && source.includes("out vec4 colour"))
      .map(([, , source]) => source);
    expect(fragmentSources).toHaveLength(2);
    for (const source of fragmentSources) {
      const writes = source.match(/colour = [^;]+;/g);
      expect(writes.length).toBeGreaterThan(0);
      for (const write of writes) {
        expect(write).toMatch(/colour = vec4\((\w+)\.rgb \* \1\.a, \1\.a\);/);
      }
    }
  });
});
