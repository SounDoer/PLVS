/**
 * Just enough source map to name a profiled frame.
 *
 * A production profile lists minified identifiers -- `qN`, `soe` -- against a bundle line, which
 * says which file was hot but not which function. Resolving that needs only a position lookup, so
 * this decodes the mappings itself rather than adding a dependency for one query shape.
 */

const BASE64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_INDEX = new Map([...BASE64].map((char, index) => [char, index]));

/**
 * Decodes one run of base64 VLQ values -- the encoding a `mappings` segment is written in, where
 * each value is a delta from the previous one of its kind.
 *
 * @param {string} text
 * @returns {number[]}
 */
export function decodeVlq(text) {
  const values = [];
  let value = 0;
  let shift = 0;
  for (const char of text) {
    const digit = BASE64_INDEX.get(char);
    if (digit === undefined) throw new Error(`not base64 VLQ: ${char}`);
    value += (digit & 31) << shift;
    if (digit & 32) {
      shift += 5;
      continue;
    }
    const negative = value & 1;
    value >>= 1;
    values.push(negative ? (value === 0 ? -0x80000000 : -value) : value);
    value = 0;
    shift = 0;
  }
  return values;
}

/**
 * Segments per generated line, each `[generatedColumn, sourceIndex, sourceLine, sourceColumn,
 * nameIndex?]` in absolute terms.
 *
 * @param {string} mappings
 * @returns {number[][][]}
 */
export function decodeMappings(mappings) {
  const lines = [];
  let sourceIndex = 0;
  let sourceLine = 0;
  let sourceColumn = 0;
  let nameIndex = 0;
  for (const lineText of mappings.split(";")) {
    const segments = [];
    let generatedColumn = 0;
    for (const segmentText of lineText.split(",")) {
      if (!segmentText) continue;
      const fields = decodeVlq(segmentText);
      generatedColumn += fields[0];
      if (fields.length === 1) {
        segments.push([generatedColumn]);
        continue;
      }
      sourceIndex += fields[1];
      sourceLine += fields[2];
      sourceColumn += fields[3];
      if (fields.length > 4) {
        nameIndex += fields[4];
        segments.push([generatedColumn, sourceIndex, sourceLine, sourceColumn, nameIndex]);
      } else {
        segments.push([generatedColumn, sourceIndex, sourceLine, sourceColumn]);
      }
    }
    lines.push(segments);
  }
  return lines;
}

/**
 * Resolves a generated position to the original one, taking the last segment that starts at or
 * before the column -- the same rule a debugger uses.
 *
 * @param {{ sources: string[], names?: string[], mappings: string, sourceRoot?: string }} map
 * @returns {(line: number, column: number) => ({ source: string, line: number, column: number, name?: string } | null)}
 *   line and column are zero-based going in and coming out.
 */
export function makeSourceMapper(map) {
  const lines = decodeMappings(map.mappings ?? "");
  const sources = map.sources ?? [];
  const names = map.names ?? [];
  return (line, column) => {
    const segments = lines[line];
    if (!segments || segments.length === 0) return null;
    let found = null;
    for (const segment of segments) {
      if (segment[0] > column) break;
      if (segment.length >= 4) found = segment;
    }
    if (!found) return null;
    const source = sources[found[1]] ?? "";
    return {
      source: map.sourceRoot ? `${map.sourceRoot}${source}` : source,
      line: found[2],
      column: found[3],
      name: found.length > 4 ? names[found[4]] : undefined,
    };
  };
}
