import { collaborationUrl } from "@/utils/collaborationUrl";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { Op, Sheet } from "@fortune-sheet/core";
import type { WorkbookInstance } from "@fortune-sheet/react";
import { sheetApi } from "@/api/sheets";
import { errorMessage } from "@/http";
import { useAuth } from "@/store/auth";
import {
  discardRecoveryWorkbook,
  listRecoveryCopies,
  markRecovery,
  recoveryPrefix,
  readRecoveryWorkbook,
  saveRecoveryWorkbook,
  type Operation,
  type RecoveryCopy,
  type SheetDraft,
} from "./recovery";
import { prepareWorkbook } from "./workbook";
import { refreshFormulaBar, sheetEditorActive } from "./formulaBar";

type Snapshot = {
  type: "snapshot";
  workbook: Sheet[];
  revision: number;
  epoch: number;
  savedAt: string;
  operationId?: string;
};
type Presence = { userId: string; editSessionId: string };
function sparseSnapshot(sheets: Sheet[]) {
  return prepareWorkbook(sheets);
}
function operationsBetween(previous: Sheet[], next: Sheet[]): Op[] | undefined {
  if (
    previous.length !== next.length ||
    previous.some(
      (sheet, index) =>
        sheet.id !== next[index].id ||
        sheet.row !== next[index].row ||
        sheet.column !== next[index].column,
    )
  )
    return;
  const operations: Op[] = [];
  for (let i = 0; i < next.length; i++) {
    const old = previous[i],
      fresh = next[i];
    if (!old.data || !fresh.data) return;
    for (let r = 0; r < fresh.data.length; r++)
      for (let c = 0; c < fresh.data[r].length; c++)
        if (
          JSON.stringify(old.data[r]?.[c] ?? null) !==
          JSON.stringify(fresh.data[r][c] ?? null)
        )
          operations.push({
            op: "replace",
            id: fresh.id!,
            path: ["data", r, c],
            value: fresh.data[r][c] ?? null,
          });
    const oldRecord = old as unknown as Record<string, unknown>,
      newRecord = fresh as unknown as Record<string, unknown>;
    for (const key of new Set([
      ...Object.keys(oldRecord),
      ...Object.keys(newRecord),
    ])) {
      if (
        [
          "data",
          "celldata",
          "id",
          "status",
          "luckysheet_select_save",
          "luckysheet_selection_range",
        ].includes(key)
      )
        continue;
      if (JSON.stringify(oldRecord[key]) !== JSON.stringify(newRecord[key]))
        operations.push(
          newRecord[key] === undefined
            ? { op: "remove", id: fresh.id!, path: [key] }
            : {
                op: "replace",
                id: fresh.id!,
                path: [key],
                value: newRecord[key],
              },
        );
    }
  }
  return operations;
}

