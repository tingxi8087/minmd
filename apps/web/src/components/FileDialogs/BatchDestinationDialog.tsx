import { useEffect, useRef, useState } from "react";
import { Alert, App, Modal } from "antd";
import { v4 as createId } from "uuid";
import { filesApi } from "@/api/files";
import { useWorkspace, type Entry } from "@/store/workspace";
import { useAuth } from "@/store/auth";
import { errorMessage } from "@/http";
import { isDemo } from "@/runtime";
import { useScopedTasks } from "@/utils/useScopedTask";
import { canMove } from "@/utils/fileTree";
import { selectionRoots } from "@/views/Files/selection";
import DestinationPicker from "./DestinationPicker";

export default function BatchDestinationDialog({
  action,
  close,
  onCompleted,
}: {
  action: {
    type: "batch-move" | "batch-copy";
    files: Entry[];
    parent: string | null;
  };
  close: () => void;
  onCompleted?: () => void;
}) {
  const { files, space, spaces, loadFiles } = useWorkspace();
  const user = useAuth((state) => state.user);
  const initialScope = useRef({ user, space });
  const begin = useScopedTasks();
  const { message } = App.useApp();
  const [parent, setParent] = useState(action.parent);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [committed, setCommitted] = useState(false);
  const request = useRef({ parent, id: createId() });
  const copying = action.type === "batch-copy";
  const roots = selectionRoots(
    files,
    action.files.map((file) => file.id),
  );
  const sources = roots.length ? roots : action.files;
  const missing = action.files.some(
    (file) =>
      !files.some((current) => current.id === file.id && !current.deleted),
  );
  const invalid =
    missing || sources.some((file) => !canMove(files, file.id, parent));
  const sameLocation =
    !copying && sources.every((file) => file.parent === parent);
  useEffect(() => {
    if (
      initialScope.current.user !== user ||
      initialScope.current.space !== space
    )
      close();
  }, [user, space, close]);
  const submit = async () => {
    if (saving || isDemo || (!committed && (invalid || sameLocation))) return;
    const task = begin();
    setSaving(true);
    setError("");
    try {
      if (!committed) {
        const ids = sources.map((file) => file.id);
        if (request.current.parent !== parent)
          request.current = { parent, id: createId() };
        if (copying)
          await task.wait(() =>
            filesApi.batchCopy(
              space,
              ids,
              parent,
              request.current.id,
              task.signal,
            ),
          );
        else
          await task.wait(() =>
            filesApi.batchMove(space, ids, parent, task.signal),
          );
        setCommitted(true);
      }
      await task.wait(async () => {
        await loadFiles();
        const state = useWorkspace.getState();
        if (state.filesError) throw new Error(state.filesError);
      });
      onCompleted?.();
      message.success(copying ? "已创建副本" : "已移动文件");
      close();
    } catch (cause) {
      if (!task.signal.aborted) setError(errorMessage(cause));
    } finally {
      task.finish();
      if (!task.signal.aborted) setSaving(false);
    }
  };
  return (
    <Modal
      open
      width={560}
      title={`${copying ? "创建副本" : "移动文件"} · ${sources.length} 项`}
      onCancel={close}
      onOk={submit}
      confirmLoading={saving}
      okText={
        committed ? "刷新文件列表" : copying ? "复制到此处" : "移动到此处"
      }
      cancelText="取消"
      closable={!saving}
      maskClosable={!saving}
      keyboard={!saving}
      cancelButtonProps={{ disabled: saving }}
      okButtonProps={{
        disabled: isDemo || saving || (!committed && (invalid || sameLocation)),
      }}
    >
      {error && (
        <Alert
          type="error"
          showIcon
          message={error}
          description={
            committed
              ? "操作已完成，文件列表刷新失败。请重试刷新，不会重复创建副本。"
              : "操作未确认完成。可重试，或调整目标位置。"
          }
          style={{ marginTop: 12 }}
        />
      )}
      {isDemo && <Alert type="info" message="批量移动与创建副本部署后可使用" />}
      <DestinationPicker
        file={sources[0]}
        selection={sources}
        files={files}
        value={parent}
        onChange={(value) => {
          setParent(value);
          setError("");
        }}
        spaceName={spaces.find((item) => item.id === space)?.name ?? "当前空间"}
        copy={copying}
        disabled={saving || committed}
      />
      <p
        className="muted"
        style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}
        role="status"
      >
        {saving
          ? copying
            ? "正在复制内容与附件，请稍候…"
            : "正在移动文件…"
          : committed
            ? "操作已完成，等待刷新文件列表。"
            : invalid
              ? "所选文件已变化，或目标为自身、后代目录，请重新选择。"
              : sameLocation
                ? "文件已在此位置，请选择其他位置。"
                : copying
                  ? "包含全部子文件；副本归你所有且默认私有，不带入历史版本、分享与收藏。"
                  : "包含全部子文件；文件链接、历史版本与分享设置保持不变。"}
      </p>
    </Modal>
  );
}
