import { Avatar, Badge, Descriptions, Drawer, Space, Tag } from "antd";
import { Student, departmentName, roleName } from "@/mock/userModel";
export default function UserDetailDrawer({ user, onClose }: { user?: Student; onClose: () => void }) {
  return <Drawer title="用户详情" open={!!user} onClose={onClose} width={520}>
    {user && <Space direction="vertical" size={24} style={{ width: "100%" }}>
      <Space><Avatar src={user.avatar} size={56}>{user.name.slice(0, 1)}</Avatar><div><strong>{user.name}</strong><div>{user.account}</div></div></Space>
      <Descriptions column={1} bordered size="small">
        <Descriptions.Item label="用户 ID">{user.id}</Descriptions.Item>
        <Descriptions.Item label="状态"><Badge status={user.status === "enabled" ? "success" : "default"} text={user.status === "enabled" ? "启用" : "停用"} /></Descriptions.Item>
        <Descriptions.Item label="部门">{departmentName(user.department)}</Descriptions.Item>
        <Descriptions.Item label="角色">{user.roles.map(role => <Tag key={role}>{roleName(role)}</Tag>)}</Descriptions.Item>
        <Descriptions.Item label="年龄">{user.age}</Descriptions.Item>
        <Descriptions.Item label="性别">{{ male: "男", female: "女", private: "保密" }[user.gender]}</Descriptions.Item>
        <Descriptions.Item label="生日">{user.birthday || "—"}</Descriptions.Item>
        <Descriptions.Item label="手机号">{user.phone}</Descriptions.Item>
        <Descriptions.Item label="邮箱">{user.email}</Descriptions.Item>
        <Descriptions.Item label="注册日期">{user.createdAt}</Descriptions.Item>
        <Descriptions.Item label="消息通知">{user.notifications ? "开启" : "关闭"}</Descriptions.Item>
        <Descriptions.Item label="兴趣爱好">{user.hobbies.join("、") || "—"}</Descriptions.Item>
        <Descriptions.Item label="描述">{user.des || "—"}</Descriptions.Item>
      </Descriptions>
    </Space>}
  </Drawer>;
}
