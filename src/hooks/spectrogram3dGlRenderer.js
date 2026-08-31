/**
 * The WebGL2 half of the 3D Surface: context, buffers, and three draw calls.
 *
 * Deliberately thin, and deliberately untested by CI. jsdom has no GL context, so nothing asserted
 * here would ever run on a merge gate; everything that CAN be asserted lives in
 * `spectrogram3dMesh.js` and `spectrogram3dGlUniforms.js` instead, and this file is held to context
 * handling, upload and draw calls. If something here starts making decisions, it belongs in one of
 * those two modules.
 *
 * The vertex shader is a transcription of `projectWithUniforms`, which is pinned against
 * `projectPoint` by test. Change one and you must change the other, or the terrain slides off the
 * floor grid -- which is drawn from the same projection, one draw call earlier.
 */

/**
 * How far distance dims the shade index, matching the old rasteriser's DEPTH_FADE_FLOOR: the far
 * end of the scene recedes without a second light being introduced.
 */
const DEPTH_FADE_FLOOR = 0.65;
/** Matches `SHADE_LEVELS` in `spectrogram3dSurface.js` -- the LUT texture's height. */
const SHADE_LEVELS = 64;
const LUT_WIDTH = 256;

const SURFACE_VERTEX_SOURCE = `#version 300 es
in vec3 vertex;            // tFrac, fFrac, height
uniform vec2 origin;
uniform vec2 tAxis;
uniform vec2 fAxis;
uniform float hy;
uniform vec2 viewport;
uniform vec2 depthRange;
out float height;
out float nearness;
out float tFrac;
void main() {
  float t = vertex.x - 0.5;
  float f = vertex.y - 0.5;
  height = vertex.z;
  tFrac = vertex.x;
  float px = origin.x + t * tAxis.x + f * fAxis.x;
  float floorY = origin.y + t * tAxis.y + f * fAxis.y;
  float py = floorY + vertex.z * hy;
  nearness = (floorY - depthRange.x) / (depthRange.y - depthRange.x);
  float z = 1.0 - 2.0 * nearness;
  gl_Position = vec4((px / viewport.x) * 2.0 - 1.0, 1.0 - (py / viewport.y) * 2.0, z, 1.0);
}
`;

/**
 * Shading from the screen-space gradient of the INTERPOLATED height, which is the whole point of
 * the move: the old renderer measured the same gradient between two point samples of a moving noisy
 * field and re-picked different samples on every window update. `slopeGain` converts the per-pixel
 * derivative back into the per-floor-unit quantity `slopeShade` was tuned against.
 */
