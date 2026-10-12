import FileHeader from "@/components/FileHeader";
import FileIcon from "@/components/FileIcon";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { App, Button, Input, Modal, Select } from "antd";
import { ArrowLeft, LockKeyhole, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { JSONContent } from "@tiptap/core";
import type { Sheet } from "@fortune-sheet/core";
import {
  FILE_ACCESS_CHANGED,
  fileAccessApi,
  type FileAccess,
  type Permission,
} from "@/api/fileAccess";
import { documentApi, type DocumentContent } from "@/api/documents";
import { assetsApi, type PresentationProjection } from "@/api/assets";
import { useAuth } from "@/store/auth";
import { fromRemoteFile, useWorkspace, type Entry } from "@/store/workspace";
import { errorMessage } from "@/http";
import { ReadonlyPreview } from "@/views/Document/components/VersionHistory";
import styles from "./index.module.less";
const SheetPreview = lazy(() => import("@/views/Share/SharedSpreadsheet"));
const PresentationPreview = lazy(
  () => import("@/views/Share/SharedPresentation"),
);
const permissions = [
  { value: "read", label: "只读" },
  { value: "edit", label: "可编辑" },
];
export function PermissionRequest({
  fileId,
  access,
  changed,
}: {
  fileId: string;
  access: FileAccess;
  changed: () => void;
}) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false);
  const [permission, setPermission] = useState<Permission>(
    access.permission ? "edit" : "read",
  );
  const [reason, setReason] = useState("");
  const pending = access.request?.status === "pending";
  if (access.permission === "edit" || access.permission === "manage")
    return null;
  return (
    <>
      {pending ? (
        <div className={styles.request}>
          <span>
            申请中 ·{" "}
            {access.request?.permission === "edit" ? "编辑权限" : "访问权限"}
          </span>
          <Button
            size="small"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await fileAccessApi.cancel(fileId);
                changed();
              } catch (error) {
                message.error(errorMessage(error));
              } finally {
                setBusy(false);
              }
            }}
          >
            取消申请
          </Button>
        </div>
      ) : (
        <Button type="primary" onClick={() => setOpen(true)}>
          {access.permission ? "申请编辑权限" : "申请访问"}
        </Button>
      )}
      <Modal
        open={open}
        title={access.permission ? "申请编辑权限" : "申请访问"}
        okText="提交申请"
        cancelText="取消"
        confirmLoading={busy}
        closable={!busy}
        maskClosable={!busy}
        onCancel={() => {
          if (!busy) setOpen(false);
        }}
        onOk={async () => {
          if (busy) return;
          setBusy(true);
          try {
            await fileAccessApi.apply(fileId, permission, reason.trim());
            setOpen(false);
            setReason("");
            changed();
            message.success("申请已提交");
          } catch (error) {
            message.error(errorMessage(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        {!access.permission && (
          <div className={styles.field}>
            <label>申请权限</label>
            <Select
              aria-label="申请权限"
              value={permission}
              options={permissions}
              onChange={setPermission}
            />
          </div>
        )}
        <div className={styles.field}>
          <label>申请理由</label>
          <Input.TextArea
            aria-label="申请理由"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
            placeholder="可选，说明你希望如何参与"
            rows={3}
          />
        </div>
      </Modal>
    </>
  );
}
function ReadonlyFile({
  file,
  access,
  changed,
}: {
  file: Entry;
  access: FileAccess;
  changed: () => void;
}) {
  const navigate = useNavigate();
  const [content, setContent] = useState<DocumentContent | null>(null),
    [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setContent(null);
    setError("");
    void documentApi
      .content(file.id, controller.signal)
      .then(setContent)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(error));
      });
    return () => controller.abort();
  }, [file.id, reload]);
  const projection = content?.projection;
  const sheets = Array.isArray(projection)
    ? (projection as Sheet[])
    : projection && "sheets" in projection
      ? (projection.sheets as Sheet[])
      : [];
  return (
    <main className={styles.page}>
      <FileHeader className={styles.header}>
        <Button
          type="text"
          aria-label="返回"
          icon={<ArrowLeft size={16} />}
          onClick={() => navigate(access.member ? "/files" : "/shared-with-me")}
        />
        <FileIcon kind={file.kind} small />
        <strong>{file.name}</strong>
        <span className={styles.tag}>只读</span>
        <div className={styles.actions}>
          <Button
            size="small"
            icon={<RefreshCw size={14} />}
            onClick={() => {
              setReload((value) => value + 1);
              changed();
            }}
          >
            刷新
          </Button>
          <PermissionRequest
            fileId={file.id}
            access={access}
            changed={changed}
          />
        </div>
      </FileHeader>
      {error ? (
        <div className={styles.empty} role="alert">
          {error}
        </div>
      ) : !content ? (
        <div className={styles.empty}>正在读取文档…</div>
      ) : (
        <Suspense fallback={<div className={styles.empty}>正在加载预览…</div>}>
          {file.kind === "doc" ? (
            <div className={styles.document}>
              <ReadonlyPreview
                projection={projection as JSONContent}
                label="文档只读预览"
              />
            </div>
          ) : file.kind === "sheet" ? (
            <SheetPreview sheets={sheets} height="calc(100vh - 44px)" />
          ) : (
            <PresentationPreview
              token=""
              projection={projection as PresentationProjection}
              loadAsset={assetsApi.download}
            />
          )}
        </Suspense>
      )}
    </main>
  );
}
export default function FileAccessGate({
  fileId,
  children,
}: {
  fileId: string;
  children: (file: Entry) => ReactNode;
}) {
  const userId = useAuth((state) => state.user?.id);
  const currentScope = `${userId ?? ""}:${fileId}`;
  const [scope, setScope] = useState("");
  const localRevision = useWorkspace(
    (state) => state.files.find((file) => file.id === fileId)?.metadataRevision,
  );
  const [access, setAccess] = useState<FileAccess | null>(null),
    [file, setFile] = useState<Entry | null>(null),
    [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const changed = () => setReload((value) => value + 1);
  useEffect(() => {
    const refresh = (event: Event) => {
      if ((event as CustomEvent<string>).detail === fileId) changed();
    };
    window.addEventListener(FILE_ACCESS_CHANGED, refresh);
    const timer = setInterval(changed, 15000);
    return () => {
      window.removeEventListener(FILE_ACCESS_CHANGED, refresh);
      clearInterval(timer);
    };
  }, [fileId]);
  useEffect(() => {
    if (!userId || !fileId) return;
    const controller = new AbortController();
    setError("");
    void (async () => {
      const value = await fileAccessApi.access(fileId, controller.signal);
      if (controller.signal.aborted) return;
      setAccess(value);
      if (!value.permission) {
        setFile(null);
        setScope(`${userId}:${fileId}`);
        return;
      }
      const remote = await fileAccessApi.file(fileId, controller.signal);
      if (!controller.signal.aborted) {
        setFile({ ...fromRemoteFile(remote), permission: value.permission });
        setScope(`${userId}:${fileId}`);
      }
    })().catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setAccess(null);
        setFile(null);
        setError(errorMessage(error));
        setScope(`${userId}:${fileId}`);
      }
    });
    return () => controller.abort();
  }, [userId, fileId, reload, localRevision]);
  if (error && scope === currentScope)
    return (
      <div className={styles.empty} role="alert">
        {error}
        <Button onClick={changed}>重试</Button>
      </div>
    );
  if (!access || scope !== currentScope)
    return <div className={styles.empty}>正在检查文档权限…</div>;
  if (!access.permission)
    return (
      <div className={styles.empty}>
        <LockKeyhole size={28} />
        <h2>你没有文档访问权限</h2>
        <PermissionRequest fileId={fileId} access={access} changed={changed} />
        <Button type="text" onClick={changed}>
          刷新权限
        </Button>
      </div>
    );
  if (!file) return <div className={styles.empty}>正在读取文件…</div>;
  if (access.permission === "read")
    return (
      <ReadonlyFile
        key={`${userId}:${file.id}`}
        file={file}
        access={access}
        changed={changed}
      />
    );
  return children(file);
}
