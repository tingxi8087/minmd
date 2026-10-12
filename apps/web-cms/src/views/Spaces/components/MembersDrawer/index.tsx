import { forwardRef, useImperativeHandle, useState } from "react";
import { Alert, Button, Drawer, Input, Popconfirm, Space, Table, message } from "antd";
import Access from "@/components/Access";
import { useBasePageTable } from "@/hooks/useTableHooks";
import { request } from "@/http";
import { addSpaceMember, getSpaceMembers, removeSpaceMember, transferSpaceOwner, type ManagedMember, type ManagedSpace } from "@/http/services/spaces";
/** 成员变更后通知空间列表刷新。 */
interface Config { space: ManagedSpace; onEvent?: (event: { type: "save" | "cancel" }) => void | Promise<void> }
export interface MembersDrawerRef { /** 打开对应空间的成员管理。 */ open(config: Config): void }
const MembersDrawer = forwardRef<MembersDrawerRef, object>(function MembersDrawer(_, ref) {
  const [visible, setVisible] = useState(false);
  const [space, setSpace] = useState<ManagedSpace>();
  const [account, setAccount] = useState("");
  const [saving, setSaving] = useState(false);
  const [onEventFn, setOnEventFn] = useState<NonNullable<Config["onEvent"]>>(() => () => {});
  const table = useBasePageTable<ManagedMember, Record<string, never>>({ defaultPageSize: 100, deps: [space?.id, visible], getTableData: async ({ pageNum }) => {
    if (!visible || !space) return { data: [], total: 0 };
    const result = await getSpaceMembers(space.id, pageNum);
    return { data: result.items, total: result.total, pageNum: result.page };
  } });
  useImperativeHandle(ref, () => ({ open(config) { setSpace(config.space); setVisible(true); setAccount(""); setSaving(false); table.setPageNum(1); setOnEventFn(() => config.onEvent ?? (() => {})); } }));
  const close = async () => { if (!saving) { await onEventFn({ type: "cancel" }); setVisible(false); } };
  const change = async (fn: () => Promise<unknown>) => {
    if (saving) return;
    setSaving(true);
    try { await fn(); await onEventFn({ type: "save" }); table.reloadTable(); message.success("操作成功"); }
    catch (error) { message.error("操作失败，请检查账号或权限后重试"); throw error; }
    finally { setSaving(false); }
  };
  const add = async () => {
    if (!space || !account.trim()) { message.warning("请输入现有前台账号"); return; }
    await change(async () => {
      const result = await request.get<never, { items: Pick<ManagedMember, "id" | "account">[] }>(`/api/admin/spaces/${space.id}/accounts`, { params: { q: account.trim() } });
      const user = result.items.find((item) => item.account.toLowerCase() === account.trim().toLowerCase());
      if (!user) throw new Error("账号不存在");
      await addSpaceMember(space.id, user.id); setAccount("");
    });
  };
  return <Drawer title={`${space?.name ?? "空间"} · 成员`} open={visible} width={680} onClose={() => void close()} closable={!saving} maskClosable={!saving} keyboard={!saving}>
    <Access code="space:update"><Space style={{ marginBottom: 12 }}><Input aria-label="成员账号" placeholder="现有前台账号" value={account} onChange={(event) => setAccount(event.target.value)} maxLength={64} /><Button loading={saving} onClick={() => { void add().catch(() => {}); }}>添加成员</Button></Space></Access>
    {!!table.error && <Alert type="error" message="成员列表加载失败，请重试" action={<Button onClick={table.reloadTable}>重试</Button>} />}
    <Table<ManagedMember> rowKey="id" size="small" loading={table.loading} dataSource={table.tableData} scroll={{ x: 520 }} pagination={{ current: table.pageNum, pageSize: 100, total: table.total, showSizeChanger: false, onChange: table.setPageNum }} columns={[
      { title: "账号", dataIndex: "account" }, { title: "昵称", dataIndex: "nickname" }, { title: "角色", dataIndex: "role", render: (role: string) => role === "owner" ? "负责人" : "成员" },
      { title: "操作", width: 190, render: (_, member) => member.role === "owner" ? null : <Access code="space:update"><Space size={0}>
        <Popconfirm title="将空间负责人转移给此成员？" onConfirm={() => change(() => space ? transferSpaceOwner(space.id, member.id) : Promise.reject(new Error("空间已关闭")))}><Button type="link" size="small" disabled={saving}>转移负责人</Button></Popconfirm>
        <Popconfirm title="移除空间成员？" onConfirm={() => change(() => space ? removeSpaceMember(space.id, member.id) : Promise.reject(new Error("空间已关闭")))}><Button type="link" size="small" danger disabled={saving}>移除</Button></Popconfirm>
      </Space></Access> },
    ]} />
  </Drawer>;
});
export default MembersDrawer;
