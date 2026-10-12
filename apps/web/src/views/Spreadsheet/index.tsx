import { useCallback, useEffect, useRef, useState } from "react";
import { App } from "antd";
import { useNavigate, useBlocker } from "react-router-dom";
import { useAuth } from "@/store/auth";
import {
  ArrowLeft,
  Check,
  Download,
  Upload,
  Share2,
  Users,
  AlertCircle,
  LoaderCircle,
  Undo2,
  Redo2,
  History,
} from "lucide-react";
import { Workbook, type WorkbookInstance } from "@fortune-sheet/react";
import "@fortune-sheet/react/dist/index.css";
import TooltipButton from "@/components/TooltipButton";
import FileIcon from "@/components/FileIcon";
import FileHeader from "@/components/FileHeader";
import FileDialogs, { type FileAction } from "@/components/FileDialogs";
import { type Entry, useWorkspace } from "@/store/workspace";
import { importXlsx, exportXlsx } from "./exchange";
import { useSheetCollaboration } from "./useSheetCollaboration";
import SheetHistory from "./SheetHistory";
import { shouldWarnSheetLeave } from "./recovery";
import styles from "./index.module.less";
const tools: Record<string, string[]> = {
  开始: [
    "server-undo",
    "server-redo",
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
export default function Spreadsheet({ file }: { file: Entry }) {
  const navigate = useNavigate(),
    { message, modal } = App.useApp();
  const theme = useWorkspace((state) => state.theme);
  const api = useRef<WorkbookInstance>(null),
    input = useRef<HTMLInputElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const collaboration = useSheetCollaboration(
    file.id,
    api,
    file.space,
    surface,
  );
  const [tab, setTab] = useState("开始"),
    [busy, setBusy] = useState(false),
    [action, setAction] = useState<FileAction | null>(null),
    [history, setHistory] = useState(false);
  const blocker = useBlocker(({ nextLocation }) =>
    shouldWarnSheetLeave(
      Boolean(useAuth.getState().user),
      collaboration.pendingCount,
      nextLocation.pathname,
    ),
  );
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    const dialog = modal.confirm({
      title: "表格修改尚未确认保存",
      content:
        "未确认修改的恢复副本已保留在此浏览器。离开后可重新打开并下载检查。",
      okText: "离开",
      cancelText: "继续编辑",
      onOk: () => blocker.proceed(),
      onCancel: () => blocker.reset(),
    });
    return () => dialog.destroy();
  }, [blocker.state]);
  const save = useCallback(async () => {
    const editor = document.activeElement;
    if (
      editor instanceof HTMLElement &&
      editor.matches(".luckysheet-cell-input, .fortune-fx-input")
    ) {
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          bubbles: true,
        }),
      );
      editor.blur();
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    }
    await collaboration.checkpoint();
    message.success("已保存到服务器");
  }, [collaboration, message]);
  const saveRef = useRef(save),
    undoRef = useRef(collaboration.undo);
  saveRef.current = save;
  undoRef.current = collaboration.undo;
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (!["s", "z", "y"].includes(key)) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest(".ant-modal, .ant-drawer")
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      if (key === "s") {
        void saveRef
          .current()
          .catch((error: unknown) =>
            message.warning(
              error instanceof Error ? error.message : "保存失败",
            ),
          );
      } else undoRef.current(key === "y" || event.shiftKey);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [message]);
  const download = async (recovery = false, recoveryKey?: string) => {
    try {
      const sheets = recovery
        ? await collaboration.recovery(recoveryKey)
        : api.current?.getAllSheets();
      if (!sheets) throw Error("没有可下载的内容");
      const blob = await exportXlsx(sheets, file.name),
        url = URL.createObjectURL(blob),
        anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${file.name}${recovery ? "-未确认修改" : ""}.xlsx`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "导出失败");
    }
  };
  const imported = async (binary?: File) => {
    if (!binary || !collaboration.editable) return;
    const confirmed = await new Promise<boolean>((resolve) =>
      modal.confirm({
        title: "替换当前表格？",
        content: "当前内容会保存为历史版本，在线编辑者将重新载入新版本。",
        okText: "导入并替换",
        cancelText: "取消",
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      }),
    );
    if (!confirmed) {
      if (input.current) input.current.value = "";
      return;
    }
    setBusy(true);
    try {
      const sheets = await importXlsx(binary, file.id, file.name);
      await collaboration.replace(sheets);
      message.success("已导入并保存到服务器；图表等高级对象不支持");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "导入失败");
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
            aria-label={
              collaboration.state === "saved" ? "保存表格" : "表格同步状态"
            }
            disabled={!collaboration.editable}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() =>
              void save().catch((error: unknown) =>
                message.warning(
                  error instanceof Error ? error.message : "保存失败",
                ),
              )
            }
          >
            {collaboration.state === "saved" ? (
              <Check size={16} />
            ) : ["error", "disconnected"].includes(collaboration.state) ? (
              <AlertCircle size={16} />
            ) : (
              <LoaderCircle size={16} />
            )}
          </TooltipButton>
          <span
            className={styles.members}
            aria-label={`在线编辑 ${collaboration.members.count}，上限 ${collaboration.members.limit}`}
          >
            <Users size={15} />
            {collaboration.members.count}/{collaboration.members.limit}
          </span>
          <TooltipButton
            className="icon-button"
            aria-label="表格版本历史"
            onClick={() => setHistory(true)}
          >
            <History size={16} />
          </TooltipButton>
          <TooltipButton
            className="icon-button"
            aria-label="导入 XLSX 到当前表格"
            disabled={busy || !collaboration.editable}
            onClick={() => input.current?.click()}
          >
            <Upload size={16} />
          </TooltipButton>
          <TooltipButton
            className="icon-button"
            aria-label="导出 XLSX"
            disabled={!collaboration.data}
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
        onChange={(event) => void imported(event.target.files?.[0])}
      />
      {(collaboration.notice ||
        collaboration.hasRecovery ||
        collaboration.state !== "saved") && (
        <div className={styles.collaboration} role="status">
          <span>
            {collaboration.notice ||
              (collaboration.state === "connecting"
                ? "正在连接…"
                : collaboration.pendingCount
                  ? "修改待同步"
                  : collaboration.state === "saved"
                    ? "本地恢复副本已保留"
                    : "连接已断开")}
          </span>
          {!collaboration.connected && (
            <button onClick={collaboration.reload}>重新连接</button>
          )}
          {collaboration.hasRecovery && (
            <span>
              {collaboration.recoveryCopies.map((copy) => (
                <button
                  key={copy.key}
                  onClick={() => void download(true, copy.key)}
                >
                  下载恢复副本 · epoch {copy.draft.epoch}
                </button>
              ))}
            </span>
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
      <div ref={surface} className={styles.editor} aria-label="表格编辑器">
        {collaboration.data && (
          <Workbook
            key={`${file.id}-${collaboration.generation}`}
            ref={api}
            data={collaboration.data}
            lang="zh"
            forceCalculation={false}
            allowEdit={collaboration.editable && !busy}
            toolbarItems={tools[tab]}
            customToolbarItems={[
              {
                key: "server-undo",
                tooltip: "撤销本人的修改",
                icon: <Undo2 size={16} />,
                onClick: () => collaboration.undo(),
              },
              {
                key: "server-redo",
                tooltip: "重做本人的修改",
                icon: <Redo2 size={16} />,
                onClick: () => collaboration.undo(true),
              },
            ]}
            onChange={collaboration.onChange}
            onOp={collaboration.onOp}
            hooks={{
              afterSelectionChange: (sheetId, selection) =>
                collaboration.presence(
                  sheetId,
                  selection.row_focus ?? selection.row[0],
                  selection.column_focus ?? selection.column[0],
                ),
            }}
          />
        )}
      </div>
      {(!collaboration.data || busy) && (
        <div className={styles.status}>
          {busy ? "正在处理 Excel…" : "正在打开表格…"}
        </div>
      )}
      <FileDialogs action={action} close={() => setAction(null)} />
      <SheetHistory
        file={file}
        open={history}
        close={() => setHistory(false)}
        revision={collaboration.revision}
        epoch={collaboration.epoch}
        reload={collaboration.reload}
        checkpoint={collaboration.checkpoint}
      />
    </main>
  );
}