const SURFACE_FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in float height;
in float nearness;
in float tFrac;
uniform sampler2D lut;     // 256 x 64, level on x, shade on y
uniform float slopeGain;
uniform float depthFadeFloor;
uniform vec2 highlightBand;   // tFrac range; empty when min > max
uniform vec4 highlightColour;
out vec4 colour;
void main() {
  if (tFrac >= highlightBand.x && tFrac <= highlightBand.y) {
    colour = highlightColour;
    return;
  }
  float slope = length(vec2(dFdx(height), dFdy(height))) * sign(dFdy(height)) * slopeGain;
  float shade = 0.5 + 0.5 * (slope / (1.0 + abs(slope)));
  shade *= depthFadeFloor + (1.0 - depthFadeFloor) * nearness;
  colour = texture(lut, vec2(height, shade));
}
`;

const FLOOR_VERTEX_SOURCE = `#version 300 es
in vec2 corner;            // tFrac, fFrac on the floor plane
uniform vec2 origin;
uniform vec2 tAxis;
uniform vec2 fAxis;
uniform vec2 viewport;
void main() {
  float t = corner.x - 0.5;
  float f = corner.y - 0.5;
  float px = origin.x + t * tAxis.x + f * fAxis.x;
  float py = origin.y + t * tAxis.y + f * fAxis.y;
  gl_Position = vec4((px / viewport.x) * 2.0 - 1.0, 1.0 - (py / viewport.y) * 2.0, 0.0, 1.0);
}
`;

const FLOOR_FRAGMENT_SOURCE = `#version 300 es
precision highp float;
uniform vec4 lineColour;
out vec4 colour;
void main() { colour = lineColour; }
`;

/** Matches the 2D floor's divisions, so switching renderers cannot move the grid. */
const FLOOR_DIVISIONS = 4;

/** The floor's outline and its interior divisions, as one line-segment list on the unit square. */
function floorGeometry() {
  const outline = [0, 0, 1, 0, 1, 0, 1, 1, 1, 1, 0, 1, 0, 1, 0, 0];
  const divisions = [];
  for (let i = 1; i < FLOOR_DIVISIONS; i += 1) {
    const k = i / FLOOR_DIVISIONS;
    divisions.push(k, 0, k, 1, 0, k, 1, k);
  }
  return {
    vertices: Float32Array.from([...outline, ...divisions]),
    outlineCount: outline.length / 2,
    divisionCount: divisions.length / 2,
  };
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`shader compile failed: ${log}`);
  }
  return shader;
}

function link(gl, vertexSource, fragmentSource) {
  const program = gl.createProgram();
  const vs = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`program link failed: ${log}`);
  }
  return program;
}

function uniformMap(gl, program, names) {
  const out = {};
  for (const name of names) out[name] = gl.getUniformLocation(program, name);
  return out;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @returns {{ draw: Function, resize: Function, dispose: Function, state: "ok"|"lost"|"dead" }}
 *          `state` is read, never written, by the caller. `"dead"` means two restores have failed
 *          and the panel should say so rather than draw; per the design it must NOT change the
 *          user's Mode -- a meter that quietly shows something else is worse than one that says it
 *          is broken.
 */
export function createSurfaceRenderer(canvas) {
  const api = { draw, resize, dispose, state: "ok" };
  let gl = null;
  let gpu = null;
  let failedRestores = 0;
  let disposed = false;
  // Identity of the uploaded colour table. It changes only on a theme switch or a Colorize toggle,
  // and re-uploading 64 KB per repaint would be the one avoidable cost in this file.
  let lutToken = null;

  function acquire() {
    const context = canvas.getContext("webgl2", {
      alpha: true,
      antialias: true,
      depth: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });
    if (!context) throw new Error("WebGL2 unavailable");
    return context;
  }

  function buildGpuState() {
    const floor = floorGeometry();
    const surfaceProgram = link(gl, SURFACE_VERTEX_SOURCE, SURFACE_FRAGMENT_SOURCE);
    const floorProgram = link(gl, FLOOR_VERTEX_SOURCE, FLOOR_FRAGMENT_SOURCE);

    const lut = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, lut);
    // NEAREST on both axes: the level axis is the same unfiltered table lookup the rasteriser did,
    // and the shade axis has 64 rows of an already-smooth ramp, so filtering it would only blur.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const floorBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, floorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, floor.vertices, gl.STATIC_DRAW);

    const positions = gl.createBuffer();
    const indices = gl.createBuffer();
    const surfaceVao = gl.createVertexArray();
    gl.bindVertexArray(surfaceVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, positions);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);

    const floorVao = gl.createVertexArray();
    gl.bindVertexArray(floorVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, floorBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    lutToken = null;
    return {
      surfaceProgram,
      floorProgram,
      surfaceUniforms: uniformMap(gl, surfaceProgram, [
        "origin",
        "tAxis",
        "fAxis",
        "hy",
        "viewport",
        "depthRange",
        "lut",
        "slopeGain",
        "depthFadeFloor",
        "highlightBand",
        "highlightColour",
      ]),
      floorUniforms: uniformMap(gl, floorProgram, [
        "origin",
        "tAxis",
        "fAxis",
        "viewport",
        "lineColour",
      ]),
      lut,
      floor,
      floorBuffer,
      floorVao,
      surfaceVao,
      positions,
      indices,
      // Capacities, in elements. The buffers are reallocated only when the mesh outgrows them: the
      // row count moves with the panel size and with the window, so allocating per repaint would
      // churn for nothing.
      positionCapacity: 0,
      indexCapacity: 0,
    };
  }

  function start() {
    gl = acquire();
    gpu = buildGpuState();
    api.state = "ok";
  }

  function onLost(event) {
    event.preventDefault();
    gpu = null;
    if (api.state !== "dead") api.state = "lost";
  }

  function onRestored() {
    if (disposed || api.state === "dead") return;
    try {
      start();
    } catch {
      failedRestores += 1;
      // Two failures in one session is where trying stops. A third attempt would be the same
      // attempt: whatever refuses to link now refuses on the next event too.
      api.state = failedRestores >= 2 ? "dead" : "lost";
    }
  }

  canvas.addEventListener("webglcontextlost", onLost, false);
  canvas.addEventListener("webglcontextrestored", onRestored, false);
  start();

  /** Device pixels, from the same measurement that sizes the overlay canvas. */
  function resize(width, height) {
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
  }

  function uploadLut(pixels, token) {
    if (lutToken === token) return;
    // The table is packed ARGB for a little-endian Uint32Array view, which in memory is byte order
    // R, G, B, A -- exactly what RGBA8 wants. See `packArgb`.
    gl.bindTexture(gl.TEXTURE_2D, gpu.lut);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      LUT_WIDTH,
      SHADE_LEVELS,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength)
    );
    lutToken = token;
  }

  function uploadMesh(mesh) {
    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.positions);
    if (mesh.positions.length > gpu.positionCapacity) {
      gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.DYNAMIC_DRAW);
      gpu.positionCapacity = mesh.positions.length;
    } else {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, mesh.positions);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gpu.indices);
    if (mesh.indices.length > gpu.indexCapacity) {
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.DYNAMIC_DRAW);
      gpu.indexCapacity = mesh.indices.length;
    } else {
      gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, mesh.indices);
    }
  }

  function drawFloorLines(uniforms, gridColour, gridSubtleColour) {
    const u = gpu.floorUniforms;
    gl.useProgram(gpu.floorProgram);
    gl.bindVertexArray(gpu.floorVao);
    gl.uniform2fv(u.origin, uniforms.origin);
    gl.uniform2fv(u.tAxis, uniforms.tAxis);
    gl.uniform2fv(u.fAxis, uniforms.fAxis);
    gl.uniform2fv(u.viewport, uniforms.viewport);
    gl.uniform4fv(u.lineColour, gridColour);
    gl.drawArrays(gl.LINES, 0, gpu.floor.outlineCount);
    gl.uniform4fv(u.lineColour, gridSubtleColour);
    gl.drawArrays(gl.LINES, gpu.floor.outlineCount, gpu.floor.divisionCount);
  }

  /**
   * One repaint.
   *
   * @param {object} frame
   * @param {{ positions: Float32Array, indices: Uint32Array }} frame.mesh from `buildSurfaceMesh`
   * @param {object} frame.uniforms from `buildGlUniforms`
   * @param {Uint32Array} frame.lut packed ARGB, 256 * SHADE_LEVELS
   * @param {*} frame.lutToken identity of that table; it is re-uploaded only when this changes
   * @param {boolean} frame.floor whether the floor grid is drawn at all
   * @param {number[]} frame.gridColour floor outline, RGBA in 0..1
   * @param {number[]} frame.gridSubtleColour floor divisions, RGBA in 0..1
   * @param {number[]} frame.highlightBand scrubbed tFrac range; min > max disables it
   * @param {number[]} frame.highlightColour
   */
  function draw(frame) {
    if (api.state !== "ok" || !gpu) return;
    const { mesh, uniforms } = frame;

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    // Under the terrain, and drawn before it: quiet terrain is translucent, so the grid showing
    // through is the recession the 2D heatmap and Lines have always given silence.
    if (frame.floor) drawFloorLines(uniforms, frame.gridColour, frame.gridSubtleColour);

    if (mesh.indices.length === 0) return;

    uploadLut(frame.lut, frame.lutToken);
    uploadMesh(mesh);

    const u = gpu.surfaceUniforms;
    gl.useProgram(gpu.surfaceProgram);
    gl.bindVertexArray(gpu.surfaceVao);
    gl.uniform2fv(u.origin, uniforms.origin);
    gl.uniform2fv(u.tAxis, uniforms.tAxis);
    gl.uniform2fv(u.fAxis, uniforms.fAxis);
    gl.uniform1f(u.hy, uniforms.hy);
    gl.uniform2fv(u.viewport, uniforms.viewport);
    gl.uniform2fv(u.depthRange, uniforms.depthRange);
    gl.uniform1f(u.slopeGain, uniforms.slopeGain);
    gl.uniform1f(u.depthFadeFloor, DEPTH_FADE_FLOOR);
    gl.uniform2fv(u.highlightBand, frame.highlightBand);
    gl.uniform4fv(u.highlightColour, frame.highlightColour);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, gpu.lut);
    gl.uniform1i(u.lut, 0);

    // Two passes, and the reason is the alpha the LUT carries. In one pass a hidden fragment drawn
    // before its occluder still blends into the background and the occluder then blends on top, so
    // quiet terrain would print twice as heavily wherever two rows overlap. The old rasteriser
    // wrote each pixel exactly once. Depth first, colour second at equal depth, restores that.
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.colorMask(false, false, false, false);
    gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_INT, 0);

    gl.colorMask(true, true, true, true);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(false);
    gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_INT, 0);

    gl.bindVertexArray(null);
  }

  function dispose() {
    disposed = true;
    canvas.removeEventListener("webglcontextlost", onLost, false);
    canvas.removeEventListener("webglcontextrestored", onRestored, false);
    if (gl && gpu) {
      gl.deleteProgram(gpu.surfaceProgram);
      gl.deleteProgram(gpu.floorProgram);
      gl.deleteTexture(gpu.lut);
      gl.deleteBuffer(gpu.positions);
      gl.deleteBuffer(gpu.indices);
      gl.deleteBuffer(gpu.floorBuffer);
      gl.deleteVertexArray(gpu.surfaceVao);
      gl.deleteVertexArray(gpu.floorVao);
    }
    gpu = null;
    gl = null;
  }

  return api;
}
