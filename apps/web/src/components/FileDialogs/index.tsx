import FileTransferDialog from "@/components/FileTransferDialog";
import { isDemo } from "@/runtime";
import { v4 as createId } from "uuid";
import { assertUploadSize } from "@/utils/uploadLimits";
import { documentApi } from "@/api/documents";
import { sheetApi } from "@/api/sheets";
import { filesApi } from "@/api/files";
import { notifyFileAccessChanged } from "@/api/fileAccess";
import { useEffect, useState, useRef } from "react";
import { App, Input, Modal, Upload } from "antd";
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
import DestinationPicker from "./DestinationPicker";
import { canMove } from "@/utils/fileTree";
export type FileAction =
  | { type: "create"; kind: FileKind; parent: string | null }
  | { type: "upload"; parent: string | null }
  | { type: "rename" | "share" | "move" | "restore"; file: Entry };
export default function FileDialogs({
  action,
  close,
  onCreated,
}: {
  action: FileAction | null;
  close: () => void;
  onCreated?: (id: string, kind?: FileKind) => void;
}) {
  const { add, patch, files, space, relocate, spaces } = useWorkspace();
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
  const [archive, setArchive] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    activeTask.current?.controller.abort();
    setArchive(null);
    if (!action) return;
    pending.current = null;
    setSaving(false);
    setPresentation(null);
    if (action.type === "create" || action.type === "upload") {
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
  if (archive && action.type === "upload")
    return (
      <FileTransferDialog
        action={{
          type: "import",
          spaceId: space,
          file: archive,
          target: { parentId: action.parent, replaceFileId: null },
        }}
        close={close}
        onImported={async () => {
          await useWorkspace.getState().loadFiles();
        }}
      />
    );
  const mediaKind = action.type === "upload";
  const mediaAccept =
    ".zip,.xlsx,.md,.markdown,.pptx,.pdf,.mp4,.webm,.png,.jpg,.jpeg,.webp,.gif";
  const presentationUpload =
    (action.type === "create" && action.kind === "slide") ||
    (action.type === "upload" && /\.pptx$/i.test(presentation?.name ?? ""));
  const title =
    action.type === "upload"
      ? "上传文件"
      : action.type === "create"
        ? action.kind === "slide"
          ? "上传幻灯片"
          : `新建${kindNames[action.kind]}`
        : action.type === "rename"
          ? "重命名"
          : action.type === "move"
            ? "移动文件"
            : "恢复文件";
  const destinationFile =
    action.type === "move" || action.type === "restore"
      ? (files.find((item) => item.id === action.file.id) ?? action.file)
      : null;
  const destinationFiles =
    action.type === "restore"
      ? files.map((item) =>
          item.id === action.file.id ? { ...item, deleted: false } : item,
        )
      : files;
  const invalidDestination = destinationFile
    ? !canMove(destinationFiles, destinationFile.id, parent)
    : false;
  const sameLocation =
    action.type === "move" && parent === destinationFile?.parent;
  const save = async () => {
    if (saving || invalidDestination || sameLocation) return;
    if (action.type === "upload" && presentation) {
      try {
        assertUploadSize(presentation);
      } catch (error) {
        message.warning(errorMessage(error));
        return;
      }
    }
    if (
      action.type === "upload" &&
      presentation &&
      /\.zip$/i.test(presentation.name)
    ) {
      if (isDemo) {
        message.info("压缩包批量导入部署后可使用");
        return;
      }
      setArchive(presentation);
      return;
    }
    if (
      action.type === "upload" &&
      presentation &&
      /\.(xlsx|md|markdown)$/i.test(presentation.name)
    ) {
      if (!name.trim()) {
        message.warning("请输入名称");
        return;
      }
      const isSheet = /\.xlsx$/i.test(presentation.name);
      setSaving(true);
      const operation = begin();
      activeTask.current = operation;
      const task =
        pending.current?.file === presentation
          ? pending.current
          : { file: presentation, userId: user?.id ?? "", spaceId: space };
      pending.current = task;
      const confirmReplace = () =>
        new Promise<boolean>((resolve) =>
          modal.confirm({
            title: "导入目标已被修改",
            content:
              "重试将替换此前创建文件的当前内容，原文件和历史版本仍保留。是否继续？",
            onOk: () => resolve(true),
            onCancel: () => resolve(false),
          }),
        );
      try {
        let id: string;
        if (isSheet) {
          const { importXlsx } = await operation.wait(
            () => import("@/views/Spreadsheet/exchange"),
          );
          const sheets = await operation.wait(() =>
            importXlsx(presentation, createId(), name.trim()),
          );
          id = await saveImportedContent(task, sheets, {
            assertActive: operation.assertActive,
            create: () => add(name.trim(), "sheet", parent),
            content: (target) => sheetApi.content(target, operation.signal),
            confirmReplace,
            write: (target, projection, revision, epoch) =>
              sheetApi.import(
                target,
                projection,
                revision,
                epoch,
                operation.signal,
              ),
          });
        } else {
          const text = await operation.wait(() => presentation.text());
          const { parseMarkdownDocument } = await operation.wait(
            () => import("@/views/Document/utils/markdownImport"),
          );
          id = await saveImportedContent(task, parseMarkdownDocument(text), {
            assertActive: operation.assertActive,
            create: () => add(name.trim(), "doc", parent),
            content: (target) => documentApi.content(target, operation.signal),
            confirmReplace,
            write: (target, projection, revision, epoch) =>
              documentApi.import(
                target,
                projection,
                revision,
                epoch,
                operation.signal,
              ),
          });
        }
        operation.assertActive();
        onCreated?.(id, isSheet ? "sheet" : "doc");
        message.success(
          isDemo
            ? "已导入到当前演示页面，刷新后重置"
            : isSheet
              ? "Excel 已保存到服务器，图表等高级对象暂不支持转换"
              : "Markdown 已保存到服务器，可打开编辑",
        );
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
    if (action.type === "upload" && !presentationUpload) {
      if (!presentation || !name.trim()) {
        message.warning("请选择文件并输入名称");
        return;
      }
      setSaving(true);
      const operation = begin();
      activeTask.current = operation;
      try {
        const result = await operation.wait(() =>
          assetsApi.uploadMedia(
            space,
            presentation,
            parent,
            name.trim(),
            operation.signal,
          ),
        );
        await operation.wait(() => useWorkspace.getState().loadFiles());
        operation.assertActive();
        close();
        onCreated?.(result.id);
      } catch (error) {
        if (!operation.signal.aborted) message.error(errorMessage(error));
      } finally {
        operation.finish();
        if (!operation.signal.aborted) setSaving(false);
      }
      return;
    }
    if (presentationUpload) {
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
        message.success(
          isDemo ? "已导入到当前演示页面，刷新后重置" : "幻灯片已保存到服务器",
        );
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
        } else if (action.file.space !== space) {
          await filesApi.rename(
            action.file.space,
            action.file.id,
            name.trim(),
            action.file.metadataRevision ?? 0,
          );
          notifyFileAccessChanged(action.file.id);
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
      width={destinationFile ? 560 : undefined}
      open
      onCancel={close}
      onOk={save}
      okText={
        action.type === "move"
          ? "移动到此处"
          : action.type === "restore"
            ? "恢复到此处"
            : "确定"
      }
      okButtonProps={{ disabled: saving || invalidDestination || sameLocation }}
      cancelText="取消"
      confirmLoading={saving}
      closable={!saving}
      maskClosable={!saving}
      keyboard={!saving}
      cancelButtonProps={{ disabled: saving }}
      destroyOnHidden
    >
      {action.type === "create" ||
      action.type === "rename" ||
      action.type === "upload" ? (
        <div className="field">
          {(mediaKind ||
            (action.type === "create" && action.kind === "slide")) && (
            <Upload.Dragger
              disabled={saving}
              accept={mediaKind ? mediaAccept : ".pptx"}
              maxCount={1}
              showUploadList={false}
              beforeUpload={(file) => {
                const extension =
                  "." + file.name.split(".").pop()?.toLowerCase();
                if (
                  mediaKind
                    ? !mediaAccept.split(",").includes(extension)
                    : !/\.pptx$/i.test(file.name)
                ) {
                  message.warning(
                    mediaKind
                      ? `请选择 ${mediaAccept} 文件`
                      : "仅支持 .pptx 文件",
                  );
                  return Upload.LIST_IGNORE;
                }
                setPresentation(file);
                setName(
                  mediaKind
                    ? file.name.replace(/\.(xlsx|md|markdown)$/i, "")
                    : file.name.replace(/\.pptx$/i, ""),
                );
                return false;
              }}
            >
              {presentation
                ? presentation.name
                : mediaKind
                  ? "点击选择或拖入文件，自动识别类型"
                  : "点击选择或拖入 .pptx 文件"}
              <p className="muted">
                {mediaKind
                  ? "支持 minmd / Markdown 导出 ZIP、XLSX、MD、PPTX、PDF、MP4 / WebM、PNG / JPEG / WebP / GIF · 单个文件最大 200 MB。普通 ZIP 暂不支持。"
                  : "最多 200 MB · 只读预览"}
              </p>
            </Upload.Dragger>
          )}
          {mediaKind && /\.zip$/i.test(presentation?.name ?? "") ? (
            <p className="muted">
              压缩包将保留内部目录和名称，下一步检查内容并确认导入。
              {isDemo && "批量导入部署后可使用。"}
            </p>
          ) : (
            <>
              <label>名称</label>
              <Input
                disabled={saving}
                autoFocus
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onPressEnter={save}
                placeholder={
                  action.type === "upload"
                    ? "输入文件名称"
                    : action.type === "create"
                      ? `输入${kindNames[action.kind]}名称`
                      : ""
                }
              />
            </>
          )}
        </div>
      ) : action.type === "move" || action.type === "restore" ? (
        <DestinationPicker
          key={`${action.type}/${action.file.id}`}
          file={destinationFile ?? action.file}
          files={destinationFiles}
          value={parent}
          onChange={setParent}
          spaceName={
            spaces.find((item) => item.id === action.file.space)?.name ??
            "当前空间"
          }
          restore={action.type === "restore"}
          disabled={saving}
        />
      ) : null}
    </Modal>
  );
}
