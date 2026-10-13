import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Dropdown } from "antd";
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
  MoreHorizontal,
  Palette,
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
import { useLayout } from "@/store/layout";
const tools: Record<string, string[]> = {
  开始: [
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
const mobileTools = Array.from(
  new Set([
    "bold",
    "italic",
    "underline",
    "filter",
    ...Object.values(tools).flat(),
  ]),
).filter((name) => !["|", "server-undo", "server-redo"].includes(name));
export default function Spreadsheet({ file }: { file: Entry }) {
  const navigate = useNavigate(),
    { message, modal } = App.useApp();
  const theme = useWorkspace((state) => state.theme);
  const [narrow, setNarrow] = useState(
    () => window.matchMedia("(max-width: 680px)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(max-width: 680px)");
    const update = () => setNarrow(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
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
  const customToolbarItems = useMemo(
    () => [
      {
        key: "server-undo",
        tooltip: "撤销本人的修改",
        icon: <Undo2 size={16} />,
        onClick: () => undoRef.current(),
      },
      {
        key: "server-redo",
        tooltip: "重做本人的修改",
        icon: <Redo2 size={16} />,
        onClick: () => undoRef.current(true),
      },
    ],
    [],
  );
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
        <span className={styles.fileIcon}>
          <FileIcon kind="sheet" small />
        </span>
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
            aria-label="表格版本历史"
            className={`icon-button ${styles.secondaryAction}`}
            onClick={() => setHistory(true)}
          >
            <History size={16} />
          </TooltipButton>
          <TooltipButton
            aria-label="导入 XLSX 到当前表格"
            className={`icon-button ${styles.secondaryAction}`}
            disabled={busy || !collaboration.editable}
            onClick={() => input.current?.click()}
          >
            <Upload size={16} />
          </TooltipButton>
          <TooltipButton
            aria-label="导出 XLSX"
            className={`icon-button ${styles.secondaryAction}`}
            disabled={!collaboration.data}
            onClick={() => void download()}
          >
            <Download size={16} />
          </TooltipButton>
          <button
            className={`secondary-button ${styles.shareButton}`}
            aria-label="分享"
            onClick={() => setAction({ type: "share", file })}
          >
            <Share2 size={15} />
            <span className={styles.shareLabel}>分享</span>
          </button>
          <Dropdown
            trigger={["click"]}
            menu={{
              items: [
                {
                  key: "history",
                  label: "版本历史",
                  icon: <History size={15} />,
                },
                {
                  key: "import",
                  label: "导入 XLSX",
                  icon: <Upload size={15} />,
                  disabled: busy || !collaboration.editable,
                },
                {
                  key: "export",
                  label: "导出 XLSX",
                  icon: <Download size={15} />,
                  disabled: !collaboration.data,
                },
                {
                  key: "theme",
                  label: "主题设置",
                  icon: <Palette size={15} />,
                },
              ],
              onClick: ({ key }) => {
                if (key === "history") setHistory(true);
                else if (key === "import") input.current?.click();
                else if (key === "export") void download();
                else useLayout.getState().setThemeDialogOpen(true);
              },
            }}
          >
            <TooltipButton
              className={`icon-button ${styles.mobileMore}`}
              aria-label="表格更多操作"
              tooltip=""
            >
              <MoreHorizontal size={18} />
            </TooltipButton>
          </Dropdown>
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
            toolbarItems={narrow ? mobileTools : tools[tab]}
            customToolbarItems={customToolbarItems}
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
