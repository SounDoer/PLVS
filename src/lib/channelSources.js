import { CHANNEL_ROLES } from "../math/channelLayoutTable.js";

const speakerRoles = new Set(CHANNEL_ROLES.map(({ id }) => id).filter((id) => id !== "generic"));
const speakerLabels = {
  M: "Mono",
  L: "Left",
  R: "Right",
  C: "Center",
  LFE: "LFE",
  Ls: "Left Surround",
  Rs: "Right Surround",
  Lb: "Left Back",
  Rb: "Right Back",
  Cs: "Center Surround",
  Lw: "Left Wide",
  Rw: "Right Wide",
  Lc: "Left of Center",
  Rc: "Right of Center",
  Ltf: "Top Front Left",
  Rtf: "Top Front Right",
  Ltm: "Top Middle Left",
  Rtm: "Top Middle Right",
  Ltr: "Top Rear Left",
  Rtr: "Top Rear Right",
  Ctf: "Top Front Center",
  Ctm: "Top Middle Center",
  Ctr: "Top Rear Center",
};

export function splitChannelSource(id) {
  const match = /^ch:((?:cap|lb)-[0-9a-f]{32}):([0-9A-Za-z]+)$/.exec(id);
  if (!match) return null;
  const [, deviceId, channel] = match;
  const valid = deviceId.startsWith("cap-")
    ? /^[1-9][0-9]{0,2}$/.test(channel) && Number(channel) <= 256
    : speakerRoles.has(channel);
  return valid ? { deviceId, channel } : null;
}

export function deviceChannelChoices(device) {
  return (device.channelSelectors ?? []).map((channel) => ({
    id: `ch:${device.id}:${channel}`,
    label: device.id.startsWith("cap-")
      ? `Channel ${channel}`
      : (speakerLabels[channel] ?? channel),
  }));
}

export function findDeviceSource(devices, id) {
  const selection = splitChannelSource(id);
  const device = devices.find((candidate) => candidate.id === (selection?.deviceId ?? id));
  if (!device || !selection) return device ?? null;
  const choice = deviceChannelChoices(device).find((candidate) => candidate.id === id);
  return choice
    ? {
        ...device,
        id,
        label: `${device.label} · ${choice.label}`,
        channels: 1,
        channelCount: 1,
        parentId: device.id,
        channelLabel: choice.label,
      }
    : null;
}
