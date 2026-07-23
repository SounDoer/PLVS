export function chunkIdForSequence(sequence, chunkRows) {
  return Math.floor(sequence / chunkRows);
}

export function chunkOffsetForSequence(sequence, chunkRows) {
  return sequence % chunkRows;
}

export function findChunkForSequence(chunks, firstChunkId, sequence, chunkRows) {
  return chunks[chunkIdForSequence(sequence, chunkRows) - firstChunkId];
}
