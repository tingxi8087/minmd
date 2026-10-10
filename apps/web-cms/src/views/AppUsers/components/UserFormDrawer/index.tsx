import { forwardRef, useImperativeHandle, useState } from "react";
import {
  Alert,
  Button,
  Divider,
  Drawer,
  Form,
  Input,
  Select,
  Space,
  message,
} from "antd";
import {
  getAppRoleOptions,
  type AppUser,
  type AppUserInput,
} from "@/http/services/appUsers";
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
type Values = Omit<AppUserInput, "metadata"> & { metadataText: string };
const UserFormDrawer = forwardRef<UserFormRef, {}>(
  function UserFormDrawer(_, ref) {
    const [form] = Form.useForm<Values>();
    const [visible, setVisible] = useState(false);
    const [user, setUser] = useState<AppUser>();
    const [mode, setMode] = useState<"edit" | "password" | "view">("edit");
    const [saving, setSaving] = useState(false);
    const [roleOptions, setRoleOptions] = useState<
      { value: string; label: string }[]
    >([]);
    const [rolesError, setRolesError] = useState(false);
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
          setRolesError(false);
          setRoleOptions([]);
          setOnEventFn(() => config.onEvent ?? (() => {}));
          form.resetFields();
          form.setFieldsValue({
            account: config.user?.account ?? "",
            nickname: config.user?.nickname ?? "",
            avatar: config.user?.avatar ?? "",
            roles: config.user?.roles ?? [],
            metadataText: JSON.stringify(config.user?.metadata ?? {}, null, 2),
          });
          setVisible(true);
          void getAppRoleOptions()
            .then((result) => setRoleOptions(result.items))
            .catch(() => setRolesError(true));
        },
      }),
      [form],
    );
    const close = async () => {
      if (saving) return;
      await onEventFn({ type: "cancel" });
      setVisible(false);
    };
    const save = async () => {
      if (saving) return;
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
          const { metadataText, ...input } = values;
          await onEventFn({
            type: "save",
            id: user?.id,
            values: { ...input, metadata: JSON.parse(metadataText) },
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
        closable={!saving}
        maskClosable={false}
        footer={
          <Space style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button disabled={saving} onClick={() => void close()}>
              关闭
            </Button>
            {mode !== "view" && (
              <Button
                type="primary"
                loading={saving}
                disabled={mode === "edit" && rolesError}
                onClick={() => void save()}
              >
                保存
              </Button>
            )}
          </Space>
        }
      >
        <Form
          form={form}
          layout="vertical"
          disabled={saving || mode === "view"}
        >
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
                label="头像地址"
                rules={[
                  {
                    pattern: /^(https?:\/\/[^\s]+|\/[^/\s][^\s]*|)$/,
                    message: "请输入 HTTP(S) 地址或站内路径",
                  },
                ]}
              >
                <Input maxLength={1000} placeholder="https:// 或 /public/..." />
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
                  min: 12,
                  max: 128,
                  message: "密码长度为 12–128 位",
                },
              ]}
            >
              <Input.Password autoComplete="new-password" />
            </Form.Item>
          )}
          {mode !== "password" && (
            <>
              <Form.Item name="roles" label="前台角色">
                <Select
                  mode="multiple"
                  options={roleOptions}
                  placeholder="可不分配角色"
                />
              </Form.Item>
              {rolesError && (
                <Alert type="error" message="角色加载失败，请关闭后重试" />
              )}
              <Divider orientation="left">额外资料</Divider>
              <Form.Item
                name="metadataText"
                label="JSON 资料"
                extra="仅保存资料，不用于设置角色、权限或账号状态。"
                rules={[
                  {
                    validator: async (_, value: string) => {
                      try {
                        const data: unknown = JSON.parse(value);
                        if (
                          !data ||
                          typeof data !== "object" ||
                          Array.isArray(data)
                        )
                          throw new Error();
                      } catch {
                        throw new Error("请输入有效的 JSON 对象，例如 {}。");
                      }
                    },
                  },
                ]}
              >
                <Input.TextArea
                  rows={8}
                  spellCheck={false}
                  style={{ fontFamily: "monospace" }}
                />
              </Form.Item>
            </>
          )}
        </Form>
      </Drawer>
    );
  },
);
export default UserFormDrawer;
