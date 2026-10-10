import { forwardRef, useImperativeHandle, useState, useEffect } from "react";
import { Alert, Button, Form, Input, Modal, Select, message } from "antd";
import { AdminInput, getRoleOptions } from "@/http/services/accounts";
import styles from "./index.module.less";

/** 表单提交或关闭事件。 */
export type UserFormModalEvent =
  | {
      type: "success";
      mode: "add" | "edit";
      values: AdminInput & { id?: string };
    }
  | { type: "cancel" | "closed" };
/** 每次打开时传入账号数据及事件回调。 */
export interface UserFormModalConfig {
  mode: "add" | "edit";
  title?: string;
  okText?: string;
  initialValues?: AdminInput & { id?: string };
  onEvent?: (event: UserFormModalEvent) => void | Promise<void>;
}
/** 管理员账号编辑入口。 */
export interface UserFormModalRef {
  /** 重置表单并打开弹窗。 */
  open(config: UserFormModalConfig): void;
}
const UserFormModal = forwardRef<UserFormModalRef, {}>(
  function UserFormModal(_, ref) {
    const [roleOptions, setRoleOptions] = useState<
      { value: string; label: string }[]
    >([]);
    useEffect(() => {
      void getRoleOptions()
        .then((result) => setRoleOptions(result.items))
        .catch(() => {});
    }, []);
    const [form] = Form.useForm<AdminInput>();
    const [config, setConfig] =
      useState<Omit<UserFormModalConfig, "onEvent">>();
    const [saving, setSaving] = useState(false);
    const [onEventFn, setOnEventFn] = useState<
      NonNullable<UserFormModalConfig["onEvent"]>
    >(() => () => {});
    useImperativeHandle(
      ref,
      () => ({
        open(next) {
          const { onEvent, ...values } = next;
          setConfig(values);
          setSaving(false);
          setOnEventFn(() => onEvent ?? (() => {}));
          form.resetFields();
          form.setFieldsValue(
            next.initialValues
              ? structuredClone(next.initialValues)
              : { name: "", account: "", roles: [] },
          );
        },
      }),
      [form],
    );
    const close = async (type: "cancel" | "closed") => {
      if (saving) return;
      await onEventFn({ type });
      setConfig(undefined);
    };
    const save = async () => {
      if (!config || saving) return;
      let values: AdminInput;
      try {
        values = await form.validateFields();
      } catch {
        return;
      }
      setSaving(true);
      try {
        await onEventFn({
          type: "success",
          mode: config.mode,
          values: { ...values, id: config.initialValues?.id },
        });
        setConfig(undefined);
      } catch (error) {
        message.error(error instanceof Error ? error.message : "保存失败");
      } finally {
        setSaving(false);
      }
    };
    return (
      <Modal
        title={config?.title || "管理员账号"}
        open={!!config}
        width={520}
        forceRender
        maskClosable={false}
        closable={!saving}
        onCancel={() => void close("closed")}
        footer={
          <>
            <Button disabled={saving} onClick={() => void close("cancel")}>
              取消
            </Button>
            <Button type="primary" loading={saving} onClick={() => void save()}>
              {config?.okText || "保存"}
            </Button>
          </>
        }
      >
        <Form
          form={form}
          name="admin-account-editor"
          layout="vertical"
          className={styles.modalForm}
          disabled={saving}
        >
          <Form.Item
            name="account"
            label="账号"
            rules={[
              { required: true, message: "请输入账号" },
              {
                pattern: /^[a-zA-Z][a-zA-Z0-9_]{2,19}$/,
                message: "3–20 位，以字母开头，可含数字和下划线",
              },
            ]}
          >
            <Input maxLength={20} placeholder="例如 dev_zhang" />
          </Form.Item>
          <Form.Item
            name="name"
            label="显示名称"
            rules={[
              { required: true, whitespace: true, message: "请输入显示名称" },
            ]}
          >
            <Input maxLength={30} placeholder="例如 张明" />
          </Form.Item>
          <Form.Item
            name="roles"
            label="角色"
            extra="未分配角色的普通账号没有管理权限"
          >
            <Select
              mode="multiple"
              options={roleOptions}
              placeholder="请选择角色"
            />
          </Form.Item>
          {config?.mode === "add" && (
            <Form.Item
              name="password"
              label="初始密码"
              rules={[
                {
                  required: true,
                  min: 12,
                  max: 128,
                  message: "请输入 12–128 位密码",
                },
              ]}
            >
              <Input.Password autoComplete="new-password" />
            </Form.Item>
          )}

          <Alert
            type="info"
            showIcon
            message="账号用于登录开发控制台，角色控制其访问范围。"
          />
        </Form>
      </Modal>
    );
  },
);
export default UserFormModal;
