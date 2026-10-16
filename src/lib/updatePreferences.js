/** Missing preferences are a fresh, unresolved choice. Native boot migrates existing users. */
export function normalizeUpdatePreferences(value) {
  const choiceMade = value?.choiceMade === true;
  const autoCheck = choiceMade && value?.autoCheck === true;
  return {
    choiceMade,
    autoCheck,
    autoDownload: autoCheck && value?.autoDownload === true,
  };
}

export function changeUpdatePreferences(current, patch) {
  return normalizeUpdatePreferences({
    ...normalizeUpdatePreferences(current),
    ...patch,
    choiceMade: true,
  });
}
