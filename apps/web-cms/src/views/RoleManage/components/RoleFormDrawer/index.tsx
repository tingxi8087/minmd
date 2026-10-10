import { forwardRef, useImperativeHandle, useState } from "react";
import { Alert, Button, Form, Input, Drawer, Space, message } from "antd";
import { Role as DemoRole } from "@/http/services/management";
import PermissionPicker from "../PermissionPicker";
import styles from "./index.module.less";

/** 保存角色或结束本次编辑。 */
export type RoleFormDrawerEvent =
  { type: "success"; role: DemoRole } | { type: "cancel" | "closed" };
/** 每次打开时传入角色与事件回调。 */
export interface RoleFormDrawerConfig {
  role?: DemoRole;
  scope: "admin" | "app";
  onEvent?: (event: RoleFormDrawerEvent) => void | Promise<void>;
}
/** 角色编辑抽屉的命令式入口。 */
export interface RoleFormDrawerRef {
  /** 打开抽屉并重置表单及回调。 */
  open(config: RoleFormDrawerConfig): void;
}
const RoleFormDrawer = forwardRef<RoleFormDrawerRef, {}>(
  function RoleFormDrawer(_, ref) {
    const [form] = Form.useForm<DemoRole>();
    const [scope, setScope] = useState<"admin" | "app">("admin");
    const [visible, setVisible] = useState(false);
    const [role, setRole] = useState<DemoRole>();
    const [saving, setSaving] = useState(false);
    const [onEventFn, setOnEventFn] = useState<
      NonNullable<RoleFormDrawerConfig["onEvent"]>
    >(() => () => {});
    useImperativeHandle(
      ref,
      () => ({
        open(config) {
          setScope(config.scope);
          setRole(config.role);
          setSaving(false);
          form.resetFields();
          form.setFieldsValue(
            config.role
              ? structuredClone(config.role)
              : { code: "", name: "", description: "", permissions: [] },
          );
          setOnEventFn(() => config.onEvent ?? (() => {}));
          setVisible(true);
        },
      }),
      [form],
    );
    const close = async (type: "cancel" | "closed") => {
      await onEventFn({ type });
      setVisible(false);
    };
    const save = async () => {
      let values: DemoRole;
      try {
        values = await form.validateFields();
      } catch {
        return;
      }
      setSaving(true);
      try {
        await onEventFn({
          type: "success",
          role: {
            ...values,
            scope,
            id: role?.id ?? "",
            members: role?.members ?? 0,
          },
        });
        setVisible(false);
      } catch (error) {
        message.error(error instanceof Error ? error.message : "保存失败");
      } finally {
        setSaving(false);
      }
    };
    return (
      <Drawer
        title={`${role ? "编辑" : "添加"}${scope === "admin" ? "后台" : "前台"}角色`}
        open={visible}
        width={640}
        forceRender
        maskClosable={false}
        closable={!saving}
        onClose={() => void close("closed")}
        footer={
          <Space style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button disabled={saving} onClick={() => void close("cancel")}>
              取消
            </Button>
            <Button type="primary" loading={saving} onClick={() => void save()}>
              保存
            </Button>
          </Space>
        }
      >
        <Form
          form={form}
          layout="vertical"
          className={styles.form}
          disabled={saving}
        >
          <Form.Item
            name="code"
            label="角色标识"
            rules={[
              {
                required: true,
                pattern: /^[a-z][a-z0-9_-]{2,63}$/,
                message: "3–64 位小写字母、数字、下划线或短横线，以字母开头",
              },
            ]}
          >
            <Input maxLength={64} />
          </Form.Item>
          <Form.Item
            name="name"
            label="角色名称"
            rules={[
              { required: true, whitespace: true, message: "请输入角色名称" },
            ]}
          >
            <Input maxLength={30} />
          </Form.Item>
          <Form.Item name="description" label="说明">
            <Input.TextArea rows={2} maxLength={200} />
          </Form.Item>
          <Form.Item name="permissions" label="功能权限">
            <PermissionPicker key={scope} scope={scope} disabled={saving} />
          </Form.Item>
          <Alert
            type="info"
            showIcon
            message="超级管理员身份独立管理，不能通过角色权限授予。"
          />
        </Form>
      </Drawer>
    );
  },
);
export default RoleFormDrawer;
