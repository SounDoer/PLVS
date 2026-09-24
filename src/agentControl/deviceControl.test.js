import { describe, expect, it } from "vitest";
import {
  MAX_PUBLIC_DEVICE_LABEL_SCALARS,
  MAX_PUBLIC_DEVICE_ROWS,
  advanceDeviceGeneration,
  buildDeviceInspection,
  buildDeviceList,
  normalizeDeviceInventory,
  planDeviceSelection,
} from "./deviceControl.js";

const LB = "lb-0123456789abcdef0123456789abcdef";
const CAP = "cap-fedcba9876543210fedcba9876543210";

function rows() {
  return [
    {
      id: LB,
      label: "Speakers",
      isSystemOutputMonitor: true,
      isLoopback: true,
      defaultSampleRate: 48_000,
      channels: 2,
      coreAudioOutputUid: "private-backend-value",
    },
    {
      id: CAP,
      label: "Microphone",
      isSystemOutputMonitor: false,
      isLoopback: false,
      defaultSampleRate: 96_000,
      channels: 1,
    },
  ];
}

function inventory({ devices = rows(), preview = undefined, previous } = {}) {
  const normalized = normalizeDeviceInventory(
    devices,
    preview === undefined
      ? { label: "Default Speakers", sampleRateHz: 48_000, channels: 2 }
      : preview,
    "2026-09-07T10:12:40.000Z"
  );
  return advanceDeviceGeneration(previous, normalized);
}

describe("Device Control inventory", () => {
  it("publishes semantic output/input rows in native GUI order without backend keys", () => {
    const state = inventory();
    expect(buildDeviceList(state)).toEqual({
      generation: 1,
      observedAt: "2026-09-07T10:12:40.000Z",
      automatic: {
        id: "default",
        label: "Automatic",
        available: true,
        resolved: { label: "Default Speakers", sampleRateHz: 48_000, channelCount: 2 },
      },
      devices: [
        {
          id: LB,
          label: "Speakers",
          kind: "systemOutput",
          direction: "output",
          loopback: true,
          sampleRateHz: 48_000,
          channelCount: 2,
        },
        {
          id: CAP,
          label: "Microphone",
          kind: "input",
          direction: "input",
          loopback: false,
          sampleRateHz: 96_000,
          channelCount: 1,
        },
      ],
      truncated: false,
    });
  });

  it("bounds rows and labels by Unicode scalar values while retaining full selection inventory", () => {
    const longLabel = "😀".repeat(MAX_PUBLIC_DEVICE_LABEL_SCALARS + 2);
    const devices = Array.from({ length: MAX_PUBLIC_DEVICE_ROWS + 1 }, (_, index) => ({
      id: `cap-${String(index).padStart(32, "0")}`,
      label: longLabel,
      channels: 2,
      defaultSampleRate: 48_000,
    }));
    const state = inventory({ devices });
    expect(state.devices).toHaveLength(MAX_PUBLIC_DEVICE_ROWS);
    expect(state.allDevices).toHaveLength(MAX_PUBLIC_DEVICE_ROWS + 1);
    expect(Array.from(state.devices[0].label)).toHaveLength(MAX_PUBLIC_DEVICE_LABEL_SCALARS);
    expect(state.truncated).toBe(true);
  });

  it("models no devices and unavailable Automatic without inventing a resolved ID", () => {
    const state = inventory({ devices: [], preview: null });
    expect(state.automatic).toEqual({
      id: "default",
      label: "Automatic",
      available: false,
      resolved: null,
    });
    expect(
      buildDeviceInspection({ ...state, requestedId: "default" }, { state: "stopped" })
    ).toMatchObject({
      selection: { mode: "automatic", available: false, resolved: null },
      live: { running: false, transition: null, usingRequestedSelection: false },
    });
  });

  it("rejects duplicate IDs instead of silently de-duplicating", () => {
    expect(() => inventory({ devices: [rows()[0], rows()[0]] })).toThrow(/duplicate ID/);
  });

  it("advances generation only when normalized inventory or Automatic preview changes", () => {
    const first = inventory();
    const observedAgain = inventory({ previous: first });
    const changed = inventory({ previous: observedAgain, devices: rows().slice().reverse() });
    expect(observedAgain.generation).toBe(1);
    expect(observedAgain.observedAt).toBe("2026-09-07T10:12:40.000Z");
    expect(changed.generation).toBe(2);
  });
});

