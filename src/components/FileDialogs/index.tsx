import { useEffect, useState } from "react";
import { App, Input, Modal, Select, Switch, Upload } from "antd";
import {
  deletePresentation,
  savePresentation,
  validatePresentation,
} from "@/utils/presentationFiles";
import { Copy, Globe2, LockKeyhole } from "lucide-react";
import { Entry, FileKind, kindNames, useWorkspace } from "@/store/workspace";
import { canMove, entryPath } from "@/utils/fileTree";
export type FileAction =
  | { type: "create"; kind: FileKind; parent: string | null }
  | { type: "rename" | "share" | "move"; file: Entry };
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
  const { message } = App.useApp();
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [password, setPassword] = useState("");
  const [expires, setExpires] = useState("");
  const [parent, setParent] = useState<string | null>(null);
  const [presentation, setPresentation] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!action) return;
    setPresentation(null);
    if (action.type === "create") {
      setName("");
      setParent(action.parent);
    } else {
      setName(action.file.name);
      setShared(action.file.public);
      setPassword(action.file.password || "");
      setExpires(action.file.expires || "");
      setParent(action.file.parent);
    }
  }, [action]);
  if (!action) return null;
  const isShare = action.type === "share";
  const title =
    action.type === "create"
      ? action.kind === "slide"
        ? "上传幻灯片"
        : `新建${kindNames[action.kind]}`
      : action.type === "rename"
        ? "重命名"
        : action.type === "move"
          ? "移动到…"
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
      let createdId: string | undefined;
      try {
        const slides = await validatePresentation(presentation);
        createdId = crypto.randomUUID();
        await savePresentation(createdId, presentation);
        const id = add(name.trim(), "slide", parent);
        patch(id, {
          presentation: {
            key: createdId,
            name: presentation.name,
            size: presentation.size,
            slides,
          },
        });
        onCreated?.(id);
        message.success("幻灯片已保存到本机浏览器");
        close();
      } catch (error) {
        if (createdId) void deletePresentation(createdId).catch(() => {});
        message.error(
          error instanceof Error ? error.message : "无法读取此 PPTX 文件",
        );
      } finally {
        setSaving(false);
      }
      return;
    }
    if (action.type === "create" || action.type === "rename") {
      if (!name.trim()) {
        message.warning("请输入名称");
        return;
      }
      if (action.type === "create") {
        const id = add(name.trim(), action.kind, parent);
        onCreated?.(id);
      } else patch(action.file.id, { name: name.trim() });
    } else if (action.type === "move") {
      if (!relocate(action.file.id, parent)) {
        message.warning("无法移动到该位置");
        return;
      }
    } else
      patch(action.file.id, {
        public: shared,
        password: shared ? password : "",
        expires: shared ? expires : "",
      });
    message.success("已保存到本地演示数据");
    close();
  };
  return (
    <Modal
      title={title}
      open
      onCancel={close}
      onOk={save}
      okText={isShare ? "保存设置" : "确定"}
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
              <p className="muted">最多 50 MB · 只读预览 · 保存在本机浏览器</p>
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
      ) : action.type === "move" ? (
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
                    f.space === space && canMove(files, action.file.id, f.id),
                )
                .map((f) => ({ value: f.id, label: entryPath(files, f) })),
            ]}
          />
        </div>
      ) : (
        <>
          <p className="dialog-note">{action.file.name}</p>
          <div
            className="field"
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {shared ? <Globe2 size={18} /> : <LockKeyhole size={18} />}{" "}
              {shared ? "公开 · 通过链接只读访问" : "私有 · 仅空间成员可访问"}
            </span>
            <Switch
              checked={shared}
              onChange={setShared}
              aria-label="公开分享"
            />
          </div>
          {shared && (
            <>
              <div className="field">
                <label>
                  分享密码 <span className="muted">（可选）</span>
                </label>
                <Input.Password
                  value={password}
                  maxLength={64}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="留空表示无需密码"
                />
              </div>
              <div className="field">
                <label>
                  有效期 <span className="muted">（可选）</span>
                </label>
                <input
                  type="datetime-local"
                  value={expires}
                  onChange={(e) => setExpires(e.target.value)}
                  style={{
                    padding: 9,
                    background: "var(--surface)",
                    color: "var(--text)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-sm)",
                  }}
                />
              </div>
              <p className="dialog-note">分享尚未接入，仅保存本地设置。</p>
              <button
                className="secondary-button"
                style={{ marginTop: 12 }}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      `[MinMD 演示分享] ${action.file.name}`,
                    );
                    message.success("已复制演示分享说明");
                  } catch {
                    message.error("复制失败，请检查浏览器权限");
                  }
                }}
              >
                <Copy size={14} />
                复制演示说明
              </button>
            </>
          )}
        </>
      )}
    </Modal>
  );
}
