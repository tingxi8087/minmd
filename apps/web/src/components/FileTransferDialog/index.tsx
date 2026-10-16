import { useEffect, useRef, useState } from "react";
import { v4 as createId } from "uuid";
import { App, Modal, Progress } from "antd";
import {
  Archive,
  CheckCircle2,
  FileText,
  Download,
  Upload,
} from "lucide-react";
import { isDemo } from "@/runtime";
import { useAuth } from "@/store/auth";
import { useWorkspace } from "@/store/workspace";
import { errorMessage } from "@/http";
import { useScopedTasks } from "@/utils/useScopedTask";
import { assertUploadSize } from "@/utils/uploadLimits";
import {
  fileTransfersApi,
  type TransferStatus,
  type ImportTarget,
} from "@/api/fileTransfers";
import styles from "./index.module.less";
export type TransferAction =
  | {
      type: "export";
      spaceId: string;
      ids: string[];
      single?: boolean;
      name?: string;
      beforeExport?: () => Promise<unknown>;
      demoMarkdown?: () => void;
    }
  | { type: "import"; spaceId: string; target: ImportTarget; file: File };
export default function FileTransferDialog({
  action,
  close,
  onImported,
}: {
  action: TransferAction;
  close: () => void;
  onImported?: () => void | Promise<void>;
}) {
  const { message } = App.useApp();
  const [mode, setMode] = useState<"complete" | "markdown">(
    isDemo ? "markdown" : "complete",
  );
  const [job, setJob] = useState<TransferStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState("");
  const [uploadPercent, setUploadPercent] = useState(0);
  const begin = useScopedTasks();
  const taskRef = useRef<ReturnType<typeof begin> | null>(null);
  const jobRef = useRef<string | null>(null);
  const batchRef = useRef(createId());
  const user = useAuth((state) => state.user);
  const space = useWorkspace((state) => state.space);
  const spaces = useWorkspace((state) => state.spaces);
  const files = useWorkspace((state) => state.files);
  const destination =
    action.type === "import"
      ? [
          spaces.find((item) => item.id === action.spaceId)?.name ?? "当前空间",
          action.target.replaceFileId
            ? (files.find((file) => file.id === action.target.replaceFileId)
                ?.name ?? "当前文档")
            : action.target.parentId
              ? (files.find((file) => file.id === action.target.parentId)
                  ?.name ?? "当前目录")
              : "根目录",
        ].join(" / ")
      : "";
  const scope = useRef({ user, space });
  useEffect(() => {
    if (scope.current.user !== user || scope.current.space !== space) close();
  }, [user, space]);
  useEffect(
    () => () => {
      taskRef.current?.controller.abort();
    },
    [],
  );
  const read = (value: TransferStatus) => {
    setJob(value);
    jobRef.current = value.id;
    if (value.status === "failed")
      throw new Error(value.error?.message ?? "文件处理失败");
    return value;
  };
  const poll = async (
    initial: TransferStatus,
    task: ReturnType<typeof begin>,
  ) => {
    let current = read(initial);
    while (current.status === "processing") {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(done, 500);
        function done() {
          task.signal.removeEventListener("abort", abort);
          resolve();
        }
        function abort() {
          clearTimeout(timer);
          reject(new DOMException("操作已取消", "AbortError"));
        }
        task.signal.addEventListener("abort", abort, { once: true });
        if (task.signal.aborted) abort();
      });
      current = read(
        await task.wait(() => fileTransfersApi.status(current.id, task.signal)),
      );
    }
    return current;
  };
  const work = async (
    operation: (task: ReturnType<typeof begin>) => Promise<void>,
  ) => {
    if (busy) return;
    const task = begin();
    taskRef.current = task;
    setBusy(true);
    setError("");
    try {
      await operation(task);
    } catch (error) {
      if (!task.signal.aborted) setError(errorMessage(error));
    } finally {
      task.finish();
      if (!task.signal.aborted) {
        setBusy(false);
        setCommitting(false);
      }
    }
  };
  const inspectImport = () =>
    work(async (task) => {
      if (action.type !== "import") return;
      assertUploadSize(action.file);
      let created = await task.wait(() =>
        fileTransfersApi.import(
          action.spaceId,
          batchRef.current,
          action.target,
          task.signal,
        ),
      );
      if (created.status === "failed") {
        await task.wait(() => fileTransfersApi.cancel(created.id, task.signal));
        batchRef.current = createId();
        created = await task.wait(() =>
          fileTransfersApi.import(
            action.spaceId,
            batchRef.current,
            action.target,
            task.signal,
          ),
        );
      }
      created = await poll(created, task);
      if (created.status === "completed") {
        await onImported?.();
        close();
        return;
      }
      if (created.status === "ready") return;
      read(
        await task.wait(() =>
          fileTransfersApi.upload(
            created.id,
            action.file,
            task.signal,
            setUploadPercent,
          ),
        ),
      );
    });
  useEffect(() => {
    if (action.type === "import") void inspectImport();
  }, []);
  const exportFiles = () =>
    work(async (task) => {
      if (action.type !== "export") return;
      if (isDemo) {
        action.demoMarkdown?.();
        close();
        return;
      }
      if (action.beforeExport) await task.wait(action.beforeExport);
      const ready = await poll(
        await task.wait(() =>
          fileTransfersApi.export(
            action.spaceId,
            action.ids,
            mode,
            action.single ?? false,
            task.signal,
          ),
        ),
        task,
      );
      const blob = await task.wait(() =>
        fileTransfersApi.download(ready.id, task.signal),
      );
      const url = URL.createObjectURL(blob),
        anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = ready.filename ?? "minmd-export.zip";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      message.success("文件已导出");
    });
  const confirmImport = () =>
    work(async (task) => {
      if (!job) return;
      setCommitting(true);
      const completed = await poll(
        await task.wait(() => fileTransfersApi.commit(job.id, task.signal)),
        task,
      );
      if (completed.status !== "completed")
        throw new Error("导入尚未完成，请重试");
      await task.wait(async () => {
        await onImported?.();
      });
      message.success(
        action.type === "import" && action.target.replaceFileId
          ? "正文已替换，可在版本历史中恢复"
          : `已导入 ${completed.fileIds.length} 个文件及文件夹`,
      );
      close();
    });
  const cancel = async () => {
    if (committing) return;
    taskRef.current?.controller.abort();
    const id = jobRef.current;
    if (
      id &&
      scope.current.user === useAuth.getState().user &&
      scope.current.space === useWorkspace.getState().space
    ) {
      const task = begin();
      try {
        await task.wait(() => fileTransfersApi.cancel(id, task.signal));
      } catch {
      } finally {
        task.finish();
      }
    }
    close();
  };
  const importing = action.type === "import";
  return (
    <Modal
      open
      width={520}
      title={
        importing
          ? action.target.replaceFileId
            ? "导入文档"
            : "导入文件"
          : action.single
            ? "导出文档"
            : "导出选中文件"
      }
      footer={null}
      onCancel={() => void cancel()}
      closable={!committing}
      maskClosable={!busy}
      keyboard={!busy}
    >
      <div className={styles.intro}>
        <span>{importing ? <Upload size={21} /> : <Download size={21} />}</span>
        <div>
          <strong>
            {importing
              ? action.file.name
              : (action.name ?? `已选择 ${action.ids.length} 项`)}
          </strong>
          {importing
            ? "先检查内容，再确认导入"
            : action.single
              ? "选择适合你的文档格式"
              : "文件夹将包含全部后代，重复选择自动合并"}
        </div>
      </div>
      {!importing && (
        <div
          className={styles.formats}
          role="radiogroup"
          aria-label="文档导出格式"
          onKeyDown={(event) => {
            if (
              !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                event.key,
              ) ||
              busy
            )
              return;
            event.preventDefault();
            const options = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>(
                'button[role="radio"]:not(:disabled)',
              ),
            );
            const current = options.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            const next =
              options[
                (current +
                  (event.key === "ArrowLeft" || event.key === "ArrowUp"
                    ? -1
                    : 1) +
                  options.length) %
                  options.length
              ];
            next?.focus();
            next?.click();
          }}
        >
          <button
            type="button"
            role="radio"
            aria-checked={mode === "complete"}
            tabIndex={mode === "complete" ? 0 : -1}
            className={styles.option}
            disabled={busy || isDemo}
            title={isDemo ? "部署后可使用" : undefined}
            onClick={() => setMode("complete")}
          >
            <Archive size={20} />
            <span>
              <strong>
                minmd 完整格式
                <span className={styles.badge}>
                  {isDemo ? "部署后可使用" : "推荐"}
                </span>
              </strong>
              <small>
                保留文字颜色、字号、块样式和图片布局，适合备份和迁移。
              </small>
            </span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === "markdown"}
            tabIndex={mode === "markdown" ? 0 : -1}
            className={styles.option}
            disabled={busy}
            onClick={() => setMode("markdown")}
          >
            <FileText size={20} />
            <span>
              <strong>Markdown</strong>
              <small>
                {action.type === "export" && action.single
                  ? "方便在其他软件中使用。文字颜色、字号等自定义样式无法保留。"
                  : "文档转为 MD、表格转为 XLSX。文字颜色、字号等自定义样式无法保留。"}
              </small>
            </span>
          </button>
        </div>
      )}
      {importing && job?.status === "ready" && (
        <>
          <dl className={styles.summary}>
            <div>
              <dt>文档格式</dt>
              <dd>
                {job.mode === "complete" ? "minmd 完整格式" : "Markdown / XLSX"}
              </dd>
            </div>
            <div>
              <dt>内容数量</dt>
              <dd>
                {job.fileCount} 项 · {job.assetCount} 个附件
              </dd>
            </div>
            <div className={styles.destination}>
              <dt>目标位置</dt>
              <dd>{destination}</dd>
            </div>
          </dl>
          <p className={styles.note}>
            {action.target.replaceFileId
              ? "将替换当前文档正文，保留标题和位置。其他编辑会话会重新载入，导入前内容可在版本历史中恢复。"
              : "导入到当前目录，保留目录结构。同名文件自动加后缀，原文件不会被覆盖。创建人统一为当前账号。"}
          </p>
          {job.mode === "markdown" && (
            <p className={styles.note}>Markdown 中未保存的文字样式无法恢复。</p>
          )}
        </>
      )}
      {!importing && (
        <p className={styles.note}>
          {action.single
            ? "完整格式为 .minmd.zip。Markdown 含本地图片时为 ZIP，否则为 .md。"
            : "下载包含目录与附件的 ZIP，只包含当前内容，不含历史版本和分享权限。"}
        </p>
      )}
      {busy && (
        <div className={styles.progress} role="status">
          <p>
            {committing
              ? "正在提交导入，请稍候…"
              : importing
                ? uploadPercent < 100
                  ? "正在上传压缩包…"
                  : "正在校验内容和附件…"
                : "正在准备导出内容…"}
          </p>
          <Progress
            percent={
              importing && !committing
                ? uploadPercent
                : job?.total
                  ? Math.min(99, Math.round((job.done / job.total) * 100))
                  : 0
            }
            size="small"
            status="active"
          />
        </div>
      )}
      {error && (
        <div role="alert" className={styles.error}>
          {error}
        </div>
      )}
      {!busy && !importing && job?.status === "ready" && !error && (
        <p className={styles.note}>
          <CheckCircle2 size={13} /> 已导出 {job.fileCount} 项（含文件夹）、
          {job.assetCount} 个附件，内容已交给浏览器下载。
        </p>
      )}
      <div className={styles.footer}>
        {importing &&
          error &&
          !busy &&
          !["ready", "completed"].includes(job?.status ?? "") && (
            <button
              className="secondary-button"
              onClick={() => void inspectImport()}
            >
              重新检查
            </button>
          )}
        <button
          className="secondary-button"
          disabled={committing}
          onClick={() => void cancel()}
        >
          {busy ? "取消任务" : "关闭"}
        </button>
        {importing ? (
          <button
            className="primary-button"
            disabled={
              busy || !["ready", "completed"].includes(job?.status ?? "")
            }
            onClick={() => void confirmImport()}
          >
            确认导入
          </button>
        ) : (
          <button
            className="primary-button"
            disabled={busy}
            onClick={() => void exportFiles()}
          >
            {busy ? "正在导出…" : "导出文件"}
          </button>
        )}
      </div>
    </Modal>
  );
}
