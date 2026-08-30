/**
 * Decoder for the binary frame envelope (`docs/working/perf/protocol.md` §3).
 *
 * One channel message carries the whole frame:
 *
 *   [ u32 LE jsonLen ][ JSON envelope, UTF-8 ][ padding ][ section 0 ][ section 1 ] ...
 *
 * The envelope is the same payload shape the frontend already consumes, except that each band row
 * has been replaced by a descriptor -- `{ "$bin": 0, "dtype": "f32", "len": 958 }` -- naming a
 * section in the tail. Decoding swaps every descriptor back for a typed array view over the
 * received buffer, so everything downstream still sees an indexable, `.length`-bearing row.
 *
 * Sections carry no offset table: they sit in `$bin` order, each starting at the next offset its
 * element size divides. The descriptor is self-describing on every frame by design -- frames are
 * dropped when the webview falls behind, so a format announced once would take the session with it.
 */

/** Bumped only if the layout above changes. Present so a mismatch fails loudly, not subtly. */
export const FRAME_WIRE_VERSION = 1;

const SECTION_TYPES = {
  f32: { view: Float32Array, bytesPerElement: 4 },
  f64: { view: Float64Array, bytesPerElement: 8 },
  i16: { view: Int16Array, bytesPerElement: 2 },
};

/** The section area starts here so every element size below divides its offset. */
const SECTION_AREA_ALIGNMENT = 8;

function alignUp(offset, alignment) {
  const remainder = offset % alignment;
  return remainder === 0 ? offset : offset + (alignment - remainder);
}

function isDescriptor(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && "$bin" in value;
}

/**
 * Walk the envelope, collecting every `$bin` descriptor together with where it sits, so the caller
 * can overwrite it once the section offsets are known. Descriptors never nest inside one another.
 */
function collectDescriptors(node, found) {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (let index = 0; index < node.length; index += 1) {
      const child = node[index];
      if (isDescriptor(child)) found.push({ parent: node, key: index, descriptor: child });
      else collectDescriptors(child, found);
    }
    return;
  }
  for (const key of Object.keys(node)) {
    const child = node[key];
    if (isDescriptor(child)) found.push({ parent: node, key, descriptor: child });
    else collectDescriptors(child, found);
  }
}

/**
 * @param {ArrayBuffer} buffer one channel message
 * @returns {object} the frame, with every band row as a typed array view over `buffer`
 */
export function decodeFrameWire(buffer) {
  if (!(buffer instanceof ArrayBuffer)) {
    throw new TypeError("frame wire: expected an ArrayBuffer");
  }
  if (buffer.byteLength < 4) {
    throw new Error("frame wire: message is too short to hold a length prefix");
  }

  const jsonLength = new DataView(buffer).getUint32(0, true);
  if (4 + jsonLength > buffer.byteLength) {
    throw new Error(
      `frame wire: envelope claims ${jsonLength} bytes but only ${buffer.byteLength - 4} remain`
    );
  }

  const frame = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, jsonLength)));
  if (frame.wireVersion !== FRAME_WIRE_VERSION) {
    throw new Error(
      `frame wire: version ${frame.wireVersion} is not the ${FRAME_WIRE_VERSION} this build decodes`
    );
  }

  const found = [];
  collectDescriptors(frame, found);
  found.sort((left, right) => left.descriptor.$bin - right.descriptor.$bin);

  let offset = alignUp(4 + jsonLength, SECTION_AREA_ALIGNMENT);
  for (let index = 0; index < found.length; index += 1) {
    const { parent, key, descriptor } = found[index];
    if (descriptor.$bin !== index) {
      throw new Error(`frame wire: section ${index} is missing, found $bin ${descriptor.$bin}`);
    }
    const type = SECTION_TYPES[descriptor.dtype];
    if (!type) throw new Error(`frame wire: unknown dtype ${descriptor.dtype}`);

    offset = alignUp(offset, type.bytesPerElement);
    const byteLength = descriptor.len * type.bytesPerElement;
    if (offset + byteLength > buffer.byteLength) {
      throw new Error(`frame wire: section ${index} runs past the end of the message`);
    }
    parent[key] = new type.view(buffer, offset, descriptor.len);
    offset += byteLength;
  }

  return frame;
}
