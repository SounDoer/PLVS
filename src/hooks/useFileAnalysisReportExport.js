import { useCallback } from "react";
import { writeTextFile } from "../ipc/commands.js";
import { isTauri } from "../ipc/env.js";
import { saveFileAnalysisReportFile } from "../ipc/fileDialog.js";
import { describeActiveLoudnessProfile } from "../lib/activeLoudnessProfile.js";
import {
  buildFileAnalysisReport,
  defaultFileAnalysisReportName,
  stringifyFileAnalysisReport,
} from "../lib/fileAnalysisReport.js";
import { renderFileAnalysisReportMarkdown } from "../lib/fileAnalysisReportMarkdown.js";

const REPORT_FORMATS = {
  json: { extension: "json", mediaType: "application/json", render: stringifyFileAnalysisReport },
  markdown: {
    extension: "md",
    mediaType: "text/markdown",
    render: renderFileAnalysisReportMarkdown,
  },
};

/// `loudnessProfile` is the `useLoudnessProfile()` value; the report judges against whatever it
/// has in force, the open editor's draft included.
export function useFileAnalysisReportExport({
  fileSession,
  appVersion,
  raiseNotice,
  loudnessProfile = null,
}) {
  const buildReport = useCallback(
    () =>
      buildFileAnalysisReport(fileSession, {
        appVersion,
        loudnessProfile: describeActiveLoudnessProfile(loudnessProfile ?? {}),
      }),
    [appVersion, fileSession, loudnessProfile]
  );

  const exportFileAnalysisReport = useCallback(
    async (format = "json") => {
      if (fileSession.state !== "complete") {
        raiseNotice("guard", "Choose a completed file analysis to export");
        return;
      }

      try {
        const { extension, mediaType, render } = REPORT_FORMATS[format];
        const contents = render(buildReport());
        const defaultName = defaultFileAnalysisReportName(fileSession, extension);

        if (isTauri()) {
          const path = await saveFileAnalysisReportFile(defaultName, format);
          if (!path) return;
          await writeTextFile(path, contents);
        } else {
          const blob = new Blob([contents], { type: mediaType });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = defaultName;
          a.click();
          URL.revokeObjectURL(url);
        }
      } catch (_) {
        raiseNotice("error", "Report export failed");
      }
    },
    [buildReport, fileSession, raiseNotice]
  );

  /// Resolves true once the Markdown is on the clipboard, so the caller can confirm it.
  const copyFileAnalysisReportMarkdown = useCallback(async () => {
    if (fileSession.state !== "complete") {
      raiseNotice("guard", "Choose a completed file analysis to copy");
      return false;
    }
    try {
      await navigator.clipboard.writeText(renderFileAnalysisReportMarkdown(buildReport()));
      return true;
    } catch (_) {
      raiseNotice("error", "Copy failed");
      return false;
    }
  }, [buildReport, fileSession, raiseNotice]);

  return {
    exportFileAnalysisReport,
    copyFileAnalysisReportMarkdown,
  };
}
