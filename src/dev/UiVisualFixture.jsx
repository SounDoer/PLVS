import { useState } from "react";
import { CloseConfirmDialog } from "../components/CloseConfirmDialog.jsx";
import { CrashReportDialog } from "../components/CrashReportDialog.jsx";
import { PresetsPopoverContent } from "../components/PresetsPopover.jsx";
import { ThemePreview } from "../components/theme-editor/ThemePreview.jsx";
import { UpdateDialog } from "../components/UpdateDialog.jsx";
import { Popover, PopoverAnchor, PopoverContent } from "../components/ui/popover.jsx";
import { getBuiltinThemeV2 } from "../theme/builtinThemesV2.js";
import { useUiSurface } from "../uiNavigation/UiNavigationContext.jsx";
import packageInfo from "../../package.json";

const CRASH_REPORT = Object.freeze({
  schemaVersion: 1,
  id: "ui-visual-fixture",
  createdAt: "2026-10-06T10:00:00Z",
  sessionId: "ui-review",
  kind: "rust_panic",
  app: { version: packageInfo.version, os: "fixture", arch: "fixture" },
  error: { message: "The audio service stopped unexpectedly." },
  logs: ["fixture: deterministic crash report preview"],
});

const PRESETS = [
  { id: "broadcast", name: "Broadcast Dialogue" },
  { id: "music", name: "Music Mastering" },
  { id: "stream", name: "Live Stream" },
];

function ThemePreviewFixture({ onDone }) {
  useUiSurface({
    kind: "confirmation",
    origin: "nested",
    blocking: false,
    dismissible: true,
    supportedActions: ["cancel"],
    target: { phase: "themePreviewFixture" },
    onCancel: onDone,
  });
  return <ThemePreview draft={getBuiltinThemeV2("plvs-dark")} onClose={onDone} />;
}

function PresetsFixture({ onDone }) {
  useUiSurface({
    kind: "confirmation",
    origin: "nested",
    blocking: false,
    dismissible: true,
    supportedActions: ["cancel"],
    target: { phase: "presetsFixture" },
    onCancel: onDone,
  });
  const presets = {
    list: PRESETS,
    activeId: "broadcast",
    dirty: false,
    blocked: false,
    save: () => false,
    apply: () => {},
    update: () => false,
    rename: () => false,
    remove: () => false,
    reorder: () => false,
  };
  return (
    <Popover open onOpenChange={(open) => !open && onDone()}>
      <PopoverAnchor asChild>
        <span className="fixed top-4 right-4 size-px" />
      </PopoverAnchor>
      <PopoverContent align="end" sideOffset={6} className="max-w-[92vw] p-0">
        <PresetsPopoverContent presets={presets} />
      </PopoverContent>
    </Popover>
  );
}

export default function UiVisualFixture({ name }) {
  const [step, setStep] = useState(0);
  if (name !== "review-sequence") return null;
  const next = () => setStep((current) => current + 1);
  if (step === 0) return <ThemePreviewFixture onDone={next} />;
  if (step === 1) {
    return <CloseConfirmDialog open onConfirm={() => {}} onRetry={() => {}} onCancel={next} />;
  }
  if (step === 2) {
    return (
      <UpdateDialog
        open
        currentVersion="0.18.2"
        releaseNotes={
          "### Visual review fixture\n\n- Safer UI navigation\n- Deterministic screenshots"
        }
        installStatus="idle"
        onConfirm={() => {}}
        onCancel={next}
        onRestart={() => {}}
        openExternalUrl={() => {}}
      />
    );
  }
  if (step === 3) {
    return (
      <CrashReportDialog
        report={CRASH_REPORT}
        onClose={next}
        onDisableAsking={async () => {}}
        onDiscard={async () => {}}
        submit={async () => {}}
      />
    );
  }
  if (step === 4) return <PresetsFixture onDone={next} />;
  return null;
}
