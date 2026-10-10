import { Alert, Button, Checkbox, Space, Tag, theme } from "antd";
import { useEffect, useState } from "react";
import {
  getPermissionGroups,
  PermissionGroup,
} from "@/http/services/management";
import styles from "./index.module.less";

/** 受 Form 控制的权限选择器，勾选与计数均由同一份 value 派生。 */
export default function PermissionPicker({
  scope = "admin",
  value = [],
  onChange,
  disabled = false,
}: {
  scope?: "admin" | "app";
  value?: string[];
  onChange?: (value: string[]) => void;
  disabled?: boolean;
}) {
  const [groups, setGroups] = useState<PermissionGroup[]>([]);
  const [error, setError] = useState(false);
  const load = () => {
    setError(false);
    void getPermissionGroups(scope)
      .then((result) => setGroups(result.groups))
      .catch(() => setError(true));
  };
  useEffect(load, [scope]);
  const permissionGroups = groups.map((group) => ({
    key: group.code,
    label: group.name,
    description: "",
    options: group.permissions.map((p) => ({
      value: p.code,
      label: p.name,
      write: p.write,
    })),
  }));
  const permissionOptions = permissionGroups.flatMap((group) => group.options);
  const { token } = theme.useToken();
  const selected = new Set(value);
  const count = permissionOptions.filter((option) =>
    selected.has(option.value),
  ).length;
  const writeCount = permissionOptions.filter(
    (option) => option.write && selected.has(option.value),
  ).length;
  const toggle = (ids: string[], checked: boolean) => {
    const next = new Set(value);
    ids.forEach((id) => (checked ? next.add(id) : next.delete(id)));
    onChange?.([...next]);
  };
  return (
    <div className={styles.picker}>
      {error && (
        <Alert
          type="error"
          message="权限目录加载失败"
          action={<Button onClick={load}>重试</Button>}
        />
      )}
      {!groups.length && !error && (
        <Alert
          type="info"
          message="尚未声明前台业务权限，可先创建无权限角色。"
        />
      )}
      <div className={styles.toolbar}>
        <Space size={8}>
          <Checkbox
            disabled={disabled}
            checked={
              permissionOptions.length > 0 && count === permissionOptions.length
            }
            indeterminate={count > 0 && count < permissionOptions.length}
            onChange={(event) =>
              toggle(
                permissionOptions.map((option) => option.value),
                event.target.checked,
              )
            }
          >
            全选权限
          </Checkbox>
          <span
            className={styles.count}
            style={{ color: token.colorTextSecondary }}
            aria-live="polite"
          >
            已选 {count} / {permissionOptions.length}
          </span>
        </Space>
        <Button
          type="link"
          size="small"
          disabled={disabled || count === 0}
          onClick={() => onChange?.([])}
        >
          清空
        </Button>
      </div>
      <div className={styles.groups}>
        {permissionGroups.map((group) => {
          const ids = group.options.map((option) => option.value);
          const checkedCount = ids.filter((id) => selected.has(id)).length;
          return (
            <section
              key={group.key}
              aria-label={group.label}
              className={styles.group}
              style={{
                borderColor: token.colorBorderSecondary,
                borderRadius: token.borderRadius,
              }}
            >
              <div
                className={styles.header}
                style={{
                  background: token.colorFillAlter,
                  borderColor: token.colorBorderSecondary,
                }}
              >
                <div>
                  <Checkbox
                    disabled={disabled}
                    checked={checkedCount === ids.length}
                    indeterminate={
                      checkedCount > 0 && checkedCount < ids.length
                    }
                    onChange={(event) => toggle(ids, event.target.checked)}
                  >
                    <strong>{group.label}</strong>
                  </Checkbox>
                  <div
                    className={styles.description}
                    style={{ color: token.colorTextSecondary }}
                  >
                    {group.description}
                  </div>
                </div>
                <span
                  className={styles.count}
                  style={{ color: token.colorTextSecondary }}
                >
                  {checkedCount} / {ids.length}
                </span>
              </div>
              <div className={styles.options}>
                {group.options.map((option) => (
                  <Checkbox
                    key={option.value}
                    disabled={disabled}
                    checked={selected.has(option.value)}
                    onChange={(event) =>
                      toggle([option.value], event.target.checked)
                    }
                  >
                    {option.label}
                    {option.write && (
                      <Tag className={styles.writeTag} color="orange">
                        写入
                      </Tag>
                    )}
                  </Checkbox>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      <div
        className={styles.summary}
        style={{ color: token.colorTextSecondary }}
        aria-live="polite"
      >
        {count === 0
          ? "尚未分配权限"
          : `已选择 ${count} 项权限，其中 ${writeCount} 项可修改数据`}
        <span> · 勾选结果保存后生效</span>
      </div>
    </div>
  );
}
