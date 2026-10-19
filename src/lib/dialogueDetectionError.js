export function dialogueDetectionErrorMessage(code) {
  if (code === "initializationFailed") {
    return "Dialogue Detection could not start. Programme loudness is still available.";
  }
  if (code === "detectorOverloaded") {
    return "Dialogue Detection could not keep up and stopped. Programme loudness is still available; Clear restarts it.";
  }
  return "Dialogue Detection stopped. Programme loudness is still available.";
}
