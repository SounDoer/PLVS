import { emitTo, listen } from "@tauri-apps/api/event";
import { DOCK_ACCESSORY_EVENTS } from "../dock/accessoryProtocol.js";

export function listenDockAccessoryAction(handler) {
  return listen(DOCK_ACCESSORY_EVENTS.action, (event) => handler(event.payload));
}

export function listenDockAccessoryPointer(handler) {
  return listen(DOCK_ACCESSORY_EVENTS.pointer, (event) => handler(event.payload));
}

export function listenDockAccessoryReady(handler) {
  return listen(DOCK_ACCESSORY_EVENTS.ready, (event) => handler(event.payload));
}

export function listenDockAccessoryState(handler) {
  return listen(DOCK_ACCESSORY_EVENTS.state, (event) => handler(event.payload));
}

export function emitDockAccessoryState(surface, snapshot) {
  return emitTo(surface, DOCK_ACCESSORY_EVENTS.state, snapshot);
}

export function emitDockAccessoryAction(action) {
  return emitTo("main", DOCK_ACCESSORY_EVENTS.action, action);
}

export function emitDockAccessoryPointer(pointer) {
  return emitTo("main", DOCK_ACCESSORY_EVENTS.pointer, pointer);
}

export function emitDockAccessoryReady(surface) {
  return emitTo("main", DOCK_ACCESSORY_EVENTS.ready, { surface });
}
