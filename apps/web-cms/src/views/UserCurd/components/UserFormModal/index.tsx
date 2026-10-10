import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { Avatar, Button, Checkbox, Col, DatePicker, Divider, Form, Input, InputNumber, Modal, Radio, Row, Select, Switch, TreeSelect, Upload, message } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import dayjs, { Dayjs } from "dayjs";
import { departmentTree, hobbyOptions, roleOptions, UserInput } from "@/mock/userModel";
import styles from "./index.module.less";

export type UserFormModalMode = "add" | "edit";
export type UserFormValues = UserInput & { id?: number };
type FormValues = Omit<UserFormValues, "birthday"> & { birthday?: Dayjs };
export type UserFormModalEvent =
  | { type: "success"; mode: UserFormModalMode; values: UserFormValues; initialValues?: Partial<UserFormValues> }
  | { type: "cancel" | "closed"; mode: UserFormModalMode };
export interface UserFormModalConfig {
  mode: UserFormModalMode; title?: string; okText?: string; cancelText?: string;
  initialValues?: Partial<UserFormValues>;
  onEvent?: (event: UserFormModalEvent) => void | Promise<void>;
}
export interface UserFormModalRef {
  /** 打开新增或编辑弹窗，通过 onEvent 通知调用页面。 */
  open(config: UserFormModalConfig): void;
}
const defaults: Partial<FormValues> = { age: 25, gender: "private", roles: ["viewer"], status: "enabled", notifications: true, hobbies: [], des: "" };

