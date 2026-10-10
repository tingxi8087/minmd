import Access from "@/components/Access";
import { useRef, useEffect, useState } from "react";
import {
  Tabs,
  Alert,
  Button,
  Card,
  Popconfirm,
  Space,
  Table,
  Tag,
  message,
} from "antd";
import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import SearchTableForm, { FormFieldConfig } from "@/components/SearchTableForm";
import { useBasePageTable } from "@/hooks/useTableHooks";
import { useElementBottomDistance } from "@/hooks/useElementBottomDistance";
import {
  Role as DemoRole,
  getRoles,
  saveRole,
  deleteRole,
  getPermissionGroups,
} from "@/http/services/management";
import { useAccess } from "@/hooks/useAccess";
import RoleFormDrawer, {
  RoleFormDrawerRef,
  RoleFormDrawerEvent,
} from "./components/RoleFormDrawer";
import styles from "./index.module.less";
const fields: FormFieldConfig[] = [
  {
    name: "name",
    label: "角色名称",
    type: "input",
    placeholder: "请输入角色名称",
  },
];
export default function RoleManage() {
  const [scope, setScope] = useState<"admin" | "app">("admin");
  return (
    <div className={styles.page}>
      <Tabs
        activeKey={scope}
        onChange={(key) => setScope(key as "admin" | "app")}
        items={[
          { key: "admin", label: "后台角色" },
          { key: "app", label: "前台角色" },
        ]}
      />
      <RoleList key={scope} scope={scope} />
    </div>
  );
}
function RoleList({ scope }: { scope: "admin" | "app" }) {
  const canManageRoles = useAccess("role:update");
  const [permissionOptions, setPermissionOptions] = useState<
    { value: string; label: string }[]
  >([]);
  useEffect(() => {
    void getPermissionGroups(scope)
      .then(({ groups }) =>
        setPermissionOptions(
          groups.flatMap((group) =>
            group.permissions.map((p) => ({ value: p.code, label: p.name })),
          ),
        ),
      )
      .catch(() => {});
  }, [scope]);
  const modalRef = useRef<RoleFormDrawerRef>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const { distance } = useElementBottomDistance(toolbarRef);
  const table = useBasePageTable<DemoRole, { name?: string }>({
    defaultPageSize: 10,
    cachePageSizeKey: "role-manage-page-size",
    getTableData: async ({ pageNum, pageSize, searchParams }) => {
      const result = await getRoles({
        scope,
        page: pageNum,
        pageSize,
        ...searchParams,
      });
      return { data: result.items, total: result.total, pageNum: result.page };
    },
  });
  const onEvent = async (event: RoleFormDrawerEvent) => {
    if (event.type !== "success") return;
    await saveRole(event.role);
    table.reloadTable();
    message.success("角色已保存");
  };
  return (
    <div className={styles.page}>
      <div className={styles.searchCard}>
        <Card size="small">
          <SearchTableForm
            name="role-search"
            fields={fields}
            value={table.searchParams}
            onFinish={table.setSearchParams}
            onReset={() => table.setSearchParams({})}
            enableFieldSetting
            fieldSettingCacheKey="role-search-fields"
          />
        </Card>
      </div>
      <Card size="small" className={styles.tableCard}>
        <div ref={toolbarRef} className={styles.optionsHeader}>
          <Space>
            <Access code="role:update">
              <Button
                disabled={!canManageRoles}
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => modalRef.current?.open({ scope, onEvent })}
              >
                添加角色
              </Button>
            </Access>
          </Space>
          <Button icon={<ReloadOutlined />} onClick={table.reloadTable}>
            刷新
          </Button>
        </div>
        {table.error ? (
          <Alert type="error" message="列表加载失败" />
        ) : (
          <Table<DemoRole>
            size="small"
            rowKey="id"
            dataSource={table.tableData}
            loading={table.loading}
            scroll={{ x: 900, y: Math.max(80, Math.floor(distance - 140)) }}
            columns={[
              { title: "角色标识", dataIndex: "code", width: 140 },
              { title: "角色名称", dataIndex: "name", width: 140 },
              { title: "说明", dataIndex: "description", width: 230 },
              {
                title: "功能权限",
                dataIndex: "permissions",
                width: 360,
                render: (values: string[]) =>
                  values.map((value) => (
                    <Tag key={value}>
                      {permissionOptions.find((p) => p.value === value)
                        ?.label ?? value}
                    </Tag>
                  )),
              },
              { title: "成员数", dataIndex: "members", width: 90 },
              {
                title: "操作",
                width: 140,
                fixed: "right",
                render: (_, row) => (
                  <Access code="role:update">
                    <Space size={0}>
                      <Button
                        type="link"
                        disabled={!canManageRoles}
                        size="small"
                        onClick={() =>
                          modalRef.current?.open({ scope, role: row, onEvent })
                        }
                      >
                        编辑
                      </Button>
                      <Popconfirm
                        title="删除该角色？"
                        onConfirm={async () => {
                          await deleteRole(row.id);
                          table.reloadTable();
                        }}
                      >
                        <Button
                          type="link"
                          danger
                          size="small"
                          disabled={row.members > 0 || !canManageRoles}
                        >
                          删除
                        </Button>
                      </Popconfirm>
                    </Space>
                  </Access>
                ),
              },
            ]}
            pagination={{
              current: table.pageNum,
              pageSize: table.pageSize,
              total: table.total,
              showSizeChanger: true,
              showTotal: (total) => `共 ${total} 条`,
            }}
            onChange={(p) => {
              if (p.current) table.setPageNum(p.current);
              if (p.pageSize) table.setPageSize(p.pageSize);
            }}
          />
        )}
      </Card>
      <RoleFormDrawer ref={modalRef} />
    </div>
  );
}
