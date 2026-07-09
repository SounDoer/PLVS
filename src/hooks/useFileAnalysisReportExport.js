import { useCallback } from "react";
import { writeTextFile } from "../ipc/commands.js";
import { isTauri } from "../ipc/env.js";
import { saveFileAnalysisReportFile } from "../ipc/fileDialog.js";
import {
  buildFileAnalysisReport,
  defaultFileAnalysisReportName,
  stringifyFileAnalysisReport,
} from "../lib/fileAnalysisReport.js";

export function useFileAnalysisReportExport({ fileSession, appVersion, setStatus }) {
  const exportFileAnalysisReport = useCallback(async () => {
    if (fileSession.state !== "complete") {
      setStatus("Choose a completed file analysis to export");
      return;
    }

    try {
      const report = buildFileAnalysisReport(fileSession, { appVersion });
      const contents = stringifyFileAnalysisReport(report);
      const defaultName = defaultFileAnalysisReportName(fileSession);

      if (isTauri()) {
        const path = await saveFileAnalysisReportFile(defaultName);
        if (!path) return;
        await writeTextFile(path, contents);
      } else {
        const blob = new Blob([contents], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = defaultName;
        a.click();
        URL.revokeObjectURL(url);
      }
      setStatus("File analysis report exported");
    } catch (_) {
      setStatus("Report export failed");
    }
  }, [appVersion, fileSession, setStatus]);

  return {
    exportFileAnalysisReport,
  };
}
