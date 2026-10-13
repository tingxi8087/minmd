import { forwardRef, useImperativeHandle, useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Drawer,
  Form,
  Input,
  Space,
  message,
} from "antd";
import { type AppUser, type AppUserInput } from "@/http/services/appUsers";
import AvatarUpload from "../AvatarUpload";
/** 保存资料、重置密码或取消。 */
export type UserFormEvent =
  | { type: "save"; id?: string; values: AppUserInput }
  | { type: "password"; id: string; password: string }
  | { type: "cancel" };
export interface UserFormConfig {
  user?: AppUser;
  mode?: "edit" | "password" | "view";
  onEvent?: (event: UserFormEvent) => void | Promise<void>;
}
export interface UserFormRef {
  /** 打开抽屉，重置资料与回调。 */ open(config: UserFormConfig): void;
}
type Values = Omit<AppUserInput, "metadata" | "roles">;
const UserFormDrawer = forwardRef<UserFormRef, {}>(
  function UserFormDrawer(_, ref) {
    const [form] = Form.useForm<Values>();
    const [visible, setVisible] = useState(false);
    const [user, setUser] = useState<AppUser>();
    const [mode, setMode] = useState<"edit" | "password" | "view">("edit");
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [session, setSession] = useState(0);
    const busy = saving || uploading;
    const [onEventFn, setOnEventFn] = useState<
      NonNullable<UserFormConfig["onEvent"]>
    >(() => () => {});
    useImperativeHandle(
      ref,
      () => ({
        open(config) {
          setUser(config.user);
          setMode(config.mode ?? "edit");
          setSaving(false);
          setUploading(false);
          setSession((value) => value + 1);
          setOnEventFn(() => config.onEvent ?? (() => {}));
          form.resetFields();
          form.setFieldsValue({
            account: config.user?.account ?? "",
            nickname: config.user?.nickname ?? "",
            avatar: config.user?.avatar ?? "",
            createDefaultSpace: config.user ? undefined : true,
          });
          setVisible(true);
        },
      }),
      [form],
    );
    const close = async () => {
      if (busy) return;
      await onEventFn({ type: "cancel" });
      setVisible(false);
    };
    const save = async () => {
      if (busy) return;
      let values: Values;
      try {
        values = await form.validateFields();
      } catch {
        return;
      }
      setSaving(true);
      try {
        if (mode === "password") {
          if (!user || !values.password) return;
          await onEventFn({
            type: "password",
            id: user.id,
            password: values.password,
          });
        } else {
          const { createDefaultSpace, ...profile } = values;
          await onEventFn({
            type: "save",
            id: user?.id,
            values: {
              ...profile,
              ...(!user
                ? { createDefaultSpace: createDefaultSpace ?? true }
                : {}),
              metadata: user?.metadata ?? {},
              roles: user?.roles ?? [],
            },
          });
        }
        setVisible(false);
      } catch (error) {
        message.error(error instanceof Error ? error.message : "保存失败");
      } finally {
        setSaving(false);
      }
    };
    return (
      <Drawer
        open={visible}
        forceRender
        width={560}
        title={
          mode === "password"
            ? "重置用户密码"
            : mode === "view"
              ? "用户详情"
              : user
                ? "编辑前台用户"
                : "新建前台用户"
        }
        onClose={() => void close()}
        closable={!busy}
        maskClosable={false}
        footer={
          <Space style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button disabled={busy} onClick={() => void close()}>
              关闭
            </Button>
            {mode !== "view" && (
              <Button
                type="primary"
                loading={saving}
                disabled={uploading}
                onClick={() => void save()}
              >
                保存
              </Button>
            )}
          </Space>
        }
      >
        <Form form={form} layout="vertical" disabled={busy || mode === "view"}>
          {mode === "password" ? (
            <Alert
              type="warning"
              showIcon
              message={`重置 ${user?.account} 的密码后，该用户全部会话将失效。`}
              style={{ marginBottom: 16 }}
            />
          ) : (
            <>
              <Form.Item
                name="account"
                label="登录账号"
                rules={[
                  {
                    required: true,
                    pattern: /^[a-zA-Z][a-zA-Z0-9_]{2,63}$/,
                    message: "3–64 位字母、数字、下划线，以字母开头",
                  },
                ]}
              >
                <Input autoComplete="off" maxLength={64} />
              </Form.Item>
              <Form.Item name="nickname" label="昵称">
                <Input maxLength={64} />
              </Form.Item>
              <Form.Item
                name="avatar"
                label="头像"
                extra={
                  mode === "view"
                    ? undefined
                    : "PNG、JPEG、WebP、GIF，最大1MB；保存资料后生效"
                }
              >
                <AvatarUpload
                  key={session}
                  disabled={saving || mode === "view"}
                  onBusyChange={setUploading}
                />
              </Form.Item>
            </>
          )}
          {(!user || mode === "password") && (
            <Form.Item
              name="password"
              label={mode === "password" ? "新密码" : "初始密码"}
              rules={[
                {
                  required: true,
                  min: 6,
                  max: 128,
                  message: "密码长度为 6–128 位",
                },
              ]}
            >
              <Input.Password autoComplete="new-password" />
            </Form.Item>
          )}
          {!user && mode === "edit" && (
            <Form.Item
              name="createDefaultSpace"
              valuePropName="checked"
              extra="自动创建「昵称的空间」，并放入一篇使用引导文档。"
            >
              <Checkbox>创建默认空间</Checkbox>
            </Form.Item>
          )}
        </Form>
      </Drawer>
    );
  },
);
export default UserFormDrawer;
