import { useRef } from "react";
import {
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
import dayjs from "dayjs";
import SearchTableForm, {
  type FormFieldConfig,
} from "@/components/SearchTableForm";
import Access from "@/components/Access";
import { useBasePageTable } from "@/hooks/useTableHooks";
import { useElementBottomDistance } from "@/hooks/useElementBottomDistance";
import {
  getAppUsers,
  saveAppUser,
  userAction,
  type AppUser,
} from "@/http/services/appUsers";
import UserFormDrawer, {
  type UserFormRef,
  type UserFormEvent,
} from "./components/UserFormDrawer";
import styles from "./index.module.less";
const fields: FormFieldConfig[] = [
  {
    name: "keyword",
    label: "账号 / 昵称",
    type: "input",
    placeholder: "搜索账号或昵称",
  },
  {
    name: "status",
    label: "状态",
    type: "select",
    options: [
      { value: "enabled", label: "正常" },
      { value: "disabled", label: "停用" },
    ],
  },
];
export default function AppUsers() {
  const drawer = useRef<UserFormRef>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const { distance } = useElementBottomDistance(toolbar);
  const table = useBasePageTable<
    AppUser,
    { keyword?: string; status?: string }
  >({
    defaultPageSize: 10,
    cachePageSizeKey: "app-users-page-size",
    getTableData: async ({ pageNum, pageSize, searchParams }) => {
      const result = await getAppUsers({
        ...searchParams,
        page: pageNum,
        pageSize,
      });
      return { data: result.items, total: result.total, pageNum: result.page };
    },
  });
  const onEvent = async (event: UserFormEvent) => {
    if (event.type === "cancel") return;
    if (event.type === "save") await saveAppUser(event.values, event.id);
    else await userAction(event.id, "password", { password: event.password });
    table.reloadTable();
    message.success("保存成功");
  };
  const action = async (user: AppUser, type: "status" | "revoke") => {
    await userAction(
      user.id,
      type,
      type === "status"
        ? { status: user.status === "enabled" ? "disabled" : "enabled" }
        : {},
    );
    table.reloadTable();
    message.success("操作成功");
  };
  return (
    <div className={styles.page}>
      <div className={styles.searchCard}>
        <Card size="small">
          <SearchTableForm
            name="app-user-search"
            fields={fields}
            value={table.searchParams}
            onFinish={table.setSearchParams}
            onReset={() => table.setSearchParams({})}
          />
        </Card>
      </div>
      <Card size="small" className={styles.tableCard}>
        <div ref={toolbar} className={styles.optionsHeader}>
          <Space>
            <Access code="app-user:create">
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => drawer.current?.open({ onEvent })}
              >
                新建用户
              </Button>
            </Access>
          </Space>
          <Button icon={<ReloadOutlined />} onClick={table.reloadTable}>
            刷新
          </Button>
        </div>
        {!!table.error && (
          <Alert type="error" message="用户列表加载失败，请重试" />
        )}
        <Table<AppUser>
          size="small"
          rowKey="id"
          dataSource={table.tableData}
          loading={table.loading}
          scroll={{ x: 1150, y: Math.max(80, Math.floor(distance - 140)) }}
          columns={[
            { title: "账号", dataIndex: "account", width: 170 },
            { title: "昵称", dataIndex: "nickname", width: 150 },
            {
              title: "状态",
              dataIndex: "status",
              width: 90,
              render: (status: string) => (
                <Tag color={status === "enabled" ? "green" : "default"}>
                  {status === "enabled" ? "正常" : "停用"}
                </Tag>
              ),
            },
            {
              title: "最近登录",
              dataIndex: "lastLoginAt",
              width: 165,
              render: (value: string | null) =>
                value ? dayjs(value).format("YYYY-MM-DD HH:mm") : "尚未登录",
            },
            {
              title: "创建时间",
              dataIndex: "createdAt",
              width: 165,
              render: (value: string) =>
                dayjs(value).format("YYYY-MM-DD HH:mm"),
            },
            {
              title: "操作",
              width: 360,
              fixed: "right",
              render: (_, user) => (
                <Space size={0}>
                  <Button
                    type="link"
                    size="small"
                    onClick={() => drawer.current?.open({ user, mode: "view" })}
                  >
                    详情
                  </Button>
                  <Access code="app-user:update">
                    <Button
                      type="link"
                      size="small"
                      onClick={() => drawer.current?.open({ user, onEvent })}
                    >
                      编辑
                    </Button>
                  </Access>
                  <Access code="app-user:disable">
                    <Popconfirm
                      title={
                        user.status === "enabled"
                          ? "停用用户并撤销全部会话？"
                          : "启用用户？"
                      }
                      onConfirm={() => action(user, "status")}
                    >
                      <Button
                        type="link"
                        size="small"
                        danger={user.status === "enabled"}
                      >
                        {user.status === "enabled" ? "停用" : "启用"}
                      </Button>
                    </Popconfirm>
                  </Access>
                  <Access code="app-user:reset-password">
                    <Button
                      type="link"
                      size="small"
                      onClick={() =>
                        drawer.current?.open({
                          user,
                          mode: "password",
                          onEvent,
                        })
                      }
                    >
                      重置密码
                    </Button>
                  </Access>
                  <Access code="app-user:revoke">
                    <Popconfirm
                      title="撤销该用户全部登录会话？"
                      onConfirm={() => action(user, "revoke")}
                    >
                      <Button type="link" size="small">
                        强制下线
                      </Button>
                    </Popconfirm>
                  </Access>
                </Space>
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
          onChange={(page) => {
            if (page.current) table.setPageNum(page.current);
            if (page.pageSize) table.setPageSize(page.pageSize);
          }}
        />
      </Card>
      <UserFormDrawer ref={drawer} />
    </div>
  );
}
