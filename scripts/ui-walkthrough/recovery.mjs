import { classifyRestorationField } from "../ui-visual-walkthrough-lib.mjs";

function fileSessions(transport) {
  return transport.files?.sessions ?? transport.fileSessions ?? [];
}

function actionTokens(app, ui) {
  return [
    "--expected-revision",
    String(app.revision),
    "--expected-ui-generation",
    String(ui.uiGeneration),
    "--json",
  ];
}

function transportLifecycle(transport) {
  return {
    source: transport.source,
    liveState: transport.live?.state ?? null,
    activeId: transport.files?.activeId ?? null,
  };
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function summarizeRunJournal(journal) {
  const resources = [
    ...journal.suite.resources,
    ...journal.scenarios.flatMap((scenario) => scenario.resources),
  ];
  return {
    schemaVersion: journal.schemaVersion,
    runId: journal.runId,
    phase: journal.phase,
    instanceId: journal.workbench.instanceId,
    scenarios: journal.scenarios.map(({ id, phase }) => ({ id, phase })),
    outstanding: resources.filter(
      ({ status }) => !["restored", "alreadyRestored"].includes(status)
    ),
    failure: journal.failure,
  };
}

export async function recoverUiVisualWalkthrough({ journalStore, invoke, materialize }) {
  let journal = journalStore.current;
  if (["complete", "preserved"].includes(journal.phase)) return summarizeRunJournal(journal);
  const instanceId = journal.workbench.instanceId;
  const run = (args) => invoke([...args, "--instance", instanceId]);
  const capabilities = await run(["capabilities", "--json"]);
  if (
    journal.workbench.applicationIdentity &&
    capabilities.applicationIdentity &&
    capabilities.applicationIdentity !== journal.workbench.applicationIdentity
  ) {
    throw new Error("Recovery refused because the application identity changed.");
  }

  if (journal.phase !== "cleaning" && journal.phase !== "verifying") {
    await journalStore.transitionRun("cleaning");
  }
  const divergences = [];
  const scenarios = [...journal.scenarios].reverse();
  for (const scenario of scenarios) {
    const divergenceCount = divergences.length;
    let scenarioPhase = journalStore.current.scenarios.find(({ id }) => id === scenario.id).phase;
    if (scenarioPhase === "planned") {
      await journalStore.transitionScenario(scenario.id, "preparing");
      scenarioPhase = "preparing";
    }
    if (["preparing", "running"].includes(scenarioPhase)) {
      await journalStore.transitionScenario(scenario.id, "cleaning");
    }
    const fields = scenario.resources.filter(({ type }) => type === "field");
    for (const family of new Set(fields.map(({ family }) => family))) {
      const inspected = await run([family, "inspect", "--json"]);
      const state = inspected[family] ?? inspected;
      const patch = {};
      for (const field of fields.filter((candidate) => candidate.family === family)) {
        const classification = classifyRestorationField(field, state[field.key]);
        if (classification === "owned") patch[field.key] = field.before;
        else if (classification === "diverged") {
          divergences.push(`${family}.${field.key}`);
        }
        await journalStore.update((draft) => {
          const resource = draft.scenarios
            .find(({ id }) => id === scenario.id)
            .resources.find(
              (candidate) =>
                candidate.type === "field" &&
                candidate.family === family &&
                candidate.key === field.key
            );
          resource.status = classification;
        });
      }
      if (Object.keys(patch).length > 0) {
        const path = await materialize(`recover-${scenario.id}-${family}`, patch);
        const update = async () => {
          const app = await run(["inspect", "--json"]);
          return run([
            family,
            "update",
            path,
            "--expected-revision",
            String(app.revision),
            "--json",
          ]);
        };
        try {
          await update();
        } catch (error) {
          if ((error.reason ?? error.code) !== "revisionConflict") throw error;
          const reinspected = await run([family, "inspect", "--json"]);
          const current = reinspected[family] ?? reinspected;
          const noLongerOwned = fields
            .filter(
              (candidate) => candidate.family === family && Object.hasOwn(patch, candidate.key)
            )
            .filter(
              (candidate) => classifyRestorationField(candidate, current[candidate.key]) !== "owned"
            );
          if (noLongerOwned.length > 0) {
            divergences.push(...noLongerOwned.map(({ key }) => `${family}.${key}`));
            continue;
          }
          await update();
        }
        await journalStore.update((draft) => {
          for (const resource of draft.scenarios
            .find(({ id }) => id === scenario.id)
            .resources.filter(
              (candidate) => candidate.type === "field" && candidate.family === family
            )) {
            if (Object.hasOwn(patch, resource.key)) resource.status = "restored";
          }
        });
      }
    }

    for (const resource of [...scenario.resources].reverse()) {
      if (!["draft", "surface", "eventFixture"].includes(resource.type)) continue;
      if (["restored", "alreadyRestored"].includes(resource.status)) continue;
      if (!resource.surfaceId) {
        divergences.push(`${resource.type}:${resource.kind}:missing-id`);
        continue;
      }
      let app = await run(["inspect", "--json"]);
      let ui = await run(["ui", "inspect", "--json"]);
      const surface = ui.surfaces.find(({ surfaceId }) => surfaceId === resource.surfaceId);
      if (!surface) {
        await journalStore.update((draft) => {
          const target = draft.scenarios
            .find(({ id }) => id === scenario.id)
            .resources.find(
              (candidate) =>
                candidate.type === resource.type && candidate.surfaceId === resource.surfaceId
            );
          target.status = "alreadyRestored";
        });
        continue;
      }
      if (resource.type === "draft") {
        const draft = await run([
          "editor-draft",
          "inspect",
          resource.kind,
          resource.surfaceId,
          "--json",
        ]);
        if (draft.draftGeneration !== resource.draftGeneration) {
          divergences.push(`draft:${resource.surfaceId}:generation`);
          continue;
        }
        let decision = resource.decisionSurfaceId
          ? ui.surfaces.find(({ surfaceId }) => surfaceId === resource.decisionSurfaceId)
          : null;
        if (!decision) {
          await run(["ui", "cancel", resource.surfaceId, ...actionTokens(app, ui)]);
          ui = await run(["ui", "inspect", "--json"]);
          decision = ui.surfaces.find(
            (candidate) =>
              candidate.target?.purpose === "discardDraft" &&
              candidate.target?.editorSurfaceId === resource.surfaceId
          );
        }
        if (!decision) {
          divergences.push(`draft:${resource.surfaceId}:decision`);
          continue;
        }
        await run([
          "editor-draft",
          "discard",
          resource.kind,
          resource.surfaceId,
          "--decision-surface-id",
          decision.surfaceId,
          "--expected-revision",
          String(app.revision),
          "--expected-ui-generation",
          String(ui.uiGeneration),
          "--expected-draft-generation",
          String(resource.draftGeneration),
          "--json",
        ]);
      } else if (resource.type === "eventFixture" && resource.dismiss === "reset") {
        if (!resource.fixtureId) {
          divergences.push(`eventFixture:${resource.surfaceId}:missing-fixture-id`);
          continue;
        }
        await run(["dev", "fixture", "reset", resource.fixtureId, ...actionTokens(app, ui)]);
      } else {
        await run(["ui", resource.dismiss, resource.surfaceId, ...actionTokens(app, ui)]);
      }
      await journalStore.update((draft) => {
        const target = draft.scenarios
          .find(({ id }) => id === scenario.id)
          .resources.find(
            (candidate) =>
              candidate.type === resource.type && candidate.surfaceId === resource.surfaceId
          );
        target.status = "restored";
      });
    }
    if (divergences.length === divergenceCount) {
      scenarioPhase = journalStore.current.scenarios.find(({ id }) => id === scenario.id).phase;
      if (scenarioPhase === "cleaning") {
        await journalStore.transitionScenario(scenario.id, "verifying");
        scenarioPhase = "verifying";
      }
      if (scenarioPhase === "verifying") {
        await journalStore.transitionScenario(scenario.id, "complete");
      }
    }
  }

  for (const resource of [...journal.suite.resources].reverse()) {
    if (
      resource.type !== "transportFile" ||
      ["restored", "alreadyRestored"].includes(resource.status)
    )
      continue;
    if (!resource.sessionId) {
      divergences.push("transportFile:missing-session-id");
      continue;
    }
    const transport = await run(["transport", "inspect", "--json"]);
    const lifecycle = transportLifecycle(transport);
    const lifecycleStatus = sameJson(lifecycle, resource.before)
      ? "alreadyRestored"
      : sameJson(lifecycle, resource.applied)
        ? "owned"
        : "diverged";
    if (lifecycleStatus === "diverged") {
      divergences.push("transport:lifecycle");
      continue;
    }
    if (!fileSessions(transport).some(({ id }) => id === resource.sessionId)) {
      await journalStore.update((draft) => {
        draft.suite.resources.find(({ sessionId }) => sessionId === resource.sessionId).status =
          "alreadyRestored";
      });
      continue;
    }
    const app = await run(["inspect", "--json"]);
    await run([
      "transport",
      "file",
      "remove",
      resource.sessionId,
      "--expected-revision",
      String(app.revision),
      "--json",
    ]);
    if (lifecycleStatus === "owned") {
      let app = await run(["inspect", "--json"]);
      if (resource.before.source === "live") {
        await run([
          "transport",
          "source",
          "live",
          "--expected-revision",
          String(app.revision),
          "--json",
        ]);
        if (resource.before.liveState === "running") {
          app = await run(["inspect", "--json"]);
          await run([
            "transport",
            "live",
            "start",
            "--expected-revision",
            String(app.revision),
            "--json",
          ]);
        }
      } else if (resource.before.activeId) {
        await run([
          "transport",
          "file",
          "select",
          resource.before.activeId,
          "--expected-revision",
          String(app.revision),
          "--json",
        ]);
      } else {
        await run([
          "transport",
          "source",
          "file",
          "--expected-revision",
          String(app.revision),
          "--json",
        ]);
      }
    }
    await journalStore.update((draft) => {
      draft.suite.resources.find(({ sessionId }) => sessionId === resource.sessionId).status =
        "restored";
    });
  }

  if (divergences.length > 0) {
    await journalStore.update((draft) => {
      draft.failure = { reason: "recoveryDiverged", resources: divergences };
    });
    await journalStore.transitionRun("preserved");
    const error = new Error(`Recovery preserved divergent resources: ${divergences.join(", ")}.`);
    error.summary = summarizeRunJournal(journalStore.current);
    throw error;
  }
  if (journalStore.current.phase === "cleaning") await journalStore.transitionRun("verifying");
  await journalStore.transitionRun("complete");
  return summarizeRunJournal(journalStore.current);
}
