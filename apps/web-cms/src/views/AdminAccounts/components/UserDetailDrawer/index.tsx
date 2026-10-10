import { Badge, Descriptions, Drawer, Tag } from "antd";
import { AdminAccount } from "@/http/services/accounts";
export default function UserDetailDrawer({
  user,
  onClose,
  roleName,
}: {
  user?: AdminAccount;
  roleName: (id: string) => string;
  onClose: () => void;
}) {
  return (
    <Drawer title="管理员账号详情" open={!!user} onClose={onClose} width={520}>
      {user && (
        <Descriptions column={1} bordered size="small">
          <Descriptions.Item label="账号">{user.account}</Descriptions.Item>
          <Descriptions.Item label="显示名称">
            {user.isSuperAdmin ? "超级管理员" : user.name}
          </Descriptions.Item>
          <Descriptions.Item label="角色">
            {user.isSuperAdmin ? (
              <>
                <Tag color="purple">超级管理员</Tag>
                拥有全部系统权限，无需分配角色
              </>
            ) : (
              user.roles.map((role) => <Tag key={role}>{roleName(role)}</Tag>)
            )}
          </Descriptions.Item>
          <Descriptions.Item label="状态">
            <Badge
              status={user.status === "enabled" ? "success" : "default"}
              text={user.status === "enabled" ? "启用" : "停用"}
            />
          </Descriptions.Item>
          <Descriptions.Item label="最后登录时间">
            {user.lastLoginAt || "从未登录"}
          </Descriptions.Item>
          <Descriptions.Item label="创建时间">
            {user.createdAt}
          </Descriptions.Item>
        </Descriptions>
      )}
    </Drawer>
  );
}
