import React from "react";
import { recordFrontendCrash } from "../ipc/commands.js";
import { isTauri } from "../ipc/env.js";

function optionalString(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function normalizeRenderFailure(error, componentStack) {
  const object = error && typeof error === "object" ? error : null;
  return {
    name: optionalString(object?.name),
    message:
      optionalString(object?.message) ??
      (typeof error === "string" && error.length > 0 ? error : "Unknown render error"),
    stack: optionalString(object?.stack),
    componentStack: optionalString(componentStack),
  };
}

export class AppCrashBoundary extends React.Component {
  state = { failed: false };
  reported = false;

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    if (this.reported) return;
    this.reported = true;
    const input = normalizeRenderFailure(error, info?.componentStack);
    if (!isTauri()) {
      console.error("Fatal React render error", input);
      return;
    }
    Promise.resolve(recordFrontendCrash(input)).catch((reportError) => {
      console.error("Unable to save frontend crash report", reportError);
    });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const reload = this.props.reload ?? (() => window.location.reload());
    return (
      <main
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "32px",
          background: "#111318",
          color: "#f3f4f6",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <section style={{ maxWidth: "460px", textAlign: "center" }}>
          <h1 style={{ margin: "0 0 12px", fontSize: "24px" }}>PLVS Encountered an Error</h1>
          <p style={{ margin: "0 0 24px", color: "#b8bec9", lineHeight: 1.5 }}>
            The error was saved locally. You can decide whether to send the report after PLVS
            restarts.
          </p>
          <button
            type="button"
            onClick={reload}
            style={{
              border: "1px solid #5d6675",
              borderRadius: "6px",
              padding: "9px 18px",
              background: "#2b66d9",
              color: "white",
              font: "inherit",
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </section>
      </main>
    );
  }
}
