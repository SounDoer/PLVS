import { applicationSourceName } from "../lib/audioDeviceLabels.js";
import { canSaveSourceMix, isMixOutputDevice } from "../lib/sourceMixes.js";
import {
  MIX_FORMATS,
  compileMixRouting,
  linearMixGain,
  mixGainDb,
  mixRoutingSources,
} from "../lib/mixRouting.js";

const id = { type: "string" };
const route = {
  type: "object",
  required: ["role", "gainDb"],
  additionalProperties: false,
  properties: { role: id, gainDb: { type: "number", minimum: -60, maximum: 24 } },
};
export const MIX_DRAFT_FIELDS = {
  setName: { name: { type: "string" } },
  setFormat: { format: { enum: MIX_FORMATS.map(({ id }) => id) } },
  setApplication: { sourceId: id, enabled: { type: "boolean" } },
  setInputChannels: {
    sourceId: id,
    channels: { type: "array", items: { type: "integer", minimum: 0, maximum: 255 } },
  },
  setOutput: { sourceId: { type: ["string", "null"] } },
  setRoute: { sourceId: id, lane: id, destinations: { type: ["array", "null"], items: route } },
};

export function mixDraftOperationTarget(operation) {
  switch (operation.op) {
    case "setApplication":
    case "setInputChannels":
      return typeof operation.sourceId === "string"
        ? `${operation.op}:${operation.sourceId}`
        : null;
    case "setRoute":
      return typeof operation.sourceId === "string" && typeof operation.lane === "string"
        ? `route:${operation.sourceId}:${operation.lane}`
        : null;
    default:
      return operation.op;
  }
}

export function mixDraftDocument(draft) {
  return {
    id: draft.id,
    name: draft.name,
    format: draft.format ?? "follow",
    members: draft.members,
    inputs: draft.inputs,
    output: draft.output ?? null,
    routes: draft.routes ?? {},
    referenceRoles: draft.referenceRoles ?? null,
  };
}

export function publicMixDocument(document) {
  const routes = Object.fromEntries(
    Object.entries(document.routes).map(([sourceId, lanes]) => [
      sourceId,
      Object.fromEntries(
        Object.entries(lanes).map(([lane, destinations]) => [
          lane,
          destinations.map(([role, gain]) => ({ role, gainDb: mixGainDb(gain) })),
        ])
      ),
    ])
  );
  return { ...document, routes };
}

