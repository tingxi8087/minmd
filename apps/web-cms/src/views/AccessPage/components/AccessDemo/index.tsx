import { Button, Card, Space, Tag } from "antd";
import Access from "@/components/Access";
import { hasAccess } from "@/.utils/access";
import { useAccess } from "@/hooks/useAccess";
import styles from "./index.module.less";

export default function AccessDemo() {
  const canCreate = useAccess("admin");
  const canRemove = useAccess("user:remove");

  return (
    <Card size="small" title="按钮级权限示例">
      <div className={styles.demo}>
        <Space>
          <Tag color={canCreate ? "green" : "red"}>admin: {String(canCreate)}</Tag>
          <Tag color={canRemove ? "green" : "red"}>
            user:remove: {String(canRemove)}
          </Tag>
          <Tag color={hasAccess("admin") ? "green" : "red"}>
            hasAccess: {String(hasAccess("admin"))}
          </Tag>
        </Space>

        <div className={styles.actions}>
          <Access code="admin">
            <Button type="primary">有 admin 权限可见</Button>
          </Access>

          <Access code="user:remove" fallback={<Button disabled>无删除权限</Button>}>
            <Button danger>无权限时隐藏</Button>
          </Access>

          <Access code="user:remove" mode="disabled">
            <Button danger>无权限时禁用</Button>
          </Access>
        </div>

        <div className={styles.hint}>
          页面权限和按钮权限共用 accessStore.list，路由 access 可以继续按原方式配置。
        </div>
      </div>
    </Card>
  );
}
