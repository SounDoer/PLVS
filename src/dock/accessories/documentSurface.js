import { DOCK_ACCESSORY_SURFACES } from "../accessoryProtocol.js";

export function applyDocumentSurface(search, documentRef = document) {
  const requestedSurface = new URLSearchParams(search).get("surface");
  const surface = DOCK_ACCESSORY_SURFACES.includes(requestedSurface) ? requestedSurface : null;
  if (surface) documentRef.documentElement.dataset.surface = surface;
  else delete documentRef.documentElement.dataset.surface;
  return surface;
}