export function applyMixDraftOperations(document, operations, inventory, issues) {
  const { applications, inputs, outputs, defaultOutputReference } = inventory;
  // Source selections and format settle first, so routes can target a source added in the batch.
  const ordered = operations.map((operation, index) => ({ operation, index }));
  for (const { operation, index } of ordered.filter(
    ({ operation }) => operation.op !== "setRoute"
  )) {
    const path = `$.operations[${index}]`;
    const { op, sourceId } = operation;
    const reject = (field) =>
      issues.push({
        code: "invalidValue",
        path: `${path}.${field}`,
        message: `Invalid Mix ${field}.`,
      });
    switch (op) {
      case "setName":
        if (typeof operation.name !== "string" || operation.name.length > 512) reject("name");
        else document.name = operation.name;
        break;
      case "setFormat":
        if (!MIX_DRAFT_FIELDS.setFormat.format.enum.includes(operation.format)) reject("format");
        else document.format = operation.format;
        break;
      case "setApplication": {
        const current = document.members.find(({ id }) => id === sourceId);
        const available = applications.find(({ id }) => id === sourceId);
        if (typeof operation.enabled !== "boolean") reject("enabled");
        else if (!current && !available) reject("sourceId");
        else if (operation.enabled && !current)
          document.members.push({ id: sourceId, label: applicationSourceName(available) });
        else if (!operation.enabled) {
          document.members = document.members.filter(({ id }) => id !== sourceId);
          delete document.routes[sourceId];
        }
        break;
      }
      case "setInputChannels": {
        const selected = document.inputs.find(({ id }) => id === sourceId);
        const device = inputs.find(({ id }) => id === sourceId);
        const { channels } = operation;
        if (!device && !selected) reject("sourceId");
        else if (
          !Array.isArray(channels) ||
          channels.length > 256 ||
          new Set(channels).size !== channels.length ||
          !channels.every(
            (channel) =>
              Number.isInteger(channel) &&
              channel >= 0 &&
              channel < 256 &&
              (channel < device?.channels || selected?.channels.includes(channel))
          )
        )
          reject("channels");
        else {
          const next = {
            id: sourceId,
            label: device?.label ?? selected.label,
            channels: [...channels].sort((a, b) => a - b),
          };
          document.inputs = selected
            ? document.inputs.flatMap((input) =>
                input.id !== sourceId ? [input] : channels.length ? [next] : []
              )
            : channels.length
              ? [...document.inputs, next]
              : document.inputs;
          const lanes = document.routes[sourceId];
          if (lanes) {
            for (const lane of Object.keys(lanes))
              if (!channels.includes(Number(lane))) delete lanes[lane];
            if (!Object.keys(lanes).length) delete document.routes[sourceId];
          }
        }
        break;
      }
      case "setOutput": {
        const device = outputs.find(
          (device) => device.id === sourceId && isMixOutputDevice(device)
        );
        if (sourceId === document.output?.id) break;
        if (sourceId !== null && !device) reject("sourceId");
        else {
          if (document.output) delete document.routes[document.output.id];
          document.output = device
            ? {
                id: device.id,
                label: device.label,
                roles: device.mixOutputRoles ?? ["L", "R"],
                ...(device.referenceRoles && { referenceRoles: device.referenceRoles }),
              }
            : null;
        }
        break;
      }
    }
  }
  if (issues.length) return;
  const sources = mixRoutingSources(document, outputs);
  for (const { operation, index } of ordered.filter(
    ({ operation }) => operation.op === "setRoute"
  )) {
    const { sourceId, lane, destinations } = operation;
    const source = sources.find(({ id }) => id === sourceId);
    const previous = document.routes[sourceId];
    if (
      !source ||
      typeof lane !== "string" ||
      (!source.lanes.some(({ key }) => key === lane) &&
        !(destinations === null && Object.hasOwn(previous ?? {}, lane)))
    ) {
      issues.push({
        code: "invalidValue",
        path: `$.operations[${index}].lane`,
        message: "Choose a channel of a selected Mix source.",
      });
      continue;
    }
    if (destinations === null) {
      if (previous) {
        delete previous[lane];
        if (!Object.keys(previous).length) delete document.routes[sourceId];
      }
    } else if (validDestinations(destinations)) {
      (document.routes[sourceId] ??= {})[lane] = destinations.map(({ role, gainDb }) => [
        role,
        linearMixGain(gainDb),
      ]);
    } else {
      issues.push({
        code: "invalidValue",
        path: `$.operations[${index}].destinations`,
        message: "Destinations require distinct roles and a gain from −60 to +24 dB.",
      });
    }
  }
  if (
    !issues.length &&
    sources.length &&
    (!canSaveSourceMix(document) || !compileMixRouting(document, outputs, defaultOutputReference))
  ) {
    issues.push({
      code: "invalidMixRouting",
      path: "$.operations",
      message: "The resulting Mix has incompatible sources or unavailable routes.",
    });
  }
}

function validDestinations(value) {
  return (
    Array.isArray(value) &&
    value.length <= 16 &&
    value.every(
      (edge) =>
        edge &&
        typeof edge === "object" &&
        Object.keys(edge).length === 2 &&
        typeof edge.role === "string" &&
        Number.isFinite(edge.gainDb) &&
        edge.gainDb >= -60 &&
        edge.gainDb <= 24
    ) &&
    new Set(value.map(({ role }) => role)).size === value.length
  );
}
