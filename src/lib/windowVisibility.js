export async function hideAppWindow({ docked, window, suspendDock }) {
  if (docked) {
    await suspendDock();
    return;
  }
  await window.hide();
  await window.setSkipTaskbar(true);
}

export async function toggleAppWindow({ docked, window, suspendDock, resumeDock }) {
  const visible = await window.isVisible();
  if (visible) await hideAppWindow({ docked, window, suspendDock });
  else await revealWindow({ docked, window, resumeDock }, visible);
}

async function revealWindow({ docked, window, resumeDock }, visible) {
  if (docked) {
    if (!visible) await resumeDock();
    return;
  }
  // Restore taskbar presence before showing a hidden window so a failed restore can be retried.
  await window.setSkipTaskbar(false);
  if (visible) await window.unminimize();
  else await window.show();
  await window.setFocus();
}

// Brings an already visible normal window forward and resumes a suspended Dock.
export async function showAppWindow(options) {
  await revealWindow(options, await options.window.isVisible());
}
