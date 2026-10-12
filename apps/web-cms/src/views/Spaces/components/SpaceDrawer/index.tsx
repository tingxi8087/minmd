import { forwardRef, useImperativeHandle, useState } from "react";
import { Alert, Button, Drawer, Form, Input, Select, Space, message } from "antd";
import { getAppUsers } from "@/http/services/appUsers";
import type { ManagedSpace } from "@/http/services/spaces";
export type SpaceEvent = { type: "save"; id?: string; values: { name: string; description: string; ownerId?: string } } | { type: "cancel" };
/** 空间编辑器配置，保存后通知页面刷新。 */
interface Config { space?: ManagedSpace; onEvent?: (event: SpaceEvent) => void | Promise<void> }
export interface SpaceDrawerRef { /** 打开并重置表单及回调。 */ open(config: Config): void }
const SpaceDrawer = forwardRef<SpaceDrawerRef, object>(function SpaceDrawer(_, ref) {
  const [form] = Form.useForm<{ name: string; description: string; ownerId?: string }>();
  const [visible, setVisible] = useState(false);
  const [space, setSpace] = useState<ManagedSpace>();
  const [saving, setSaving] = useState(false);
  const [options, setOptions] = useState<{ label: string; value: string }[]>([]);
  const [error, setError] = useState("");
  const [onEventFn, setOnEventFn] = useState<NonNullable<Config["onEvent"]>>(() => () => {});
  const search = async (keyword: string) => {
    try {
      const result = await getAppUsers({ keyword, status: "enabled", page: 1, pageSize: 20 });
      setOptions(result.items.map((user) => ({ value: user.id, label: `${user.nickname || user.account} (${user.account})` })));
      setError("");
    } catch { setError("账号加载失败，请重试或确认前台用户查看权限"); }
  };
  useImperativeHandle(ref, () => ({ open(config) {
    setSpace(config.space); setSaving(false); setError(""); setOptions([]); form.resetFields();
    form.setFieldsValue({ name: config.space?.name ?? "", description: config.space?.description ?? "" });
    setOnEventFn(() => config.onEvent ?? (() => {})); setVisible(true);
    if (!config.space) void search("");
  } }), [form]);
  const close = async () => { if (!saving) { await onEventFn({ type: "cancel" }); setVisible(false); } };
  const save = async () => {
    if (saving) return;
    let values: { name: string; description: string; ownerId?: string };
    try { values = await form.validateFields(); } catch { return; }
    setSaving(true);
    try { await onEventFn({ type: "save", id: space?.id, values }); setVisible(false); }
    catch { message.error("保存失败，请检查输入和权限后重试"); }
    finally { setSaving(false); }
  };
  return <Drawer title={space ? "编辑空间" : "新建空间"} open={visible} width={480} onClose={() => void close()} maskClosable={!saving} keyboard={!saving} closable={!saving}
    extra={<Space><Button disabled={saving} onClick={() => void close()}>取消</Button><Button type="primary" loading={saving} onClick={() => void save()}>保存</Button></Space>}>
    {error && <Alert type="error" message={error} />}
    <Form form={form} layout="vertical"><Form.Item name="name" label="空间名称" rules={[{ required: true, whitespace: true, message: "请输入空间名称" }]}><Input maxLength={80} /></Form.Item>
      <Form.Item name="description" label="空间说明"><Input.TextArea maxLength={1000} rows={3} /></Form.Item>
      {!space && <Form.Item name="ownerId" label="负责人" rules={[{ required: true, message: "请选择现有前台账号" }]}><Select showSearch filterOption={false} options={options} onSearch={(value) => void search(value)} placeholder="搜索现有前台账号" /></Form.Item>}
    </Form>
  </Drawer>;
});
export default SpaceDrawer;
