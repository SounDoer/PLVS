/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FileAnalysisSummary } from "./FileAnalysisSummary.jsx";

const fileSession = {
  id: "one",
  state: /** @type {const} */ ("complete"),
  fileName: "final.wav",
  path: "C:/mix/final.wav",
  metadata: {
    selectedTrack: {
      index: 0,
      codec: "pcm_f32le",
      channels: 2,
      sampleRateHz: 48000,
      bitsPerSample: 32,
    },
  },
  analysisSettings: { dialogue: { enabled: true, engine: "firered" } },
  summary: {
    durationMs: 180000,
    channels: 2,
    sampleRateHz: 48000,
    loudnessLayout: "stereo",
    loudnessLayoutKnown: true,
    integratedLufs: -16.2,
    lra: 4.1,
    truePeakMaxDbtp: -1,
    channelPeaks: [
      {
        channelIndex: 0,
        truePeakMaxDbtp: -1,
        truePeakMaxLocation: { framePosition: 48030, timeSeconds: 1.000625 },
      },
    ],
  },
};
const props = {
  fileSession,
  fileSessions: [fileSession],
  activeFileId: "one",
  analyzingFileId: null,
  onSelectFile: vi.fn(),
  onReanalyzeFile: vi.fn(),
  onRemoveFile: vi.fn(),
  onClearAllFiles: vi.fn(),
  onStopFile: vi.fn(),
  onExportReport: vi.fn(),
  onCopyReport: vi.fn(),
};

