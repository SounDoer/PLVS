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
/**
 * The colour table's shape, and it is SHADE first on purpose.
 *
 * `buildSurfaceLut` indexes `level * SHADE_LEVELS + shade`, so shade is the FAST axis and level the
 * slow one. A texture's fast axis is its width, which makes this 64 wide by 256 tall and the sample
 * coordinate `(shade, level)` -- not the other way round. Uploading it transposed does not look
 * like a broken table: the level a fragment reads comes out as roughly `4 * (shade + height)`, so
 * the surface still shades smoothly, it just shades by SLOPE instead of by level, and quiet terrain
 * lands at a level far above the alpha fade and paints over the floor grid it should dissolve into.
 */
const SHADE_LEVELS = 64;
const LUT_LEVELS = 256;

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
uniform sampler2D lut;     // 64 x 256, shade on x, level on y
uniform float slopeGain;
uniform float depthFadeFloor;
uniform vec2 highlightBand;   // tFrac range; empty when min > max
uniform vec4 highlightColour;
out vec4 colour;
void main() {
  if (tFrac >= highlightBand.x && tFrac <= highlightBand.y) {
    colour = vec4(highlightColour.rgb * highlightColour.a, highlightColour.a);
    return;
  }
  float slope = length(vec2(dFdx(height), dFdy(height))) * sign(dFdy(height)) * slopeGain;
  float shade = 0.5 + 0.5 * (slope / (1.0 + abs(slope)));
  shade *= depthFadeFloor + (1.0 - depthFadeFloor) * nearness;
  vec4 table = texture(lut, vec2(shade, height));
  colour = vec4(table.rgb * table.a, table.a);
}
`;

/**
 * Floor lines are extruded into quads in screen space rather than drawn as `gl.LINES`.
 *
 * A GL line is always one device pixel wide -- ANGLE supports no other width -- while the 2D floor
 * that Lines draws is one CSS pixel. On a scaled display that made the grid lose half its weight the
 * moment the view switched to Surface. Each vertex carries both ends of its segment, projects them,
 * and offsets itself by half of `lineWidth` (device px) across the segment, and along it too when
 * `cap` is set, so the closed outline's corners meet instead of leaving a notch.
 */
const FLOOR_VERTEX_SOURCE = `#version 300 es
layout(location = 0) in vec2 a;       // this segment's ends: tFrac, fFrac on the floor plane
layout(location = 1) in vec2 b;
layout(location = 2) in vec3 corner;  // along (0 at a, 1 at b), side (-1 or 1), cap (0 or 1)
uniform vec2 origin;
uniform vec2 tAxis;
uniform vec2 fAxis;
uniform vec2 viewport;
uniform float lineWidth;
vec2 project(vec2 p) {
  return origin + (p.x - 0.5) * tAxis + (p.y - 0.5) * fAxis;
}
void main() {
  vec2 pa = project(a);
  vec2 pb = project(b);
  vec2 d = pb - pa;
  float len = length(d);
  vec2 dir = len > 0.0 ? d / len : vec2(1.0, 0.0);
  vec2 normal = vec2(-dir.y, dir.x);
  float halfWidth = 0.5 * lineWidth;
  vec2 p = mix(pa, pb, corner.x)
    + normal * corner.y * halfWidth
    + dir * (corner.x * 2.0 - 1.0) * corner.z * halfWidth;
  gl_Position = vec4((p.x / viewport.x) * 2.0 - 1.0, 1.0 - (p.y / viewport.y) * 2.0, 0.0, 1.0);
}
`;

const FLOOR_FRAGMENT_SOURCE = `#version 300 es
precision highp float;
uniform vec4 lineColour;
out vec4 colour;
void main() { colour = vec4(lineColour.rgb * lineColour.a, lineColour.a); }
`;

/** Matches the 2D floor's divisions, so switching renderers cannot move the grid. */
const FLOOR_DIVISIONS = 4;

/** Floats per floor vertex: a (2), b (2), corner (3). See FLOOR_VERTEX_SOURCE. */
export const FLOOR_VERTEX_FLOATS = 7;

// Two triangles per segment, as (along, side) pairs.
const QUAD_CORNERS = [
  [0, -1],
  [1, -1],
  [1, 1],
  [0, -1],
  [1, 1],
  [0, 1],
];

function pushSegments(out, segments, cap) {
  for (const [a0, a1, b0, b1] of segments) {
    for (const [along, side] of QUAD_CORNERS) out.push(a0, a1, b0, b1, along, side, cap);
  }
}

/**
 * The floor's outline and its interior divisions on the unit square, one quad per segment.
 * Counts are in vertices. The outline is capped so its corners close, as the 2D floor's closed path
 * does; the divisions are butt-ended, as the 2D floor's open segments are.
 */
export function floorLineGeometry() {
  const outline = [
    [0, 0, 1, 0],
    [1, 0, 1, 1],
    [1, 1, 0, 1],
    [0, 1, 0, 0],
  ];
  const divisions = [];
  for (let i = 1; i < FLOOR_DIVISIONS; i += 1) {
    const k = i / FLOOR_DIVISIONS;
    divisions.push([k, 0, k, 1], [0, k, 1, k]);
  }
  const data = [];
  pushSegments(data, outline, 1);
  pushSegments(data, divisions, 0);
  return {
    vertices: Float32Array.from(data),
    outlineCount: outline.length * QUAD_CORNERS.length,
    divisionCount: divisions.length * QUAD_CORNERS.length,
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
      // Premultiplied, like every fragment shader here writes. With `false` the blend below left
      // colour already multiplied by alpha, the compositor multiplied it again, and every
      // translucent pixel came out at alpha squared: the fade band of quiet terrain, and every
      // antialiased edge -- which is all a thin floor line is -- darker than the background it sat
      // on. The floor read faint and broken; the pixels measured darker than the background.
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    });
    if (!context) throw new Error("WebGL2 unavailable");
    return context;
  }

  function buildGpuState() {
    const floor = floorLineGeometry();
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
    const stride = FLOOR_VERTEX_FLOATS * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 2 * 4);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 4 * 4);
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
        "lineWidth",
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
      SHADE_LEVELS,
      LUT_LEVELS,
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

  function drawFloorLines(uniforms, lineWidth, gridColour, gridSubtleColour) {
    const u = gpu.floorUniforms;
    gl.useProgram(gpu.floorProgram);
    gl.bindVertexArray(gpu.floorVao);
    gl.uniform2fv(u.origin, uniforms.origin);
    gl.uniform2fv(u.tAxis, uniforms.tAxis);
    gl.uniform2fv(u.fAxis, uniforms.fAxis);
    gl.uniform2fv(u.viewport, uniforms.viewport);
    gl.uniform1f(u.lineWidth, lineWidth);
    gl.uniform4fv(u.lineColour, gridColour);
    gl.drawArrays(gl.TRIANGLES, 0, gpu.floor.outlineCount);
    gl.uniform4fv(u.lineColour, gridSubtleColour);
    gl.drawArrays(gl.TRIANGLES, gpu.floor.outlineCount, gpu.floor.divisionCount);
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
   * @param {number} frame.floorLineWidth floor line width in device px (1 CSS px x DPR)
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
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    // Under the terrain, and drawn before it: quiet terrain is translucent, so the grid showing
    // through is the recession the 2D heatmap and Lines have always given silence.
    if (frame.floor) {
      drawFloorLines(uniforms, frame.floorLineWidth, frame.gridColour, frame.gridSubtleColour);
    }

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
