export function sameFileSourceVersion(left, right) {
  return Boolean(
    left?.sha256 &&
    right?.sha256 &&
    left.canonicalPath === right.canonicalPath &&
    left.sha256 === right.sha256 &&
    left.byteLength === right.byteLength
  );
}

export function withSelectedAudioTrack(probe, index) {
  const tracks = probe.audioTracks?.length ? probe.audioTracks : [probe.selectedTrack];
  const selectedTrack = tracks.find((track) => track?.index === index);
  if (!selectedTrack) throw new Error("The original audio track is no longer available");
  return { ...probe, selectedTrack };
}
