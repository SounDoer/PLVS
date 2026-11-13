import { useRef, useState } from "react";
import { writeTextFile } from "../ipc/commands.js";
import { saveFileAnalysisReportFile } from "../ipc/fileDialog.js";
import { describeActiveLoudnessProfile } from "../lib/activeLoudnessProfile.js";
import { buildFileAnalysisStatisticsCsv } from "../lib/fileAnalysisStatisticsCsv.js";
import { getSuccessfulFileSession } from "../lib/fileAnalysisSessionRegistry.js";
import { formatFileEntryName } from "../lib/fileAnalysisDisplay.js";

function localExportTimestamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  const day = [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join("-");
  const time = [date.getHours(), date.getMinutes(), date.getSeconds()].map(pad).join("-");
  return day + "_" + time;
}

export function useFileStatisticsExport({
  fileSessions,
  loudnessProfile,
  raiseNotice,
  appVersion,
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const items = open
    ? fileSessions.map((file) => ({
        id: file.id,
        name: formatFileEntryName(file, fileSessions),
        disabled: !getSuccessfulFileSession(file),
      }))
    : [];
  const onOpen = () => {
    if (fileSessions.some(getSuccessfulFileSession)) setOpen(true);
  };
  const onClose = () => {
    if (!pending.current) setOpen(false);
  };
  const onExport = async (ids) => {
    if (pending.current) return false;
    const selected = new Set(ids);
    const entries = fileSessions.filter(
      (file) => selected.has(file.id) && getSuccessfulFileSession(file)
    );
    if (!entries.length) return false;
    pending.current = true;
    setBusy(true);
    try {
      // Capture every result and the same effective Profile before the native save dialog yields.
      const exportTime = new Date();
      const contents = buildFileAnalysisStatisticsCsv(entries, {
        exportedAt: exportTime.toISOString(),
        appVersion,
        loudnessProfile: describeActiveLoudnessProfile(loudnessProfile),
      });
      const defaultName = `plvs-file-statistics-${localExportTimestamp(exportTime)}.csv`;
      const path = await saveFileAnalysisReportFile(defaultName, "csv");
      if (!path) return false;
      await writeTextFile(path, contents);
      setOpen(false);
      return true;
    } catch (_) {
      raiseNotice("error", "Statistics export failed", undefined, {
        requiresAttention: true,
        helpTopic: "file-report",
      });
      return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return { open, busy, items, onOpen, onClose, onExport };
}
