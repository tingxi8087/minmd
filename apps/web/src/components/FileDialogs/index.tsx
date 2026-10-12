import { useEffect, useState, useRef } from "react";
import { App, Input, Modal, Select, Upload } from "antd";
import { validatePresentation } from "@/utils/presentationFiles";
import { assetsApi } from "@/api/assets";
import ShareDialog from "@/components/ShareDialog";
import {
  type Entry,
  type FileKind,
  kindNames,
  useWorkspace,
} from "@/store/workspace";
import { errorMessage } from "@/http";
import { useAuth } from "@/store/auth";
import { useScopedTasks } from "@/utils/useScopedTask";
import {
  saveImportedContent,
  type PendingImport,
} from "@/views/Files/importFlow";
import { canMove, entryPath } from "@/utils/fileTree";
export type FileAction =
  | { type: "create"; kind: FileKind; parent: string | null }
  | { type: "rename" | "share" | "move" | "restore"; file: Entry };
export default function FileDialogs({
  action,
  close,
  onCreated,
}: {
  action: FileAction | null;
  close: () => void;
  onCreated?: (id: string) => void;
}) {
  const { add, patch, files, space, relocate } = useWorkspace();
  const { message, modal } = App.useApp();
  const user = useAuth((state) => state.user);
  const begin = useScopedTasks();
  const activeTask = useRef<ReturnType<typeof begin> | null>(null);
  const scope = useRef({ user, space });
  const pending = useRef<(PendingImport & { assetId?: string }) | null>(null);
  useEffect(() => {
    if (scope.current.user !== user || scope.current.space !== space) close();
    scope.current = { user, space };
  }, [user, space]);
  const [name, setName] = useState("");
  const [parent, setParent] = useState<string | null>(null);
  const [presentation, setPresentation] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    activeTask.current?.controller.abort();
    if (!action) return;
    pending.current = null;
    setSaving(false);
    setPresentation(null);
    if (action.type === "create") {
      setName("");
      setParent(action.parent);
    } else {
      setName(action.file.name);
      setParent(action.file.parent);
    }
  }, [action]);
  if (!action) return null;
  if (action.type === "share")
    return (
      <ShareDialog key={action.file.id} file={action.file} close={close} />
    );
  const title =
    action.type === "create"
      ? action.kind === "slide"
        ? "上传幻灯片"
        : `新建${kindNames[action.kind]}`
      : action.type === "rename"
        ? "重命名"
        : action.type === "move"
          ? "移动到…"
          : action.type === "restore"
            ? "恢复到…"
            : "分享设置";
  const save = async () => {
    if (saving) return;
    if (action.type === "create" && action.kind === "slide") {
      if (!presentation) {
        message.warning("请选择 .pptx 文件");
        return;
      }
      if (!name.trim()) {
        message.warning("请输入名称");
        return;
      }
      setSaving(true);
      const operation = begin();
      activeTask.current = operation;
      const task =
        pending.current?.file === presentation
          ? pending.current
          : { file: presentation, userId: user?.id ?? "", spaceId: space };
      pending.current = task;
      try {
        await operation.wait(() => validatePresentation(presentation));
        if (!task.assetId) {
          const asset = await operation.wait(() =>
            assetsApi.upload(space, presentation, operation.signal),
          );
          task.assetId = asset.id;
        }
        const id = await saveImportedContent(task, task.assetId, {
          assertActive: operation.assertActive,
          create: () => add(name.trim(), "slide", parent),
          content: (target) => assetsApi.presentation(target, operation.signal),
          confirmReplace: () =>
            new Promise<boolean>((resolve) =>
              modal.confirm({
                title: "幻灯片已被修改",
                content: "重试将替换目标当前原文件，是否继续？",
                onOk: () => resolve(true),
                onCancel: () => resolve(false),
              }),
            ),
          write: (target, assetId, revision, epoch) =>
            assetsApi.bindPresentation(
              target,
              assetId,
              { revision, epoch },
              operation.signal,
            ),
        });
        operation.assertActive();
        onCreated?.(id);
        message.success("幻灯片已保存到服务器");
        close();
      } catch (error) {
        if (!operation.signal.aborted)
          message.error(
            `${errorMessage(error)}。原文件${task.createdId ? "和已创建目标" : ""}已保留，可重试。`,
          );
      } finally {
        operation.finish();
        if (!operation.signal.aborted) setSaving(false);
      }
      return;
    }
    setSaving(true);
    const operation = begin();
    activeTask.current = operation;
    try {
      operation.assertActive();
      if (action.type === "create" || action.type === "rename") {
        if (!name.trim()) {
          message.warning("请输入名称");
          return;
        }
        if (action.type === "create") {
          const id = await operation.wait(() =>
            add(name.trim(), action.kind, parent),
          );
          onCreated?.(id);
        } else await patch(action.file.id, { name: name.trim() });
      } else if (action.type === "move") {
        if (!(await relocate(action.file.id, parent))) {
          message.warning("无法移动到该位置");
          return;
        }
      } else if (action.type === "restore") {
        await patch(action.file.id, { deleted: false, parent });
      }
      operation.assertActive();
      message.success("已保存");
      close();
    } catch (error) {
      if (!operation.signal.aborted) message.error(errorMessage(error));
    } finally {
      operation.finish();
      if (!operation.signal.aborted) setSaving(false);
    }
  };
  return (
    <Modal
      title={title}
      open
      onCancel={close}
      onOk={save}
      okText="确定"
      cancelText="取消"
      confirmLoading={saving}
      closable={!saving}
      maskClosable={!saving}
      keyboard={!saving}
      cancelButtonProps={{ disabled: saving }}
      destroyOnHidden
    >
      {action.type === "create" || action.type === "rename" ? (
        <div className="field">
          {action.type === "create" && action.kind === "slide" && (
            <Upload.Dragger
              disabled={saving}
              accept=".pptx"
              maxCount={1}
              showUploadList={false}
              beforeUpload={(file) => {
                if (!/\.pptx$/i.test(file.name)) {
                  message.warning("仅支持 .pptx 文件");
                  return Upload.LIST_IGNORE;
                }
                setPresentation(file);
                setName(file.name.replace(/\.pptx$/i, ""));
                return false;
              }}
            >
              {presentation ? presentation.name : "点击选择或拖入 .pptx 文件"}
              <p className="muted">最多 50 MB · 只读预览</p>
            </Upload.Dragger>
          )}
          <label>名称</label>
          <Input
            disabled={saving}
            autoFocus
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onPressEnter={save}
            placeholder={
              action.type === "create"
                ? `输入${kindNames[action.kind]}名称`
                : ""
            }
          />
        </div>
      ) : action.type === "move" || action.type === "restore" ? (
        <div className="field">
          <label>目标位置</label>
          <Select
            value={parent || "root"}
            onChange={(v) => setParent(v === "root" ? null : v)}
            options={[
              { value: "root", label: "空间根目录" },
              ...files
                .filter(
                  (f) =>
                    f.space === space &&
                    canMove(
                      action.type === "restore"
                        ? files.map((item) =>
                            item.id === action.file.id
                              ? { ...item, deleted: false }
                              : item,
                          )
                        : files,
                      action.file.id,
                      f.id,
                    ),
                )
                .map((f) => ({ value: f.id, label: entryPath(files, f) })),
            ]}
          />
        </div>
      ) : null}
    </Modal>
  );
}
