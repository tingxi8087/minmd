import Access from "@/components/Access";
import ResetPasswordModal, {
  ResetPasswordModalRef,
} from "./components/ResetPasswordModal";
import { useAccess } from "@/hooks/useAccess";
import {
  Alert,
  Badge,
  Button,
  Card,
  Dropdown,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  message,
} from "antd";
import { DownOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";
import { useEffect, useMemo, useRef, useState } from "react";
import SearchTableForm, { FormFieldConfig } from "@/components/SearchTableForm";
import { useElementBottomDistance } from "@/hooks/useElementBottomDistance";
import { useBasePageTable, useTableChecked } from "@/hooks/useTableHooks";
import {
  addAdminAccount,
  getRoleOptions,
  getAdminAccounts,
  updateAdminAccount,
  setAdminStatus,
} from "@/http/services/accounts";
import {
  AdminAccount,
  AdminSearchParams,
  statusOptions,
} from "@/http/services/accounts";
import UserFormModal, {
  UserFormModalEvent,
  UserFormModalRef,
} from "./components/UserFormModal";
import UserDetailDrawer from "./components/UserDetailDrawer";
import styles from "./index.module.less";

const MIN_TABLE_SCROLL_Y = 80;
// 操作栏底部以下的表头、分页、边距和横向滚动条。
const TABLE_SCROLL_OFFSET = 140;
export default function AdminAccounts() {
  const canCreate = useAccess("user:create");
  const canDisable = useAccess("user:disable");
  const canResetPassword = useAccess("user:reset-password");
  const [roleOptions, setRoleOptions] = useState<
    { value: string; label: string }[]
  >([]);
  useEffect(() => {
    void getRoleOptions()
      .then((result) => setRoleOptions(result.items))
      .catch(() => {});
  }, []);
  const roleName = (id: string) =>
    roleOptions.find((role) => role.value === id)?.label ?? id;
  const toolbarRef = useRef<HTMLDivElement>(null);
  const { distance } = useElementBottomDistance(toolbarRef);
  const tableScrollY = Math.max(
    MIN_TABLE_SCROLL_Y,
    Math.floor(distance - TABLE_SCROLL_OFFSET),
  );
  const resetRef = useRef<ResetPasswordModalRef>(null);
  const modalRef = useRef<UserFormModalRef>(null);
  const [detail, setDetail] = useState<AdminAccount>();
  const [busy, setBusy] = useState(false);
  const searchFields = useMemo<FormFieldConfig[]>(
    () => [
      {
        name: "name",
        label: "显示名称",
        type: "input",
        placeholder: "请输入显示名称",
      },
      {
        name: "account",
        label: "账号",
        type: "input",
        placeholder: "请输入账号",
      },
      {
        name: "status",
        label: "状态",
        type: "select",
        options: statusOptions,
        placeholder: "全部状态",
      },
      {
        name: "roles",
        label: "角色",
        type: "select",
        options: roleOptions,
        itemProps: { mode: "multiple", maxTagCount: "responsive" },
        placeholder: "任一所选角色",
      },
      { name: "registered", label: "创建时间", type: "dateRange", span: 12 },
    ],
    [roleOptions],
  );
  const table = useBasePageTable<AdminAccount, AdminSearchParams>({
    defaultPageSize: 5,
    cachePageSizeKey: "admin-accounts-page-size",
    getTableData: async (query) => {
      const { data } = await getAdminAccounts({
        ...query.searchParams,
        pageNum: query.pageNum,
        pageSize: query.pageSize,
      });
      return {
        data: data.list,
        total: data.total,
        pageNum: data.pageNum,
        pageSize: data.pageSize,
      };
    },
  });
  const { checkedIds, checkedCount, changeChecked } = useTableChecked({
    tableData: table.tableData,
    setTableData: table.setTableData,
    idName: "id",
  });
  const clearSelection = () => changeChecked(checkedIds, false);
  const onFormEvent = async (event: UserFormModalEvent) => {
    if (event.type !== "success") return;
    if (event.mode === "add") await addAdminAccount(event.values);
    else {
      if (event.values.id === undefined) throw new Error("缺少管理员账号 ID");
      await updateAdminAccount({ ...event.values, id: event.values.id });
    }
    message.success(event.mode === "add" ? "添加管理员账号成功" : "更新成功");
    clearSelection();
    if (event.mode === "add") table.setSearchParams({});
    table.reloadTable();
  };
  const edit = (row: AdminAccount) =>
    modalRef.current?.open({
      mode: "edit",
      title: "编辑管理员账号",
      okText: "保存",
      initialValues: row,
      onEvent: onFormEvent,
    });
  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await action();
      message.success(success);
      clearSelection();
      table.reloadTable();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };
  const changeStatus = (ids: string[], status: AdminAccount["status"]) =>
    run(
      () => setAdminStatus(ids, status),
      status === "enabled" ? "已启用" : "已停用",
    );
  const columns: ColumnsType<AdminAccount> = [
    { title: "账号", dataIndex: "account", width: 150, fixed: "left" },
    {
      title: "显示名称",
      width: 130,
      render: (_, row) => (
        <Button type="link" size="small" onClick={() => setDetail(row)}>
          {row.isSuperAdmin ? "超级管理员" : row.name}
        </Button>
      ),
    },
    {
      title: "角色",
      width: 155,
      render: (_, row) =>
        row.isSuperAdmin ? (
          <Tag color="purple">超级管理员</Tag>
        ) : (
          row.roles.map((role) => (
            <Tag key={role} color={role === "admin" ? "purple" : "blue"}>
              {roleName(role)}
            </Tag>
          ))
        ),
    },
    {
      title: "状态",
      width: 95,
      render: (_, row) => (
        <Badge
          status={row.status === "enabled" ? "success" : "default"}
          text={row.status === "enabled" ? "启用" : "停用"}
        />
      ),
    },
    {
      title: "最后登录时间",
      dataIndex: "lastLoginAt",
      width: 180,
      render: (value) => value || "从未登录",
    },
    { title: "创建时间", dataIndex: "createdAt", width: 180 },
    {
      title: "操作",
      width: 160,
      align: "center",
      fixed: "right",
      render: (_, row) => (
        <Space size={0}>
          {!row.isSuperAdmin && (
            <Access code="user:update">
              <Button
                type="link"
                size="small"
                disabled={busy}
                onClick={() => edit(row)}
              >
                编辑
              </Button>
            </Access>
          )}
          <Dropdown
            menu={{
              items: [
                { key: "detail", label: "查看详情" },
                {
                  key: "reset",
                  label: "重置密码",
                  disabled: !canResetPassword,
                },
                {
                  key: "status",
                  label:
                    row.status === "enabled"
                      ? "停用管理员账号"
                      : "启用管理员账号",
                  disabled: busy || !canDisable || row.isSuperAdmin,
                },
              ].filter(
                (item) =>
                  item.key === "detail" ||
                  (item.key === "reset"
                    ? canResetPassword
                    : canDisable && !row.isSuperAdmin),
              ),
              onClick: ({ key }) => {
                if (key === "detail") setDetail(row);
                else if (key === "reset")
                  resetRef.current?.open({
                    id: row.id,
                    account: row.account,
                    onEvent: (event) => {
                      if (event.type === "success")
                        message.success("密码已重置，旧会话已撤销");
                    },
                  });
                else
                  Modal.confirm({
                    title: `${row.status === "enabled" ? "停用" : "启用"}${row.isSuperAdmin ? "超级管理员" : row.name}？`,
                    onOk: () =>
                      changeStatus(
                        [row.id],
                        row.status === "enabled" ? "disabled" : "enabled",
                      ),
                  });
              },
            }}
          >
            <Button type="link" size="small">
              <>
                更多
                <DownOutlined aria-hidden />
              </>
            </Button>
          </Dropdown>
        </Space>
      ),
    },
  ];
  const onTableChange = (p: TablePaginationConfig) => {
    clearSelection();
    if (p.current) table.setPageNum(p.current);
    if (p.pageSize) table.setPageSize(p.pageSize);
  };
  return (
    <div className={styles.page}>
      <div className={styles.searchCard}>
        <Card size="small">
          <SearchTableForm
            name="admin-account-search"
            fields={searchFields}
            value={table.searchParams}
            onFinish={(values) => {
              clearSelection();
              table.setSearchParams(values);
            }}
            onReset={() => {
              clearSelection();
              table.setSearchParams({});
            }}
            enableFieldSetting
            fieldSettingCacheKey="admin-accounts-search-fields"
            disabledHideFields={["name"]}
          />
        </Card>
      </div>
      <Card size="small" className={styles.tableCard}>
        <div ref={toolbarRef} className={styles.optionsHeader}>
          <Space wrap>
            <Access code="user:create">
              <Button
                disabled={!canCreate}
                type="primary"
                icon={<PlusOutlined aria-hidden />}
                onClick={() =>
                  modalRef.current?.open({
                    mode: "add",
                    title: "添加管理员账号",
                    okText: "添加",
                    onEvent: onFormEvent,
                  })
                }
              >
                添加管理员账号
              </Button>
            </Access>
            <Access code="user:disable">
              <Button
                disabled={!checkedCount || busy || table.loading || !canDisable}
                onClick={() => changeStatus(checkedIds.map(String), "enabled")}
              >
                批量启用
              </Button>
              <span>&nbsp;&nbsp;</span>
              <Popconfirm
                title={`停用所选 ${checkedCount} 位管理员账号？`}
                disabled={!checkedCount || busy || table.loading || !canDisable}
                onConfirm={() =>
                  changeStatus(checkedIds.map(String), "disabled")
                }
              >
                <Button
                  disabled={
                    !checkedCount || busy || table.loading || !canDisable
                  }
                >
                  批量停用
                </Button>
              </Popconfirm>
            </Access>

            <span className={styles.selection}>
              已选 {checkedCount} 项 · 仅当前页
            </span>
          </Space>
          <Button
            icon={<ReloadOutlined aria-hidden />}
            disabled={busy}
            onClick={() => {
              clearSelection();
              table.reloadTable();
            }}
          >
            刷新
          </Button>
        </div>
        {table.error ? (
          <Alert
            type="error"
            message="管理员账号列表加载失败"
            action={<Button onClick={table.reloadTable}>重试</Button>}
          />
        ) : (
          <Table
            rowKey="id"
            columns={columns}
            dataSource={table.tableData}
            loading={table.loading || busy}
            size="small"
            scroll={{ x: 1100, y: tableScrollY }}
            rowSelection={{
              selectedRowKeys: checkedIds,
              getCheckboxProps: (row) => ({ disabled: row.isSuperAdmin }),
              onSelect: (row, checked) => changeChecked([row.id], checked),
              onSelectAll: (checked, _rows, changed) =>
                changeChecked(
                  changed.map((row) => row.id),
                  checked,
                ),
            }}
            pagination={{
              current: table.pageNum,
              pageSize: table.pageSize,
              total: table.total,
              pageSizeOptions: [5, 10, 20, 50],
              showSizeChanger: true,
              showTotal: (total) => `共 ${total} 条`,
            }}
            onChange={onTableChange}
          />
        )}
      </Card>
      <UserFormModal ref={modalRef} />
      <ResetPasswordModal ref={resetRef} />
      <UserDetailDrawer
        roleName={roleName}
        user={detail}
        onClose={() => setDetail(undefined)}
      />
    </div>
  );
}
