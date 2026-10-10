import { forwardRef, useImperativeHandle, useState } from "react";
import { Alert, Form, Input, Modal } from "antd";
import { resetAdminPassword } from "@/http/services/accounts";
import { authStore, clearSession } from "@/http/authSession";
/** 密码重置交互事件。 */
export type ResetPasswordModalEvent = { type: "success" } | { type: "closed" };
/** 每次打开时指定账号及回调。 */
export interface ResetPasswordModalConfig {
  id: string;
  account: string;
  onEvent?: (event: ResetPasswordModalEvent) => void | Promise<void>;
}
/** 密码重置入口。 */
export interface ResetPasswordModalRef {
  /** 打开并清空密码输入。 */ open(config: ResetPasswordModalConfig): void;
}
const ResetPasswordModal = forwardRef<ResetPasswordModalRef, {}>(
  function ResetPasswordModal(_, ref) {
    const [form] = Form.useForm<{ password: string; confirm: string }>();
    const [config, setConfig] =
      useState<Omit<ResetPasswordModalConfig, "onEvent">>();
    const [saving, setSaving] = useState(false);
    const [onEventFn, setOnEventFn] = useState<
      NonNullable<ResetPasswordModalConfig["onEvent"]>
    >(() => () => {});
    useImperativeHandle(
      ref,
      () => ({
        open(next) {
          const { onEvent, ...data } = next;
          setConfig(data);
          setSaving(false);
          form.resetFields();
          setOnEventFn(() => onEvent ?? (() => {}));
        },
      }),
      [form],
    );
    const save = async () => {
      if (!config || saving) return;
      let values: { password: string };
      try {
        values = await form.validateFields();
      } catch {
        return;
      }
      setSaving(true);
      try {
        await resetAdminPassword(config.id, values.password);
        await onEventFn({ type: "success" });
        setConfig(undefined);
        form.resetFields();
        if (config.id === authStore.$.admin?.id) {
          clearSession();
          window.location.hash = "/login";
        }
      } catch {
        /* HTTP 层显示错误，保留表单。 */
      } finally {
        setSaving(false);
      }
    };
    return (
      <Modal
        title={`重置密码 · ${config?.account ?? ""}`}
        open={!!config}
        forceRender
        confirmLoading={saving}
        maskClosable={false}
        closable={!saving}
        cancelButtonProps={{ disabled: saving }}
        onOk={() => void save()}
        onCancel={async () => {
          await onEventFn({ type: "closed" });
          setConfig(undefined);
          form.resetFields();
        }}
      >
        <Alert
          type="warning"
          showIcon
          message="保存后立即撤销该账号的全部登录会话。"
        />
        <Form
          form={form}
          layout="vertical"
          disabled={saving}
          style={{ marginTop: 16 }}
        >
          <Form.Item
            name="password"
            label="新密码"
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
          <Form.Item
            name="confirm"
            label="确认密码"
            dependencies={["password"]}
            rules={[
              { required: true },
              ({ getFieldValue }) => ({
                validator: (_, value) =>
                  value === getFieldValue("password")
                    ? Promise.resolve()
                    : Promise.reject(new Error("两次密码不一致")),
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
    );
  },
);

export default ResetPasswordModal;
