import { v4 as createId } from "uuid";
import { useEffect, useRef, useState } from "react";
import { App, Checkbox, Modal, Select } from "antd";
import { useWorkspace } from "@/store/workspace";
import { useAuth } from "@/store/auth";
import { filesApi } from "@/api/files";
import { demoImportApi, type DemoImportResult } from "@/api/demoImport";
import { errorMessage } from "@/http";
import {
  createImportBoundary,
  awaitImport,
  readDemoSource,
  sourceHash,
  prepareDemoEntries,
  type ImportTask,
  type MissingAsset,
} from "./source";
const taskStorage = "minmd-demo-import-tasks-v1";
function readTasks(): ImportTask[] {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(taskStorage) ?? "[]",
    );
    return Array.isArray(value)
      ? value.filter((task): task is ImportTask =>
          Boolean(
            task &&
            typeof task === "object" &&
            typeof task.key === "string" &&
            typeof task.userId === "string" &&
            typeof task.sourceHash === "string" &&
            typeof task.target === "string" &&
            task.assets &&
            typeof task.assets === "object",
          ),
        )
      : [];
  } catch {
    return [];
  }
}
function persistTask(task: ImportTask) {
  const tasks = readTasks();
  localStorage.setItem(
    taskStorage,
    JSON.stringify([...tasks.filter((item) => item.key !== task.key), task]),
  );
}
export default function DemoImport({ close }: { close: () => void }) {
  const { spaces, space, loadFiles } = useWorkspace();
  const user = useAuth((state) => state.user);
  const { message, modal } = App.useApp();
  const activeOperation = useRef<ReturnType<
    typeof createImportBoundary
  > | null>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const initialUser = useAuth.getState().user?.id;
    const initialSpace = useWorkspace.getState().space;
    const changed = () => {
      if (
        useAuth.getState().user?.id !== initialUser ||
        useWorkspace.getState().space !== initialSpace
      ) {
        activeOperation.current?.controller.abort();
        closeRef.current();
      }
    };
    const auth = useAuth.subscribe(changed);
    const workspace = useWorkspace.subscribe(changed);
    return () => {
      activeOperation.current?.controller.abort();
      auth();
      workspace();
    };
  }, []);
  const begin = () => {
    const boundary = createImportBoundary(() => ({
      userId: useAuth.getState().user?.id,
      spaceId: useWorkspace.getState().space,
    }));
    activeOperation.current = boundary;
    return boundary;
  };
  const [source] = useState(() => {
    try {
      return {
        entries: readDemoSource(localStorage.getItem("minmd-static-demo-v1")),
        error: "",
      };
    } catch (error) {
      return { entries: [], error: errorMessage(error) };
    }
  });
  const sourceSpaces = [...new Set(source.entries.map((entry) => entry.space))];
  const [selected, setSelected] = useState(sourceSpaces[0] ?? "");
  const [target, setTarget] = useState(space);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<DemoImportResult | null>(null);
  const [missing, setMissing] = useState<MissingAsset[]>([]);
  const [replacements, setReplacements] = useState(new Map<string, File>());
  const entries = source.entries.filter(
    (entry) => selected === "__all__" || entry.space === selected,
  );
  const run = async () => {
    if (!user || !confirmed || busy || !entries.length) return;
    if (entries.length > 200) {
      message.warning("每个导入任务最多200项，请按旧空间分批导入");
      return;
    }
    if (useAuth.getState().user?.id !== user.id) return;
    const boundary = begin();
    setBusy(true);
    setError("");
    setProgress("检查目标目录…");
    try {
      const hash = await awaitImport(boundary, () => sourceHash(entries));
      let task = readTasks().find(
        (task) =>
          task.userId === user.id &&
          task.target === target &&
          task.sourceHash === hash &&
          task.source === selected,
      );
      if (!task) {
        const existing = await awaitImport(boundary, () =>
          filesApi.tree(target, boundary.signal),
        );
        const names = entries
          .filter(
            (entry) =>
              !entry.parent ||
              !entries.some((item) => item.id === entry.parent),
          )
          .map((entry) => entry.name);
        const conflicts = existing.filter(
          (file) => !file.parentId && names.includes(file.name),
        );
        if (conflicts.length) {
          const accepted = await awaitImport(
            boundary,
            () =>
              new Promise<boolean>((resolve) => {
                const dialog = modal.confirm({
                  title: "目标根目录已有同名文件",
                  content: `同名：${conflicts.map((file) => file.name).join("、")}。将另建独立副本，保留现有目录，不覆盖或合并。`,
                  okText: "继续导入副本",
                  cancelText: "取消",
                  onOk: () => resolve(true),
                  onCancel: () => resolve(false),
                });
                boundary.signal.addEventListener(
                  "abort",
                  () => {
                    dialog.destroy();
                    resolve(false);
                  },
                  { once: true },
                );
              }),
          );
          if (!accepted) return;
        }
        task = {
          key: createId(),
          userId: user.id,
          target,
          source: selected,
          sourceHash: hash,
          assets: {},
        };
        persistTask(task);
      }
      const prepared = await prepareDemoEntries(
        entries,
        task,
        replacements,
        persistTask,
        (name) => {
          boundary.assertActive();
          setProgress(`读取与上传：${name}`);
        },
        undefined,
        boundary,
      );
      boundary.assertActive();
      setMissing(prepared.missing);
      setProgress("服务器保存目录与内容…");
      const response = await awaitImport(boundary, () =>
        demoImportApi.run(target, task.key, prepared.entries, boundary.signal),
      );
      task.jobId = response.jobId;
      persistTask(task);
      setResult(response);
      if (useWorkspace.getState().space === target)
        await awaitImport(boundary, () => loadFiles());
      const failed = response.items.filter(
        (item) => item.status === "failed",
      ).length;
      if (failed)
        message.warning(
          `${response.items.length - failed} 项成功，${failed} 项未完成，请补齐后重试`,
        );
      else message.success("所选演示文件已导入，全部为私有");
    } catch (error) {
      if (!boundary.signal.aborted) setError(errorMessage(error));
    } finally {
      if (!boundary.signal.aborted) {
        setBusy(false);
        setProgress("");
      }
      if (activeOperation.current === boundary) activeOperation.current = null;
    }
  };
  const queryPrevious = async () => {
    if (!user || busy) return;
    if (useAuth.getState().user?.id !== user.id) return;
    const boundary = begin();
    setBusy(true);
    setError("");
    try {
      const hash = await awaitImport(boundary, () => sourceHash(entries));
      const task = readTasks().find(
        (task) =>
          task.userId === user.id &&
          task.target === target &&
          task.sourceHash === hash &&
          task.source === selected,
      );
      if (!task?.jobId) {
        message.info("没有已确认的服务器任务，可点击导入安全重试");
        return;
      }
      const jobId = task.jobId;
      setResult(
        await awaitImport(boundary, () =>
          demoImportApi.result(target, jobId, boundary.signal),
        ),
      );
    } catch (error) {
      if (!boundary.signal.aborted) setError(errorMessage(error));
    } finally {
      if (!boundary.signal.aborted) setBusy(false);
      if (activeOperation.current === boundary) activeOperation.current = null;
    }
  };
  const changeSelection = () => {
    setResult(null);
    setMissing([]);
    setReplacements(new Map());
    setConfirmed(false);
    setError("");
  };
  return (
    <Modal
      title="导入本机演示数据"
      open
      width={620}
      onCancel={() => {
        if (!busy) close();
      }}
      onOk={() => void run()}
      okText={result ? "重试未完成项" : "开始导入"}
      okButtonProps={{
        disabled:
          !confirmed ||
          !entries.length ||
          Boolean(source.error) ||
          result?.status === "completed",
      }}
      confirmLoading={busy}
      cancelText="关闭"
      cancelButtonProps={{ disabled: busy }}
      closable={!busy}
      maskClosable={!busy}
      keyboard={!busy}
    >
      <p>
        保留本机旧数据，导入文件均为私有。旧分享链接、密码和 API 密钥不迁移。
      </p>
      {source.error && <p role="alert">{source.error}</p>}
      {!source.entries.length && !source.error && (
        <p>本机没有可导入的旧演示备份。</p>
      )}
      <div className="field">
        <label>旧演示空间</label>
        <Select
          value={selected}
          disabled={busy}
          options={[
            {
              value: "__all__",
              label: `全部旧空间 · ${source.entries.length}项`,
            },
            ...sourceSpaces.map((value) => ({
              value,
              label: `${value} · ${source.entries.filter((entry) => entry.space === value).length}项`,
            })),
          ]}
          onChange={(value) => {
            setSelected(value);
            changeSelection();
          }}
        />
      </div>
      <div className="field">
        <label>目标真实空间</label>
        <Select
          value={target}
          disabled={busy}
          options={spaces.map((space) => ({
            value: space.id,
            label: space.name,
          }))}
          onChange={(value) => {
            setTarget(value);
            changeSelection();
          }}
        />
      </div>
      <Checkbox
        checked={confirmed}
        disabled={busy}
        onChange={(event) => setConfirmed(event.target.checked)}
      >
        确认把 {entries.length} 项导入目标空间根目录
      </Checkbox>
      <button
        className="secondary-button"
        style={{ marginLeft: 10 }}
        disabled={busy || !entries.length}
        onClick={() => void queryPrevious()}
      >
        查看上次任务
      </button>
      {progress && <p role="status">{progress}</p>}
      {error && (
        <p role="alert">{error}。本机源文件和导入任务均保留，可安全重试。</p>
      )}
      {result && (
        <div style={{ maxHeight: 260, overflow: "auto", marginTop: 14 }}>
          {result.items.map((item) => (
            <div
              key={item.oldId}
              style={{
                padding: "7px 0",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <strong>
                {entries.find((entry) => entry.id === item.oldId)?.name ??
                  item.oldId}
              </strong>
              <span
                style={{
                  marginLeft: 12,
                  color:
                    item.status === "success"
                      ? "var(--accent)"
                      : "var(--danger)",
                }}
              >
                {item.status === "success" ? "已导入" : "未完成"}
              </span>
              {item.message && <p>{item.message}</p>}
            </div>
          ))}
        </div>
      )}
      {missing.length > 0 && (
        <section style={{ marginTop: 14 }}>
          <strong>补充缺失或失败的附件</strong>
          {missing.map((item) => (
            <div key={item.key} className="field">
              <label>{item.label}</label>
              <input
                disabled={busy}
                type="file"
                accept={
                  item.kind === "image"
                    ? "image/png,image/jpeg,image/webp,image/gif"
                    : item.kind === "slide"
                      ? ".pptx"
                      : ".xlsx"
                }
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file)
                    setReplacements((current) =>
                      new Map(current).set(item.key, file),
                    );
                }}
              />
              {replacements.get(item.key)?.name}
            </div>
          ))}
        </section>
      )}
    </Modal>
  );
}
