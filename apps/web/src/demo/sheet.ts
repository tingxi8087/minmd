import { useCallback, useRef, useState } from "react";
import type { useSheetCollaboration as ServerHook } from "@/views/Spreadsheet/useSheetCollaboration";
import type { Sheet } from "@fortune-sheet/core";
import { workbooks } from "./data";
import { createWorkbook, prepareWorkbook } from "@/views/Spreadsheet/workbook";
export function useSheetCollaboration(
  ...[fileId, api]: Parameters<typeof ServerHook>
): ReturnType<typeof ServerHook> {
  const [data, setData] = useState(() =>
    prepareWorkbook(
      structuredClone(
        workbooks.get(fileId) ?? createWorkbook(fileId, "工作表"),
      ),
    ),
  );
  const [generation, setGeneration] = useState(0);
  const undoStack = useRef<Sheet[][]>([]),
    redoStack = useRef<Sheet[][]>([]);
  const previous = useRef(structuredClone(data));
  const onChange = useCallback(
    (sheets: Sheet[]) => {
      if (JSON.stringify(sheets) === JSON.stringify(previous.current)) return;
      undoStack.current.push(previous.current);
      if (undoStack.current.length > 50) undoStack.current.shift();
      redoStack.current = [];
      previous.current = structuredClone(sheets);
      workbooks.set(fileId, structuredClone(sheets));
    },
    [fileId],
  );
  const apply = (sheets: Sheet[]) => {
    previous.current = structuredClone(sheets);
    workbooks.set(fileId, structuredClone(sheets));
    setData(prepareWorkbook(structuredClone(sheets)));
    setGeneration((value) => value + 1);
  };
  return {
    data,
    generation,
    revision: 1,
    epoch: 1,
    state: "saved",
    connected: true,
    editable: true,
    pendingCount: 0,
    members: { count: 1, limit: 1 },
    notice: "",
    hasRecovery: false,
    recoveryCopies: [],
    onChange,
    onOp: () => {},
    undo: (redo = false) => {
      const from = redo ? redoStack : undoStack,
        to = redo ? undoStack : redoStack;
      const next = from.current.pop();
      if (next) {
        to.current.push(structuredClone(previous.current));
        apply(next);
      }
    },
    checkpoint: async () => {
      if (api.current)
        workbooks.set(fileId, structuredClone(api.current.getAllSheets()));
      return {
        fileId,
        epoch: 1,
        revision: 1,
        savedAt: new Date().toISOString(),
      };
    },
    replace: async (sheets) => {
      apply(sheets);
      return {
        fileId,
        epoch: 1,
        revision: 1,
        savedAt: new Date().toISOString(),
      };
    },
    presence: () => {},
    recovery: async () => undefined,
    reload: () => apply(workbooks.get(fileId) ?? data),
  };
}
