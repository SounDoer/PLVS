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
    fireEvent.mouseEnter(info);
    expect(screen.getByText("C:/mix/final.wav")).toBeTruthy();
    expect(info.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(info);
    fireEvent.mouseLeave(info);
    expect(info.getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(screen.getByRole("dialog", { name: "file details" }), { key: "Escape" });
    await waitFor(() => expect(screen.queryByText("C:/mix/final.wav")).toBeNull());
  });

  it("shows original channel peak labels and occurrence time in details", () => {
    render(<FileAnalysisSummary {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "True Peak Max details" }));
    expect(screen.getByRole("cell", { name: "L" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "1.001 s" })).toBeTruthy();
  });

  it.each([
    ["momentaryMax", "Momentary Max", 24000, "0.100–0.500"],
    ["shortTermMax", "Short-term Max", 24000, "0.000–0.500"],
    ["shortTermMax", "Short-term Max", 144000, "0.000–3.000"],
    ["shortTermMax", "Short-term Max", null, "-"],
  ])("shows the %s range (%s, end frame %s)", (id, label, frame, expected) => {
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
        summaryMetrics={{ visible: [id], order: [id] }}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: label + " details" }));
    const range = screen.getByText("Loudest Range").parentElement;
    expect(range.textContent).toContain(expected);
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
});