const UserFormModal = forwardRef<UserFormModalRef, {}>(function UserFormModal(_, ref) {
  const [form] = Form.useForm<FormValues>();
  const [config, setConfig] = useState<UserFormModalConfig>();
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const uploadVersion = useRef(0);
  const avatar = Form.useWatch("avatar", form);
  useImperativeHandle(ref, () => ({ open(next) {
    uploadVersion.current++;
    setUploading(false);
    form.resetFields();
    form.setFieldsValue({ ...defaults, ...next.initialValues, birthday: next.initialValues?.birthday ? dayjs(next.initialValues.birthday) : undefined });
    setConfig(next);
  } }), [form]);
  const close = async (type: "cancel" | "closed") => {
    if (saving) return;
    uploadVersion.current++;
    await config?.onEvent?.({ type, mode: config.mode });
    setConfig(undefined);
  };
  const save = async () => {
    if (!config || uploading) return;
    let values: FormValues;
    try { values = await form.validateFields(); } catch { return; }
    setSaving(true);
    try {
      await config.onEvent?.({ type: "success", mode: config.mode, initialValues: config.initialValues,
        values: { ...values, id: config.initialValues?.id, birthday: values.birthday?.format("YYYY-MM-DD") } });
      setConfig(undefined);
    } catch (error) { message.error(error instanceof Error ? error.message : "保存失败，请重试"); }
    finally { setSaving(false); }
  };
  return <Modal title={config?.title || "用户资料"} open={!!config} width={760} forceRender
    maskClosable={false} closable={!saving} onCancel={() => close("closed")}
    footer={<><Button disabled={saving} onClick={() => close("cancel")}>{config?.cancelText || "取消"}</Button><Button type="primary" loading={saving} disabled={uploading} onClick={save}>{config?.okText || "保存"}</Button></>}>
    <Form form={form} name="user-editor" layout="vertical" className={styles.modalForm} disabled={saving}>
      <Divider orientation="left">基础资料</Divider>
      <Row gutter={16}>
        <Col span={12}><Form.Item name="name" label="姓名" rules={[{ required: true, whitespace: true, message: "请输入姓名" }]}><Input maxLength={30} placeholder="请输入姓名" /></Form.Item></Col>
        <Col span={12}><Form.Item name="account" label="账号" rules={[{ required: true, message: "请输入账号" }, { pattern: /^[a-zA-Z][a-zA-Z0-9_]{2,19}$/, message: "3–20 位，以字母开头，可含数字和下划线" }]}><Input maxLength={20} placeholder="例如 zhangsan" /></Form.Item></Col>
        <Col span={12}><Form.Item name="age" label="年龄" rules={[{ required: true, message: "请输入年龄" }]}><InputNumber min={1} max={120} precision={0} style={{ width: "100%" }} /></Form.Item></Col>
        <Col span={12}><Form.Item name="gender" label="性别"><Radio.Group options={[{ label: "男", value: "male" }, { label: "女", value: "female" }, { label: "保密", value: "private" }]} /></Form.Item></Col>
        <Col span={12}><Form.Item name="phone" label="手机号" rules={[{ required: true, message: "请输入手机号" }, { pattern: /^1[3-9]\d{9}$/, message: "请输入有效的 11 位手机号" }]}><Input maxLength={11} placeholder="请输入手机号" /></Form.Item></Col>
        <Col span={12}><Form.Item name="email" label="邮箱" rules={[{ required: true, message: "请输入邮箱" }, { type: "email", message: "请输入有效邮箱" }]}><Input maxLength={100} placeholder="name@example.com" /></Form.Item></Col>
        <Col span={12}><Form.Item name="birthday" label="生日"><DatePicker style={{ width: "100%" }} disabledDate={date => date.isAfter(dayjs(), "day")} /></Form.Item></Col>
        <Col span={12}><Form.Item label="头像" extra="本地预览，支持 JPG / PNG，最大 2 MB">
          <div className={styles.avatarRow}><Avatar src={avatar} size={40} />
            <Upload accept="image/png,image/jpeg" showUploadList={false} disabled={uploading || saving} beforeUpload={file => {
              if (!["image/png", "image/jpeg"].includes(file.type) || file.size > 2 * 1024 * 1024) { message.error("请选择 2 MB 以内的 JPG 或 PNG 图片"); return Upload.LIST_IGNORE; }
              const version = ++uploadVersion.current;
              setUploading(true);
              const reader = new FileReader();
              reader.onload = () => { if (version === uploadVersion.current) { form.setFieldValue("avatar", reader.result); setUploading(false); } };
              reader.onerror = () => { if (version === uploadVersion.current) { message.error("图片读取失败"); setUploading(false); } };
              reader.readAsDataURL(file);
              return false;
            }}><Button icon={<UploadOutlined />} loading={uploading}>选择图片</Button></Upload>
            {avatar && <Button type="link" disabled={uploading} onClick={() => form.setFieldValue("avatar", undefined)}>移除</Button>}
          </div>
        </Form.Item><Form.Item name="avatar" hidden><Input /></Form.Item></Col>
      </Row>
      <Divider orientation="left">组织与状态</Divider>
      <Row gutter={16}>
        <Col span={12}><Form.Item name="department" label="部门" rules={[{ required: true, message: "请选择部门" }]}><TreeSelect treeData={departmentTree} treeDefaultExpandAll placeholder="请选择部门" /></Form.Item></Col>
        <Col span={12}><Form.Item name="roles" label="角色" rules={[{ required: true, type: "array", min: 1, message: "至少选择一个角色" }]}><Select mode="multiple" options={roleOptions} placeholder="请选择角色" /></Form.Item></Col>
        <Col span={12}><Form.Item name="status" label="账号状态"><Radio.Group options={[{ label: "启用", value: "enabled" }, { label: "停用", value: "disabled" }]} /></Form.Item></Col>
        <Col span={12}><Form.Item name="notifications" label="消息通知" valuePropName="checked"><Switch checkedChildren="开" unCheckedChildren="关" /></Form.Item></Col>
      </Row>
      <Divider orientation="left">个人偏好</Divider>
      <Form.Item name="hobbies" label="兴趣爱好"><Checkbox.Group options={hobbyOptions} /></Form.Item>
      <Form.Item name="des" label="描述"><Input.TextArea rows={2} showCount maxLength={200} placeholder="补充用户信息" /></Form.Item>
    </Form>
  </Modal>;
});
export default UserFormModal;
