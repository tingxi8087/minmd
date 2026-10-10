import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Dropdown,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  Tooltip,
  TreeSelect,
  message,
} from "antd";
import { DownOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";
import { useMemo, useRef, useState } from "react";
import SearchTableForm, { FormFieldConfig } from "@/components/SearchTableForm";
import { useElementBottomDistance } from "@/hooks/useElementBottomDistance";
import { useBasePageTable, useTableChecked } from "@/hooks/useTableHooks";
import {
  addStudentHttp,
  delStudentHttp,
  getStudentHttp,
  setStudentHttp,
  setStudentStatusHttp,
} from "@/mock/mock";
import {
  Student,
  StudentSearchParams,
  departmentTree,
  departmentName,
  roleOptions,
  roleName,
  statusOptions,
} from "@/mock/userModel";
import UserFormModal, {
  UserFormModalEvent,
  UserFormModalRef,
} from "./components/UserFormModal";
import UserDetailDrawer from "./components/UserDetailDrawer";
import styles from "./index.module.less";

const MIN_TABLE_SCROLL_Y = 80;
// 操作栏底部以下的表头、分页、边距和横向滚动条。
const TABLE_SCROLL_OFFSET = 140;
export default function UserCurd() {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const { distance } = useElementBottomDistance(toolbarRef);
  const tableScrollY = Math.max(
    MIN_TABLE_SCROLL_Y,
    Math.floor(distance - TABLE_SCROLL_OFFSET),
  );
  const modalRef = useRef<UserFormModalRef>(null);
  const [detail, setDetail] = useState<Student>();
  const [busy, setBusy] = useState(false);
  const searchFields = useMemo<FormFieldConfig[]>(
    () => [
      { name: "name", label: "姓名", type: "input", placeholder: "请输入姓名" },
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
        name: "department",
        label: "部门",
        type: "custom",
        component: (
          <TreeSelect
            treeData={departmentTree}
            treeDefaultExpandAll
            allowClear
            placeholder="全部部门"
          />
        ),
      },
      {
        name: "roles",
        label: "角色",
        type: "select",
        options: roleOptions,
        itemProps: { mode: "multiple", maxTagCount: "responsive" },
        placeholder: "任一所选角色",
      },
      { name: "registered", label: "注册日期", type: "dateRange", span: 12 },
      {
        name: "ageRange",
        label: "年龄范围",
        type: "numberRange",
        span: 12,
        placeholder: ["最小年龄", "最大年龄"],
        itemProps: { min: 1, max: 120, precision: 0 },
        rules: [
          {
            validator: (_, value) =>
              value?.leftValue != null &&
              value?.rightValue != null &&
              value.leftValue > value.rightValue
                ? Promise.reject(new Error("最小年龄不能大于最大年龄"))
                : Promise.resolve(),
          },
        ],
      },
      {
        name: "id",
        label: "用户 ID",
        type: "inputNumber",
        placeholder: "请输入用户 ID",
        itemProps: { min: 1, precision: 0 },
      },
    ],
    [],
  );
  const table = useBasePageTable<Student, StudentSearchParams>({
    defaultPageSize: 5,
    cachePageSizeKey: "user-curd-page-size",
    getTableData: async (query) => {
      const { data } = await getStudentHttp({
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
    if (event.mode === "add") await addStudentHttp(event.values);
    else {
      if (event.values.id === undefined) throw new Error("缺少用户 ID");
      await setStudentHttp({ ...event.values, id: event.values.id });
    }
    message.success(event.mode === "add" ? "添加用户成功" : "更新成功");
    clearSelection();
    if (event.mode === "add") table.setSearchParams({});
    table.reloadTable();
  };
  const edit = (row: Student) =>
    modalRef.current?.open({
      mode: "edit",
      title: "编辑用户",
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
  const changeStatus = (ids: number[], status: Student["status"]) =>
    run(
      () => setStudentStatusHttp(ids, status),
      status === "enabled" ? "已启用" : "已停用",
    );
  const columns: ColumnsType<Student> = [
    { title: "用户 ID", dataIndex: "id", width: 90, fixed: "left" },
    {
      title: "姓名",
      width: 150,
      fixed: "left",
      render: (_, row) => (
        <Space>
          <Avatar size="small" src={row.avatar}>
            {row.name.slice(0, 1)}
          </Avatar>
          <Button type="link" size="small" onClick={() => setDetail(row)}>
            {row.name}
          </Button>
        </Space>
      ),
    },
    { title: "账号", dataIndex: "account", width: 130 },
    {
      title: "部门",
      width: 115,
      render: (_, row) => departmentName(row.department),
    },
    {
      title: "角色",
      width: 155,
      render: (_, row) =>
        row.roles.map((role) => (
          <Tag key={role} color={role === "admin" ? "purple" : "blue"}>
            {roleName(role)}
          </Tag>
        )),
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
    { title: "年龄", dataIndex: "age", width: 75 },
    { title: "手机号", dataIndex: "phone", width: 140 },
    {
      title: "邮箱",
      dataIndex: "email",
      width: 195,
      ellipsis: { showTitle: false },
      render: (value) => <Tooltip title={value}>{value}</Tooltip>,
    },
    { title: "注册日期", dataIndex: "createdAt", width: 120 },
    {
      title: "描述",
      dataIndex: "des",
      width: 180,
      ellipsis: { showTitle: false },
      render: (value) => <Tooltip title={value}>{value || "—"}</Tooltip>,
    },
    {
      title: "操作",
      width: 160,
      align: "center",
      fixed: "right",
      render: (_, row) => (
        <Space size={0}>
          <Button
            type="link"
            size="small"
            disabled={busy}
            onClick={() => edit(row)}
          >
            编辑
          </Button>
          <Dropdown
            menu={{
              items: [
                { key: "detail", label: "查看详情" },
                { key: "reset", label: "重置密码（演示）" },
                {
                  key: "status",
                  label: row.status === "enabled" ? "停用用户" : "启用用户",
                  disabled: busy,
                },
              ],
              onClick: ({ key }) => {
                if (key === "detail") setDetail(row);
                else if (key === "reset") Modal.confirm({ title: "重置密码（静态演示）", content: "真实功能会撤销全部会话；当前操作不修改账号、密码或数据库。", onOk: () => { message.info("已演示确认流程，未修改密码"); } });
                else
                  Modal.confirm({
                    title: `${row.status === "enabled" ? "停用" : "启用"}${row.name}？`,
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
          <Popconfirm
            title="确认删除该用户？"
            description={`用户：${row.name}`}
            onConfirm={() => run(() => delStudentHttp(row.id), "删除成功")}
            okText="删除"
            cancelText="取消"
          >
            <Button type="link" danger size="small" disabled={busy}>
              删除
            </Button>
          </Popconfirm>
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
            name="user-search"
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
            fieldSettingCacheKey="user-curd-search-fields"
            disabledHideFields={["name"]}
          />
        </Card>
      </div>
      <Card size="small" className={styles.tableCard}>
        <div ref={toolbarRef} className={styles.optionsHeader}>
          <Space wrap>
            <Button
              type="primary"
              icon={<PlusOutlined aria-hidden />}
              onClick={() =>
                modalRef.current?.open({
                  mode: "add",
                  title: "添加用户",
                  okText: "添加",
                  onEvent: onFormEvent,
                })
              }
            >
              添加用户
            </Button>
            <Button
              disabled={!checkedCount || busy || table.loading}
              onClick={() => changeStatus(checkedIds.map(Number), "enabled")}
            >
              批量启用
            </Button>
            <Popconfirm
              title={`停用所选 ${checkedCount} 位用户？`}
              disabled={!checkedCount || busy || table.loading}
              onConfirm={() => changeStatus(checkedIds.map(Number), "disabled")}
            >
              <Button disabled={!checkedCount || busy || table.loading}>
                批量停用
              </Button>
            </Popconfirm>
            <Tag>静态演示 · 刷新恢复</Tag>
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
            message="用户列表加载失败"
            action={<Button onClick={table.reloadTable}>重试</Button>}
          />
        ) : (
          <Table
            rowKey="id"
            columns={columns}
            dataSource={table.tableData}
            loading={table.loading || busy}
            size="small"
            scroll={{ x: 1760, y: tableScrollY }}
            rowSelection={{
              selectedRowKeys: checkedIds,
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
      <UserDetailDrawer user={detail} onClose={() => setDetail(undefined)} />
    </div>
  );
}