/** Fortune负责交互；服务端快照和ACK是唯一保存依据，本机只留未确认恢复副本。 */
export function useSheetCollaboration(
  fileId: string,
  api: RefObject<WorkbookInstance | null>,
  spaceId: string,
  surface: RefObject<HTMLDivElement | null>,
) {
  const selectedCell = useRef<{
    sheetId: string;
    row: number;
    column: number;
  }>();
  const userId = useAuth((state) => state.user?.id ?? "");
  const editKey = `minmd-sheet-editor:${userId}:${fileId}`;
  const editSession = useRef(
    sessionStorage.getItem(editKey) ?? crypto.randomUUID(),
  );
  const legacyKey = `${editKey}:${editSession.current}-draft`;
  const prefix = recoveryPrefix(userId, spaceId, fileId, editSession.current);
  const initialCopies = useRef(listRecoveryCopies(prefix, legacyKey));
  const initialActive = initialCopies.current.find(
    (copy) => !copy.draft.recovery && copy.draft.pending.length,
  );
  const activeBackup = useRef(initialActive?.key);
  const queue = useRef<Operation[]>(initialActive?.draft.pending ?? []);
  const draftRecovery = useRef(false);
  const socket = useRef<WebSocket | null>(null),
    latest = useRef<Snapshot>(),
    authoritative = useRef<Sheet[]>([]),
    live = useRef<Sheet[]>([]),
    inFlight = useRef(false),
    applying = useRef(false),
    readyRef = useRef(false),
    frame = useRef<number>(),
    applyTimer = useRef<ReturnType<typeof setTimeout>>();
  const [data, setData] = useState<Sheet[]>(),
    [generation, setGeneration] = useState(0),
    [revision, setRevision] = useState(0),
    [epoch, setEpoch] = useState(1),
    [state, setState] = useState<
      "connecting" | "saved" | "saving" | "disconnected" | "error"
    >("connecting"),
    [connected, setConnected] = useState(false),
    [pendingCount, setPendingCount] = useState(queue.current.length),
    [notice, setNotice] = useState(""),
    [members, setMembers] = useState({ count: 0, limit: 10 }),
    [hasRecovery, setHasRecovery] = useState(initialCopies.current.length > 0),
    [recoveryCopies, setRecoveryCopies] = useState<RecoveryCopy[]>(
      initialCopies.current,
    ),
    [retry, setRetry] = useState(0);
  const refreshRecovery = () => {
    const copies = listRecoveryCopies(prefix, legacyKey);
    setRecoveryCopies(copies);
    setHasRecovery(copies.length > 0);
  };
  const backup = useCallback(
    (recovery = draftRecovery.current) => {
      try {
        if (!queue.current.length) {
          if (activeBackup.current && !recovery) {
            localStorage.removeItem(activeBackup.current);
            void discardRecoveryWorkbook(activeBackup.current).catch(() =>
              setNotice("已确认的恢复缓存清理失败"),
            );
          }
          activeBackup.current = undefined;
          refreshRecovery();
          return;
        }
        const draftEpoch = queue.current[0].epoch;
        const existing =
          activeBackup.current &&
          listRecoveryCopies(prefix, legacyKey).find(
            (copy) => copy.key === activeBackup.current,
          );
        const key =
          existing &&
          existing.draft.epoch === draftEpoch &&
          (!existing.draft.recovery || recovery)
            ? existing.key
            : `${prefix}${draftEpoch}:${crypto.randomUUID()}`;
        activeBackup.current = key;
        localStorage.setItem(
          key,
          JSON.stringify({
            epoch: draftEpoch,
            pending: queue.current,
            recovery,
          } satisfies SheetDraft),
        );
        const sheets = api.current?.getAllSheets() ?? live.current;
        if (sheets.length)
          void saveRecoveryWorkbook(key, sheets).catch(() =>
            setNotice("本机恢复副本保存失败，请下载当前表格后重试"),
          );
        refreshRecovery();
      } catch {
        setNotice("本机存储空间不足，请下载当前表格保留未确认修改");
      }
    },
    [api, prefix, legacyKey],
  );
  const backupRef = useRef(backup);
  const renderedRevision = useRef<{ revision: number; epoch: number }>();
  backupRef.current = backup;
  const syncPending = () => {
    setPendingCount(queue.current.length);
    backupRef.current();
  };
  const applySnapshot = useCallback(
    (snapshot: Snapshot) => {
      if (
        latest.current &&
        (snapshot.epoch < latest.current.epoch ||
          (snapshot.epoch === latest.current.epoch &&
            snapshot.revision < latest.current.revision))
      )
        return;
      if (queue.current.length && authoritative.current.length) return;
      if (surface.current && sheetEditorActive(surface.current)) {
        clearTimeout(applyTimer.current);
        applyTimer.current = setTimeout(() => applySnapshot(snapshot), 100);
        return;
      }
      const operations =
        authoritative.current.length && api.current
          ? operationsBetween(authoritative.current, snapshot.workbook)
          : undefined;
      clearTimeout(applyTimer.current);
      applying.current = true;
      if (operations && api.current) {
        for (let index = 0; index < operations.length; index += 1000)
          api.current.applyOp(operations.slice(index, index + 1000));
      } else {
        setData(sparseSnapshot(snapshot.workbook));
        setGeneration((current) => current + 1);
      }
      authoritative.current = structuredClone(snapshot.workbook);
      renderedRevision.current = {
        revision: snapshot.revision,
        epoch: snapshot.epoch,
      };
      live.current = snapshot.workbook;
      cancelAnimationFrame(frame.current ?? 0);
      frame.current = requestAnimationFrame(() => {
        const root = surface.current;
        const input = root?.querySelector<HTMLElement>(".fortune-fx-input");
        if (root && input && api.current && !sheetEditorActive(root)) {
          const sheet = api.current.getSheet();
          const selection = api.current.getSelection()?.[0];
          const selected = selectedCell.current;
          const row =
            selected && selected.sheetId === sheet.id
              ? selected.row
              : selection?.row[0];
          const column =
            selected && selected.sheetId === sheet.id
              ? selected.column
              : selection?.column[0];
          if (row !== undefined && column !== undefined) {
            const cell = api.current.getCellsByRange({
              row: [row, row],
              column: [column, column],
            })[0]?.[0];
            refreshFormulaBar(input, cell, false);
          }
        }
        applying.current = false;
      });
    },
    [api, surface],
  );
  const applyRef = useRef(applySnapshot);
  applyRef.current = applySnapshot;
  const pump = useCallback(() => {
    if (
      !readyRef.current ||
      inFlight.current ||
      !queue.current.length ||
      socket.current?.readyState !== WebSocket.OPEN ||
      draftRecovery.current
    )
      return;
    inFlight.current = true;
    socket.current.send(JSON.stringify(queue.current[0]));
  }, []);

  useEffect(() => {
    let cancelled = false,
      reconnect: ReturnType<typeof setTimeout> | undefined,
      heartbeat: ReturnType<typeof setInterval> | undefined,
      attempt = 0,
      occupied = false;
    const nonce = crypto.randomUUID();
    const channel =
      typeof BroadcastChannel === "undefined"
        ? undefined
        : new BroadcastChannel("minmd-sheet-editors");
    channel?.addEventListener("message", (event: MessageEvent<unknown>) => {
      const value = event.data;
      if (
        !value ||
        typeof value !== "object" ||
        !("id" in value) ||
        value.id !== editSession.current
      )
        return;
      if (
        "type" in value &&
        value.type === "claim" &&
        "nonce" in value &&
        value.nonce !== nonce
      )
        channel.postMessage({
          type: "occupied",
          id: editSession.current,
          target: value.nonce,
        });
      if (
        "type" in value &&
        value.type === "occupied" &&
        "target" in value &&
        value.target === nonce
      )
        occupied = true;
    });
    const recoverEpoch = () => {
      authoritative.current = [];
      if (queue.current.length) {
        if (activeBackup.current) markRecovery(activeBackup.current);
        activeBackup.current = undefined;
        queue.current = [];
        draftRecovery.current = false;
        syncPending();
      }
    };
    const open = async () => {
      if (cancelled) return;
      readyRef.current = false;
      setConnected(false);
      setState("connecting");
      try {
        const ticket = await sheetApi.ticket(fileId, editSession.current);
        if (cancelled) return;
        setMembers((current) => ({ ...current, limit: ticket.maxSessions }));
        const ws = new WebSocket(collaborationUrl(ticket.url));
        socket.current = ws;
        ws.onopen = () =>
          ws.send(
            JSON.stringify({
              type: "auth",
              ticket: ticket.ticket,
              schemaVersion: 1,
              protocolVersion: 1,
            }),
          );
        ws.onmessage = (event: MessageEvent<string>) => {
          if (cancelled || socket.current !== ws) return;
          let packet: Record<string, unknown>;
          try {
            packet = JSON.parse(event.data) as Record<string, unknown>;
          } catch {
            ws.close();
            return;
          }
          if (packet.type === "snapshot") {
            const incoming = packet as unknown as Snapshot;
            if (
              !Array.isArray(incoming.workbook) ||
              !Number.isInteger(incoming.revision) ||
              !Number.isInteger(incoming.epoch)
            ) {
              ws.close();
              return;
            }
            if (queue.current.some((entry) => entry.epoch !== incoming.epoch))
              recoverEpoch();
            latest.current = incoming;
            setRevision(incoming.revision);
            setEpoch(incoming.epoch);
            readyRef.current = true;
            setConnected(true);
            attempt = 0;
            if (draftRecovery.current)
              setNotice(
                "版本或权限已变化，未确认修改保留为恢复副本，未重放到当前表格",
              );
            else setNotice("");
            if (!queue.current.length) {
              applyRef.current(incoming);
              setState("saved");
            } else {
              setState("saving");
              pump();
            }
          } else if (packet.type === "ack") {
            const index = queue.current.findIndex(
              (entry) => entry.operationId === packet.operationId,
            );
            if (index >= 0) queue.current.splice(index, 1);
            inFlight.current = false;
            syncPending();
            if (!queue.current.length) {
              if (latest.current) applyRef.current(latest.current);
              setState("saved");
              refreshRecovery();
            } else {
              setState("saving");
              pump();
            }
          } else if (packet.type === "members") {
            setMembers({
              count: Number(packet.count),
              limit: Number(packet.limit),
            });
            const identities = Array.isArray(packet.members)
              ? (packet.members as Presence[])
              : [];
            const current = api.current;
            for (const previous of presences.current)
              if (
                !identities.some((member) => member.editSessionId === previous)
              )
                current?.removePresences([
                  { userId: previous, username: "编辑者" },
                ]);
            presences.current = identities
              .map((member) => member.editSessionId)
              .filter((member) => member !== editSession.current);
          } else if (
            packet.type === "presence" &&
            packet.editSessionId !== editSession.current
          ) {
            const selection = packet.selection as {
              sheetId?: string;
              row?: number;
              column?: number;
            };
            if (selection?.sheetId && typeof packet.editSessionId === "string")
              api.current?.addPresences([
                {
                  userId: packet.editSessionId,
                  username: `编辑者 ${String(packet.userId).slice(0, 4)}`,
                  color: "#168b78",
                  selection: {
                    r: Number(selection.row),
                    c: Number(selection.column),
                  },
                  sheetId: selection.sheetId,
                },
              ]);
          } else if (packet.type === "epoch") {
            recoverEpoch();
            setNotice("表格版本已切换，正在加载新版本…");
          } else if (packet.type === "error") {
            setNotice(
              typeof packet.message === "string"
                ? packet.message
                : "协作请求失败",
            );
            setState("error");
            inFlight.current = false;
            if (
              [
                "REVISION_CONFLICT",
                "INVALID_OPERATION",
                "OPERATION_ID_CONFLICT",
                "EPOCH_CONFLICT",
                "MESSAGE_INVALID",
                "UNDO_WINDOW_EXPIRED",
                "CONTENT_TOO_LARGE",
                "MESSAGE_TOO_LARGE",
              ].includes(String(packet.code))
            ) {
              recoverEpoch();
              if (latest.current) applyRef.current(latest.current);
            }
            if (packet.code === "SAVE_FAILED") {
              backupRef.current();
              readyRef.current = false;
              setConnected(false);
              ws.close(4000, "等待保存重试");
            }
          }
        };
        ws.onclose = (event) => {
          if (cancelled || socket.current !== ws) return;
          readyRef.current = false;
          setConnected(false);
          inFlight.current = false;
          backupRef.current();
          clearInterval(heartbeat);
          setState("disconnected");
          if (event.code === 4008) {
            setNotice(
              `已达到 ${ticket.maxSessions} 个编辑会话上限，可只读查看，释放名额后重新连接`,
            );
            return;
          }
          if ([4006, 4007, 1009].includes(event.code)) {
            draftRecovery.current = true;
            backupRef.current(true);
            setHasRecovery(true);
            setNotice(
              event.code === 4007
                ? "协作消息发送过于频繁，未确认修改已保留为恢复副本，请稍后重新连接"
                : "协作消息超过字节上限，未确认修改已保留为恢复副本，请下载副本后重新载入",
            );
            return;
          }
          if (event.code === 4003) {
            setNotice("登录或文件权限已失效，未确认内容保留为本地副本");
            return;
          }
          if (event.code === 4009) recoverEpoch();
          setNotice(
            (current) =>
              current || "连接已断开，正在重新连接，未确认修改已留存",
          );
          reconnect = setTimeout(
            () => void open(),
            Math.min(500 * 2 ** attempt++, 5000),
          );
        };
        ws.onerror = () => {
          if (!cancelled) setNotice("协作连接暂不可用，正在重试");
        };
        heartbeat = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN && readyRef.current)
            ws.send(JSON.stringify({ type: "ping" }));
        }, 15_000);
      } catch (error) {
        if (cancelled) return;
        setState("disconnected");
        setNotice(errorMessage(error));
        reconnect = setTimeout(
          () => void open(),
          Math.min(500 * 2 ** attempt++, 5000),
        );
      }
    };
    void (async () => {
      channel?.postMessage({ type: "claim", id: editSession.current, nonce });
      await new Promise<void>((resolve) => setTimeout(resolve, 40));
      if (cancelled) return;
      if (occupied) {
        // 复制标签页不能删除原标签页的未确认副本，也不能继承它的操作队列。
        activeBackup.current = undefined;
        initialCopies.current = [];
        draftRecovery.current = false;
        setRecoveryCopies([]);
        setHasRecovery(false);
        editSession.current = crypto.randomUUID();
        queue.current = [];
        setPendingCount(0);
        setRetry((value) => value + 1);
        return;
      }
      sessionStorage.setItem(editKey, editSession.current);
      try {
        const content = await sheetApi.content(fileId);
        if (cancelled) return;
        if (
          draftRecovery.current ||
          queue.current.some((entry) => entry.epoch !== content.epoch)
        )
          recoverEpoch();
        latest.current = {
          type: "snapshot",
          workbook: content.projection.sheets,
          revision: content.revision,
          epoch: content.epoch,
          savedAt: content.savedAt,
        };
        setRevision(content.revision);
        setEpoch(content.epoch);
        applyRef.current(latest.current);
      } catch (error) {
        if (!cancelled) setNotice(errorMessage(error));
      }
      await open();
    })();
    return () => {
      cancelled = true;
      readyRef.current = false;
      backupRef.current();
      clearTimeout(reconnect);
      clearInterval(heartbeat);
      clearTimeout(applyTimer.current);
      cancelAnimationFrame(frame.current ?? 0);
      channel?.close();
      socket.current?.close();
      socket.current = null;
    };
    // 连接生命周期只随文件或显式重试变化，快照和编辑不能重建连接。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, userId, spaceId, retry]);
  const presences = useRef<string[]>([]);
  const onChange = useCallback((sheets: Sheet[]) => {
    live.current = sheets;
    if (queue.current.length && !applying.current) backupRef.current();
  }, []);
  const onOp = useCallback(
    (operations: Op[]) => {
      if (
        applying.current ||
        !readyRef.current ||
        !operations.length ||
        !latest.current
      )
        return;
      queue.current.push({
        type: "operations",
        operationId: crypto.randomUUID(),
        // 输入期间延迟应用远端快照，坐标仍属于实际渲染的修订。
        baseRevision:
          renderedRevision.current?.revision ?? latest.current.revision,
        epoch: renderedRevision.current?.epoch ?? latest.current.epoch,
        operations: structuredClone(operations),
      });
      setState("saving");
      syncPending();
      pump();
    },
    [pump],
  );
  const undo = useCallback(
    (redo = false) => {
      if (!readyRef.current || queue.current.length || !latest.current) return;
      queue.current.push({
        type: redo ? "redo" : "undo",
        baseRevision: latest.current.revision,
        operationId: crypto.randomUUID(),
        epoch: latest.current.epoch,
      });
      setState("saving");
      syncPending();
      pump();
    },
    [pump],
  );
  const checkpoint = useCallback(async () => {
    const deadline = Date.now() + 15_000;
    while (readyRef.current && queue.current.length && Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
    if (!readyRef.current || queue.current.length || !latest.current)
      throw Error("协作修改仍待同步，请连接恢复后保存");
    const saved = await sheetApi.checkpoint(
      fileId,
      latest.current.revision,
      latest.current.epoch,
    );
    setState("saved");
    return saved;
  }, [fileId]);
  const replace = useCallback(
    async (sheets: Sheet[]) => {
      if (!readyRef.current || queue.current.length || !latest.current)
        throw Error("请等待同步完成后导入");
      const replaced = await sheetApi.import(
        fileId,
        sheets,
        latest.current.revision,
        latest.current.epoch,
      );
      setRetry((value) => value + 1);
      return replaced;
    },
    [fileId],
  );
  const presence = useCallback(
    (sheetId: string, row: number, column: number) => {
      selectedCell.current = { sheetId, row, column };
      if (readyRef.current && socket.current?.readyState === WebSocket.OPEN)
        socket.current.send(
          JSON.stringify({
            type: "presence",
            selection: { sheetId, row, column },
          }),
        );
    },
    [],
  );
  const recovery = useCallback(
    async (key?: string) => {
      const copies = listRecoveryCopies(prefix, legacyKey);
      const selected =
        copies.find((copy) => copy.key === key) ??
        (!key ? copies[0] : undefined);
      return selected ? readRecoveryWorkbook(selected.key) : undefined;
    },
    [prefix, legacyKey],
  );
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (queue.current.length) {
        backupRef.current();
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);
  return {
    data,
    generation,
    revision,
    epoch,
    state,
    connected,
    editable: connected && !pendingCount,
    pendingCount,
    members,
    notice,
    hasRecovery,
    recoveryCopies,
    onChange,
    onOp,
    undo,
    checkpoint,
    replace,
    presence,
    recovery,
    reload: () => setRetry((value) => value + 1),
  };
}
