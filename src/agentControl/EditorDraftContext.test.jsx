/** @vitest-environment jsdom */
import { StrictMode, useRef } from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  EditorDraftProvider,
  useEditorDraftRegistry,
  useEditorDraftDecision,
  useEditorDraftSurface,
} from "./EditorDraftContext.jsx";

function wrapper({ children }) {
  return <EditorDraftProvider>{children}</EditorDraftProvider>;
}

function strictWrapper({ children }) {
  return (
    <StrictMode>
      <EditorDraftProvider>{children}</EditorDraftProvider>
    </StrictMode>
  );
}

describe("EditorDraftProvider", () => {
  it("binds inspection and mutation to an exact kind and surface lifetime", () => {
    const document = { name: "Before" };
    const { result, rerender } = renderHook(
      ({ active, surfaceId }) => {
        const registry = useEditorDraftRegistry();
        const controllerRef = useRef({
          inspectDraft: () => ({ document, draftGeneration: 0 }),
          commitDraftDocument: (next) => Object.assign(document, next),
        });
        useEditorDraftSurface({
          active,
          kind: "theme",
          surfaceId,
          controller: controllerRef.current,
        });
        return registry;
      },
      { wrapper, initialProps: { active: true, surfaceId: "surface-one" } }
    );

    expect(result.current.inspect("theme", "surface-one")).toMatchObject({
      document: { name: "Before" },
    });
    expect(() => result.current.inspect("loudnessProfile", "surface-one")).toThrowError(
      expect.objectContaining({ code: "editorDraftKindMismatch" })
    );

    act(() => result.current.commit("theme", "surface-one", { name: "After" }));
    expect(document.name).toBe("After");

    rerender({ active: false, surfaceId: "surface-one" });
    expect(() => result.current.inspect("theme", "surface-one")).toThrowError(
      expect.objectContaining({ code: "editorDraftNotFound" })
    );
    rerender({ active: true, surfaceId: "surface-two" });
    expect(() => result.current.inspect("theme", "surface-one")).toThrowError(
      expect.objectContaining({ code: "editorDraftNotFound" })
    );
    expect(result.current.inspect("theme", "surface-two")).toBeTruthy();
  });

  it("keeps the live StrictMode registration when an obsolete cleanup runs", () => {
    const { result } = renderHook(
      () => {
        const registry = useEditorDraftRegistry();
        useEditorDraftSurface({
          active: true,
          kind: "theme",
          surfaceId: "strict-surface",
          controller: {
            inspectDraft: () => ({ document: { name: "Live" }, draftGeneration: 0 }),
          },
        });
        return registry;
      },
      { wrapper: strictWrapper }
    );

    expect(result.current.inspect("theme", "strict-surface").document.name).toBe("Live");
  });

  it("invokes only the exact linked discard decision at the expected draft generation", () => {
    let discarded = 0;
    const { result } = renderHook(
      () => {
        const registry = useEditorDraftRegistry();
        useEditorDraftSurface({
          active: true,
          kind: "theme",
          surfaceId: "editor-surface",
          controller: {
            inspectDraft: () => ({
              document: { name: "Dirty" },
              draftGeneration: 3,
              dirty: true,
            }),
          },
        });
        useEditorDraftDecision({
          active: true,
          decisionSurfaceId: "decision-surface",
          editorKind: "theme",
          editorSurfaceId: "editor-surface",
          onDiscard: () => {
            discarded += 1;
          },
        });
        return registry;
      },
      { wrapper }
    );

    expect(() =>
      result.current.discard("theme", "editor-surface", "another-decision", 3)
    ).toThrowError(expect.objectContaining({ code: "draftDecisionNotFound" }));
    expect(() =>
      result.current.discard("theme", "editor-surface", "decision-surface", 2)
    ).toThrowError(expect.objectContaining({ code: "draftGenerationConflict" }));
    expect(discarded).toBe(0);

    act(() => result.current.discard("theme", "editor-surface", "decision-surface", 3));
    expect(discarded).toBe(1);
  });

  it("routes history only through actions owned by the exact mounted editor", () => {
    let undos = 0;
    const { result } = renderHook(
      () => {
        const registry = useEditorDraftRegistry();
        useEditorDraftSurface({
          active: true,
          kind: "theme",
          surfaceId: "history-surface",
          controller: {
            inspectDraft: () => ({ draftGeneration: 1, canUndo: true, canRedo: false }),
            undo: () => {
              undos += 1;
            },
          },
        });
        return registry;
      },
      { wrapper }
    );

    act(() => result.current.history("theme", "history-surface", "undo"));
    expect(undos).toBe(1);
    expect(() => result.current.history("theme", "history-surface", "redo")).toThrowError(
      expect.objectContaining({ code: "draftActionUnavailable" })
    );
  });
});

it("saves only the exact registered generation and rejects a closed, replaced, or wrong-kind editor", () => {
  const saveForControl = vi.fn(() => ({ savedId: "saved" }));
  const { result, rerender } = renderHook(
    ({ active }) => {
      const registry = useEditorDraftRegistry();
      useEditorDraftSurface({
        active,
        kind: "theme",
        surfaceId: "editor-one",
        controller: {
          inspectDraft: () => ({ draftGeneration: 7, stale: false }),
          saveForControl,
        },
      });
      return registry;
    },
    { wrapper, initialProps: { active: true } }
  );
  expect(() => result.current.save("loudnessProfile", "editor-one", 7)).toThrowError(
    expect.objectContaining({ code: "editorDraftKindMismatch" })
  );
  expect(() => result.current.save("theme", "editor-one", 6)).toThrowError(
    expect.objectContaining({ code: "draftGenerationConflict" })
  );
  expect(() => result.current.save("theme", "replacement", 7)).toThrowError(
    expect.objectContaining({ code: "editorDraftNotFound" })
  );
  expect(saveForControl).not.toHaveBeenCalled();
  expect(result.current.save("theme", "editor-one", 7)).toEqual({ savedId: "saved" });
  rerender({ active: false });
  expect(() => result.current.save("theme", "editor-one", 7)).toThrowError(
    expect.objectContaining({ code: "editorDraftNotFound" })
  );
  expect(saveForControl).toHaveBeenCalledTimes(1);
});
