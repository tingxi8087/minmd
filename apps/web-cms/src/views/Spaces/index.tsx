import { useRef } from "react";
import { Alert, Button, Card, Space, Table, message } from "antd";
import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import Access from "@/components/Access";
import { useBasePageTable } from "@/hooks/useTableHooks";
import { useElementBottomDistance } from "@/hooks/useElementBottomDistance";
import { getSpaces, saveSpace, type ManagedSpace } from "@/http/services/spaces";
import SpaceDrawer, { type SpaceDrawerRef, type SpaceEvent } from "./components/SpaceDrawer";
import MembersDrawer, { type MembersDrawerRef } from "./components/MembersDrawer";
import styles from "./index.module.less";
export default function Spaces() {
  const drawer = useRef<SpaceDrawerRef>(null);
  const membersDrawer = useRef<MembersDrawerRef>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const { distance } = useElementBottomDistance(toolbar);
  const table = useBasePageTable<ManagedSpace, Record<string, never>>({
    defaultPageSize: 10, cachePageSizeKey: "spaces-page-size",
    getTableData: async ({ pageNum, pageSize }) => { const result = await getSpaces({ page: pageNum, pageSize }); return { data: result.items, total: result.total, pageNum: result.page }; },
  });
  const onEvent = async (event: SpaceEvent) => { if (event.type === "cancel") return; await saveSpace(event.values, event.id); table.reloadTable(); message.success("保存成功"); };
  return <div className={styles.page}><Card size="small" className={styles.tableCard}>
    <div ref={toolbar} className={styles.optionsHeader}><Access code="space:update"><Button type="primary" icon={<PlusOutlined />} onClick={() => drawer.current?.open({ onEvent })}>新建空间</Button></Access><Button icon={<ReloadOutlined />} onClick={table.reloadTable}>刷新</Button></div>
    {!!table.error && <Alert type="error" message="空间列表加载失败，请重试" />}
    <Table<ManagedSpace> size="small" rowKey="id" dataSource={table.tableData} loading={table.loading}
      scroll={{ x: 950, y: Math.max(80, Math.floor(distance - 140)) }}
      pagination={{ current: table.pageNum, pageSize: table.pageSize, total: table.total, showSizeChanger: true, onChange: (page, size) => { table.setPageNum(page); table.setPageSize(size); } }}
      columns={[
        { title: "空间名称", dataIndex: "name", width: 170 }, { title: "说明", dataIndex: "description", ellipsis: true },
        { title: "负责人ID", dataIndex: "ownerId", width: 270 }, { title: "创建时间", dataIndex: "createdAt", width: 165, render: (value: string) => dayjs(value).format("YYYY-MM-DD HH:mm") },
        { title: "操作", width: 150, fixed: "right", render: (_, space) => <Space size={0}><Access code="space:update"><Button type="link" size="small" onClick={() => drawer.current?.open({ space, onEvent })}>编辑</Button></Access><Button type="link" size="small" onClick={() => membersDrawer.current?.open({ space, onEvent: () => table.reloadTable() })}>成员</Button></Space> },
      ]} />
  </Card><SpaceDrawer ref={drawer} /><MembersDrawer ref={membersDrawer} /></div>;
}