describe("File summary", () => {
  it("keeps authoritative readings in two lines and puts metadata details beside source specs", () => {
    render(<FileAnalysisSummary {...props} />);
    expect(screen.getByRole("button", { name: "files" })).toBeTruthy();
    expect(screen.getByText("Stereo · 48 kHz · 32-bit Float · 00:03:00")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Integrated details" }).textContent).toContain(
      "-16.2 LUFS"
    );
    expect(screen.getByRole("button", { name: "LRA details" }).textContent).toContain("4.1 LU");
    expect(screen.queryByRole("button", { name: "Export" })).toBeNull();
  });

  it("previews then pins copyable file details and closes with Escape", async () => {
    render(<FileAnalysisSummary {...props} />);
    const info = screen.getByRole("button", { name: "file details" });
    const metadata = screen.getByText("Stereo · 48 kHz · 32-bit Float · 00:03:00");
    expect(info.contains(metadata)).toBe(true);
    expect(info.querySelector("svg")).toBeNull();
    fireEvent.mouseEnter(metadata);
    expect(screen.getByText("C:/mix/final.wav")).toBeTruthy();
    expect(screen.getByText("Unspecified")).toBeTruthy();
    expect(screen.getByText("Stereo (Inferred)")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "file analysis warning" })).toBeNull();
    expect(info.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(info);
    fireEvent.mouseLeave(info);
    expect(info.getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(screen.getByRole("dialog", { name: "file details" }), { key: "Escape" });
    await waitFor(() => expect(screen.queryByText("C:/mix/final.wav")).toBeNull());
  });

  it.each([
    {
      reported: "5.1",
      known: true,
      roles: ["L", "R", "C", "LFE", "Ls", "Rs"],
      layout: "5.1",
      compact: "5.1",
      source: "5.1",
      calculation: "5.1",
      warning: null,
    },
    {
      reported: undefined,
      known: true,
      roles: undefined,
      layout: "5.1",
      compact: "5.1 (Inferred)",
      source: "Unspecified",
      calculation: "5.1 (Inferred)",
      warning: /used 5\.1 to calculate loudness based on the track’s 6 channels/,
    },
    {
      reported: "unknown",
      known: false,
      roles: undefined,
      layout: "unknown",
      compact: "10 ch (Layout Unknown)",
      source: "Unspecified",
      calculation: /Unknown · Loudness uses channels 1–2/,
      warning: /Loudness uses channels 1–2 only.*True Peak Max covers every channel/,
    },
    {
      reported: "6 channels (FL+FR+FC+LFE+SL+BFC)",
      known: true,
      roles: undefined,
      layout: "5.1",
      compact: "5.1 (Inferred)",
      source: "6 channels (FL+FR+FC+LFE+SL+BFC)",
      calculation: "5.1 (Inferred)",
      warning: /Channel Layout Inferred/,
    },
  ])("distinguishes reported $reported from calculation $calculation", (example) => {
    const channels = example.known ? 6 : 10;
    const session = {
      ...fileSession,
      metadata: {
        selectedTrack: {
          ...fileSession.metadata.selectedTrack,
          channels,
          channelLayout: example.reported,
          channelRoles: example.roles,
        },
      },
      summary: {
        ...fileSession.summary,
        channels,
        loudnessLayout: example.layout,
        loudnessLayoutKnown: example.known,
        channelRoles: example.roles,
      },
    };
    render(<FileAnalysisSummary {...props} fileSession={session} fileSessions={[session]} />);
    const details = screen.getByRole("button", { name: "file details" });
    expect(details.textContent).toContain(example.compact);
    fireEvent.mouseEnter(details);
    expect(screen.getByText("Source Layout").nextElementSibling.textContent).toBe(example.source);
    const calculation = screen.getByText("Calculation Layout").nextElementSibling.textContent;
    if (example.calculation instanceof RegExp) expect(calculation).toMatch(example.calculation);
    else expect(calculation).toBe(example.calculation);
    const icon = screen.queryByRole("button", { name: "file analysis warning" });
    if (example.warning) {
      expect(icon).toBeTruthy();
      fireEvent.mouseEnter(icon);
      expect(screen.getByText(example.warning)).toBeTruthy();
    } else expect(icon).toBeNull();
  });

  it("shows original channel peak labels and occurrence time in details", () => {
    render(<FileAnalysisSummary {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "True Peak Max details" }));
    expect(screen.getByRole("cell", { name: "L" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "1.001 s" })).toBeTruthy();
  });

  it("jumps from a channel peak using its unrounded time and closes the details", () => {
    const onJumpToTime = vi.fn();
    render(<FileAnalysisSummary {...props} onJumpToTime={onJumpToTime} />);
    fireEvent.click(screen.getByRole("button", { name: "True Peak Max details" }));
    fireEvent.click(
      screen.getByRole("button", { name: "jump to L True Peak Max at 1.001 seconds" })
    );
    expect(onJumpToTime).toHaveBeenCalledWith(1.000625);
    expect(screen.queryByRole("dialog", { name: "True Peak Max details" })).toBeNull();
  });

  it("keeps the peak time readable and prompts for restoration when history was released", () => {
    render(
      <FileAnalysisSummary {...props} fileSession={{ ...fileSession, historyReleased: true }} />
    );
    fireEvent.click(screen.getByRole("button", { name: "True Peak Max details" }));
    expect(screen.getByRole("cell", { name: "1.001 s" })).toBeTruthy();
    expect(screen.getByText("Choose Restore History to jump to a time.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /jump to/ })).toBeNull();
  });

  it.each([
    ["momentaryMax", "Momentary Max", 24000, "0.100–0.500"],
    ["shortTermMax", "Short-term Max", 24000, "0.000–0.500"],
    ["shortTermMax", "Short-term Max", 144000, "0.000–3.000"],
    ["shortTermMax", "Short-term Max", null, "-"],
  ])("shows the %s range (%s, end frame %s)", (id, label, frame, expected) => {
    const onJumpToTime = vi.fn();
    const location = frame == null ? null : { framePosition: frame, timeSeconds: frame / 48000 };
    const session = {
      ...fileSession,
      summary: {
        ...fileSession.summary,
        mMaxLufs: -12,
        stMaxLufs: -14,
        maximaLocations: { mMaxWindowEnd: location, stMaxWindowEnd: location },
      },
    };
    render(
      <FileAnalysisSummary
        {...props}
        fileSession={session}
        onJumpToTime={onJumpToTime}
        summaryMetrics={{ visible: [id], order: [id] }}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: label + " details" }));
    const range = screen.getByText("Loudest Range").parentElement;
    expect(range.textContent).toContain(expected);
    const jump = screen.queryByRole("button", { name: /jump to.*range end/ });
    if (location) {
      fireEvent.click(jump);
      expect(onJumpToTime).toHaveBeenCalledWith(location.timeSeconds);
    } else {
      expect(jump).toBeNull();
    }
  });

  it("keeps successful numbers after settings change and warns only in the details", () => {
    render(
      <FileAnalysisSummary
        {...props}
        currentSettings={{ dialogue: { enabled: true, engine: "silero" } }}
      />
    );
    expect(screen.getByRole("button", { name: "Integrated details" }).textContent).toContain(
      "-16.2 LUFS"
    );
    expect(screen.queryByText(/changed since this result/)).toBeNull();
    fireEvent.mouseEnter(screen.getByRole("button", { name: "file analysis warning" }));
    expect(screen.getByText(/Dialogue Detection changed since this result/)).toBeTruthy();
  });

  it("retains the previous result during reanalysis without a separate activity indicator", () => {
    render(
      <FileAnalysisSummary
        {...props}
        fileSession={{ ...fileSession, state: "analyzing", successfulResult: fileSession }}
        analyzingFileId="one"
        currentSettings={fileSession.analysisSettings}
      />
    );
    expect(screen.getByRole("button", { name: "Integrated details" }).textContent).toContain(
      "-16.2 LUFS"
    );
    expect(screen.queryByRole("button", { name: "analysis activity" })).toBeNull();
    expect(screen.queryByRole("button", { name: "file analysis warning" })).toBeNull();
  });
});
