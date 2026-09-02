import { listen } from "@tauri-apps/api/event";
import {
  agentControlFrontendNotReadyCommand,
  agentControlFrontendReadyCommand,
  agentControlRespondCommand,
} from "./commands.js";

const REQUEST_EVENT = "agent-control://request";

export function listenForAgentControlRequests(handler) {
  return listen(REQUEST_EVENT, (event) => handler(event.payload));
}

export function announceAgentControlFrontendReady() {
  return agentControlFrontendReadyCommand();
}

export function announceAgentControlFrontendNotReady() {
  return agentControlFrontendNotReadyCommand();
}

export function respondToAgentControlRequest(response) {
  return agentControlRespondCommand(response);
}