describe("Device Control inspection", () => {
  it("reports exact and automatic resolution plus migration and Live settlement", () => {
    const state = inventory();
    expect(
      buildDeviceInspection(
        { ...state, requestedId: CAP, migrationState: { state: "migrating" } },
        { state: "running", requestedDeviceId: CAP }
      )
    ).toMatchObject({
      selection: {
        requestedId: CAP,
        mode: "exact",
        available: true,
        resolved: { id: CAP, kind: "input" },
        transition: "migrating",
      },
      live: { running: true, transition: null, usingRequestedSelection: true },
    });
    expect(
      buildDeviceInspection({ ...state, requestedId: "default" }, { state: "running" }).selection
        .resolved.id
    ).toBeNull();
  });
});

describe("Device Control selection planner", () => {
  it("checks stale generation before no-op", () => {
    const state = { ...inventory(), requestedId: CAP };
    expect(
      planDeviceSelection(state, { deviceId: CAP, expectedGeneration: 0 }, { state: "stopped" })
        .issues[0]
    ).toMatchObject({ code: "deviceInventoryChanged", path: "$.expectedGeneration" });
  });

  it("accepts only a current exact ID or literal default", () => {
    const state = { ...inventory(), requestedId: "default" };
    expect(
      planDeviceSelection(
        state,
        { deviceId: "Microphone", expectedGeneration: 1 },
        { state: "stopped" }
      ).issues[0].code
    ).toBe("deviceNotFound");
  });

  it("makes an exact no-op without confirmation, write, restart, or warning", () => {
    const state = { ...inventory(), requestedId: CAP };
    expect(
      planDeviceSelection(state, { deviceId: CAP, expectedGeneration: 1 }, { state: "running" })
    ).toMatchObject({
      changed: false,
      effects: [],
      warnings: [],
      confirmationsRequired: [],
      plan: { from: CAP, to: CAP, restartLive: false },
    });
  });

  it("persists a stopped selection without starting Live or touching a selected File session", () => {
    const state = { ...inventory(), requestedId: "default" };
    expect(
      planDeviceSelection(
        state,
        { deviceId: CAP, expectedGeneration: 1 },
        { state: "stopped", source: "file", activeFileId: "file-1" }
      )
    ).toMatchObject({ changed: true, effects: [], plan: { restartLive: false } });
  });

  it("requires confirmation and reports measurement restart only while Live is running", () => {
    const state = { ...inventory(), requestedId: "default" };
    expect(
      planDeviceSelection(state, { deviceId: CAP, expectedGeneration: 1 }, { state: "running" })
    ).toMatchObject({
      changed: true,
      effects: ["measurementRestart"],
      confirmationsRequired: ["allowMeasurementRestart"],
      plan: { restartLive: true },
    });
  });

  it("allows unavailable Automatic while stopped with a warning and refuses it while running", () => {
    const state = { ...inventory({ preview: null }), requestedId: CAP };
    expect(
      planDeviceSelection(
        state,
        { deviceId: "default", expectedGeneration: 1 },
        { state: "stopped" }
      )
    ).toMatchObject({ changed: true, warnings: ["automaticCurrentlyUnavailable"] });
    expect(
      planDeviceSelection(
        state,
        { deviceId: "default", expectedGeneration: 1 },
        { state: "running" }
      ).issues[0].code
    ).toBe("deviceUnavailable");
  });

  it("refuses selection during an existing Live transition", () => {
    const state = { ...inventory(), requestedId: "default" };
    expect(
      planDeviceSelection(state, { deviceId: CAP, expectedGeneration: 1 }, { state: "restarting" })
        .refusal
    ).toEqual({ code: "transitionInProgress", state: "restarting" });
    expect(
      planDeviceSelection(
        state,
        { deviceId: CAP, expectedGeneration: 1 },
        { state: "running", transition: "restarting" }
      ).refusal
    ).toEqual({ code: "transitionInProgress", state: "restarting" });
  });
});
