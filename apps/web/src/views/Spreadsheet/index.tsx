import { useCallback, useEffect, useRef, useState } from "react";
import { App } from "antd";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  Download,
  Upload,
  Share2,
  Users,
  AlertCircle,
  LoaderCircle,
} from "lucide-react";
import { Workbook, type WorkbookInstance } from "@fortune-sheet/react";
import type { Op, Sheet } from "@fortune-sheet/core";
import "@fortune-sheet/react/dist/index.css";
import TooltipButton from "@/components/TooltipButton";
import FileIcon from "@/components/FileIcon";
import FileHeader from "@/components/FileHeader";
import FileDialogs, { type FileAction } from "@/components/FileDialogs";
import { type Entry, useWorkspace } from "@/store/workspace";
import { getSpreadsheet, saveSpreadsheet } from "@/utils/spreadsheetStorage";
import { createWorkbook, prepareWorkbook } from "./workbook";
import { importXlsx, exportXlsx } from "./exchange";
import styles from "./index.module.less";
const tools: Record<string, string[]> = {
  开始: [
    "undo",
    "redo",
    "format-painter",
    "clear-format",
    "|",
    "font",
    "font-size",
    "|",
    "bold",
    "italic",
    "strike-through",
    "underline",
    "font-color",
    "background",
    "border",
    "merge-cell",
    "|",
    "horizontal-align",
    "vertical-align",
    "text-wrap",
    "text-rotation",
    "|",
    "currency-format",
    "percentage-format",
    "number-decrease",
    "number-increase",
    "format",
  ],
  插入: ["link", "image", "comment", "|", "dataVerification", "splitColumn"],
  公式: ["quick-formula"],
  数据: [
    "filter",
    "conditionFormat",
    "dataVerification",
    "splitColumn",
    "locationCondition",
    "search",
  ],
  视图: ["freeze", "search", "screenshot"],
};
type Pending = { sequence: number; ops: Op[] };
export default function Spreadsheet({ file }: { file: Entry }) {
  const navigate = useNavigate(),
    { message } = App.useApp();
  const theme = useWorkspace((s) => s.theme);
  const api = useRef<WorkbookInstance>(null),
    input = useRef<HTMLInputElement>(null),
    live = useRef<Sheet[]>([]),
    socket = useRef<WebSocket | null>(null),
    revision = useRef(0),
    sender = useRef(""),
    sequence = useRef(0),
    pending = useRef<Pending[]>([]),
    sending = useRef(false),
    remote = useRef(false);
  const [data, setData] = useState<Sheet[]>(),
    [generation, setGeneration] = useState(0),
    [tab, setTab] = useState("开始"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [state, setState] = useState("loading"),
    [action, setAction] = useState<FileAction | null>(null),
    [collaborating, setCollaborating] = useState(false),
    [connected, setConnected] = useState(false),
    [members, setMembers] = useState({ count: 0, limit: 10 }),
    [notice, setNotice] = useState("");
  const collabRef = useRef(false);
  collabRef.current = collaborating;
  useEffect(() => {
    let cancelled = false;
    setCollaborating(false);
    setData(undefined);
    setError("");
    setState("loading");
    void getSpreadsheet(file.id)
      .then((saved) => {
        if (cancelled) return;
        const sheets =
          saved ||
          createWorkbook(file.id, file.name, file.id === "sheet-budget");
        live.current = sheets;
        setData(sheets);
        setState("saved");
      })
      .catch(() => setError("表格读取失败"));
    return () => {
      cancelled = true;
    };
  }, [file.id]);
  const save = useCallback(async () => {
    if (collabRef.current) {
      if (pending.current.length) throw Error("协作修改仍在同步，请稍后保存");
      if (socket.current?.readyState !== WebSocket.OPEN)
        throw Error("协作连接已断开");
    }
    setState("saving");
    await saveSpreadsheet(file.id, api.current?.getAllSheets() || live.current);
    useWorkspace
      .getState()
      .patch(file.id, { spreadsheet: { savedAt: new Date().toISOString() } });
    setState("saved");
  }, [file.id]);
  const saveRef = useRef(save);
  saveRef.current = save;
  const pump = () => {
    const ws = socket.current;
    if (
      !ws ||
      ws.readyState !== WebSocket.OPEN ||
      sending.current ||
      !pending.current.length
    )
      return;
    sending.current = true;
    const item = pending.current[0];
    ws.send(JSON.stringify({ type: "op", base: revision.current, ...item }));
  };
  useEffect(() => {
    if (!collaborating || !data) return;
    let cancelled = false;
    setConnected(false);
    setNotice("正在连接开发协作验证…");
    pending.current = [];
    sending.current = false;
    const ws = new WebSocket(
      `${import.meta.env.DEV ? import.meta.env.MINMD_SHEET_VERIFY_WS : `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}`}/api/experimental/sheets/${encodeURIComponent(file.id)}`,
    );
    socket.current = ws;
    const recover = () => {
      if (pending.current.length) {
        void saveSpreadsheet(
          `${file.id}-conflict`,
          api.current?.getAllSheets() || live.current,
        );
        pending.current = [];
        sending.current = false;
        setNotice("未确认修改已保留为本地副本，请下载后重新连接");
      }
    };
    ws.onopen = () =>
      ws.send(JSON.stringify({ type: "initialize", data: live.current }));
    ws.onmessage = (event) => {
      if (cancelled) return;
      const packet = JSON.parse(event.data);
      if (packet.typeConflict) {
        recover();
        live.current = packet.data;
        setData(prepareWorkbook(packet.data));
        revision.current = packet.revision;
        setGeneration((n) => n + 1);
        setNotice(packet.message);
        setState("saved");
        return;
      }
      if (packet.type === "snapshot") {
        live.current = packet.data;
        setData(prepareWorkbook(packet.data));
        revision.current = packet.revision;
        sender.current = packet.sender;
        setMembers({ count: packet.count, limit: packet.limit });
        setGeneration((n) => n + 1);
        setConnected(true);
        setNotice("");
        setState("saved");
      } else if (packet.type === "op") {
        const own = packet.sender === sender.current;
        remote.current = true;
        try {
          if (
            !own ||
            packet.ops.every(
              (op: Op) =>
                ["add", "replace", "remove"].includes(op.op) &&
                op.path[0] === "data" &&
                op.path.length >= 3,
            )
          )
            api.current?.applyOp(packet.ops);
        } finally {
          remote.current = false;
        }
        revision.current = packet.revision;
        if (own) {
          if (pending.current[0]?.sequence === packet.sequence)
            pending.current.shift();
          sending.current = false;
          setState(pending.current.length ? "saving" : "saved");
          pump();
        }
      } else if (packet.type === "members")
        setMembers({ count: packet.count, limit: packet.limit });
      else if (
        packet.type === "presence" &&
        packet.presence.userId !== sender.current
      )
        api.current?.addPresences([packet.presence]);
      else if (packet.type === "leave")
        api.current?.removePresences([
          {
            userId: packet.sender,
            username: `编辑者 ${packet.sender.slice(0, 4)}`,
          },
        ]);
      else if (packet.type === "full") {
        setMembers({ count: packet.limit, limit: packet.limit });
        setNotice(packet.message);
        setConnected(false);
      } else if (packet.type === "error") {
        recover();
        setNotice(packet.message);
        setConnected(false);
        ws.close();
      }
    };
    ws.onclose = () => {
      if (!cancelled) {
        setConnected(false);
        recover();
        setNotice(
          (current) => current || "协作连接已断开，重新连接后将加载服务器内容",
        );
      }
    };
    ws.onerror = () => {
      if (!cancelled) setNotice("协作验证连接失败，请检查后端验证开关");
    };
    return () => {
      cancelled = true;
      recover();
      ws.close();
      socket.current = null;
    };
    // 初始数据只在建立连接时提交，不能在每次编辑后重建会话。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collaborating, file.id]);
  useEffect(() => {
    if (!data || collaborating) return;
    const timer = setTimeout(
      () => void save().catch(() => setState("error")),
      400,
    );
    return () => clearTimeout(timer);
  }, [data, collaborating, save]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s")
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      (document.activeElement as HTMLElement)?.blur();
      requestAnimationFrame(
        () => void saveRef.current().catch((e) => message.warning(e.message)),
      );
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [message]);
  const changed = useCallback((sheets: Sheet[]) => {
    live.current = sheets;
    setData(sheets);
    if (!collabRef.current) setState("saving");
  }, []);
  const onOp = (ops: Op[]) => {
    if (remote.current || !collaborating || !connected || !ops.length) return;
    pending.current.push({ sequence: ++sequence.current, ops });
    setState("saving");
    pump();
  };
  const download = async (recovery = false) => {
    try {
      const sheets = recovery
        ? await getSpreadsheet(`${file.id}-conflict`)
        : api.current?.getAllSheets();
      if (!sheets) throw Error("没有可下载的内容");
      const blob = await exportXlsx(sheets, file.name),
        url = URL.createObjectURL(blob),
        anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${file.name}${recovery ? "-未确认修改" : ""}.xlsx`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "导出失败");
    }
  };
  const imported = async (binary?: File) => {
    if (!binary || collaborating) return;
    setBusy(true);
    try {
      const sheets = await importXlsx(binary, file.id, file.name);
      await saveSpreadsheet(file.id, sheets);
      live.current = sheets;
      setData(sheets);
      setGeneration((n) => n + 1);
      message.success("已导入基础数据、公式和样式；图表等高级对象不支持");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "导入失败");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <main className={styles.page} data-theme={theme}>
      <FileHeader className={styles.header}>
        <TooltipButton
          className="icon-button"
          aria-label="返回空间"
          onClick={() => navigate("/files")}
        >
          <ArrowLeft size={17} />
        </TooltipButton>
        <FileIcon kind="sheet" small />
        <strong>{file.name}</strong>
        <div className={styles.actions}>
          <TooltipButton
            className="icon-button"
            aria-label={state === "saved" ? "保存表格" : "正在同步表格"}
            onClick={() => void save().catch((e) => message.warning(e.message))}
          >
            {state === "saved" ? (
              <Check size={16} />
            ) : state === "error" ? (
              <AlertCircle size={16} />
            ) : (
              <LoaderCircle size={16} />
            )}
          </TooltipButton>
          {import.meta.env.DEV && (
            <button
              className="secondary-button"
              aria-label="开发协作验证"
              disabled={!data}
              onClick={() => {
                setCollaborating((v) => !v);
                setNotice("");
              }}
            >
              <Users size={15} />
              {collaborating ? `${members.count}/${members.limit}` : "协作验证"}
            </button>
          )}
          <TooltipButton
            className="icon-button"
            aria-label="导入 XLSX 到当前表格"
            disabled={busy || collaborating || !data}
            onClick={() => input.current?.click()}
          >
            <Upload size={16} />
          </TooltipButton>
          <TooltipButton
            className="icon-button"
            aria-label="导出 XLSX"
            disabled={!data}
            onClick={() => void download()}
          >
            <Download size={16} />
          </TooltipButton>
          <button
            className="secondary-button"
            onClick={() => setAction({ type: "share", file })}
          >
            <Share2 size={15} />
            分享
          </button>
        </div>
      </FileHeader>
      <input
        ref={input}
        type="file"
        accept=".xlsx"
        hidden
        onChange={(e) => void imported(e.target.files?.[0])}
      />
      {collaborating && (
        <div className={styles.collaboration}>
          <span>{notice || "开发协作验证 · 演示身份"}</span>
          {!connected && (
            <>
              <button
                onClick={() => {
                  setCollaborating(false);
                  setTimeout(() => setCollaborating(true), 0);
                }}
              >
                重新连接
              </button>
              <button onClick={() => void download(true)}>下载本地副本</button>
            </>
          )}
        </div>
      )}
      <div className={styles.tabs} role="tablist">
        {Object.keys(tools).map((name) => (
          <button
            key={name}
            role="tab"
            aria-selected={name === tab}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </div>
      <div className={styles.editor} aria-label="表格编辑器">
        {data && (
          <Workbook
            key={`${file.id}-${generation}`}
            ref={api}
            data={data}
            lang="zh"
            forceCalculation={true}
            allowEdit={!collaborating || connected}
            toolbarItems={tools[tab]}
            onChange={changed}
            onOp={onOp}
            hooks={{
              afterSelectionChange: (sheetId, selection) => {
                const ws = socket.current;
                if (collaborating && ws?.readyState === WebSocket.OPEN)
                  ws.send(
                    JSON.stringify({
                      type: "presence",
                      sheetId,
                      r: selection.row[0],
                      c: selection.column[0],
                    }),
                  );
              },
            }}
          />
        )}
      </div>
      {(!data || busy || error) && (
        <div className={styles.status}>
          {error || (busy ? "正在处理 Excel…" : "正在打开表格…")}
        </div>
      )}
      <FileDialogs action={action} close={() => setAction(null)} />
    </main>
  );
}
