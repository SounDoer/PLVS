export function dialogueDetectionErrorMessage(code) {
  return code === "initializationFailed"
    ? "Dialogue Detection could not start. Programme loudness is still available."
    : "Dialogue Detection stopped. Programme loudness is still available.";
}
