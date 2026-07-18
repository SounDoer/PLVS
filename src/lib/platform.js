function platformText() {
  if (typeof navigator === "undefined") return "";
  return navigator.platform || navigator.userAgent || "";
}

export function isMacOS() {
  return /Mac/i.test(platformText());
}

export function isWindows() {
  return /Win/i.test(platformText());
}

export function supportsDockMode() {
  return !isMacOS();
}
