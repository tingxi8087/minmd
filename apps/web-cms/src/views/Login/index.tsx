import { useState } from "react";
import { login } from "@/http/services/auth";
import { authStore, landingPath } from "@/http/authSession";
import { layoutConfig } from "@/layout/layoutConfig";
import { Form, Input, Button, Alert } from "antd";
import { UserOutlined, LockOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import styles from "./index.module.less";

export default function Login() {
  const { NAV_NAME } = layoutConfig;
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const onFinish = async (values: { username: string; password: string }) => {
    setSaving(true);
    try {
      await login({ account: values.username, password: values.password });
      navigate(landingPath(), { replace: true });
    } catch {
      /* 请求层展示错误，保留表单。 */
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <section className={styles.brandPanel}>
          <div className={styles.brandMark}>
            {NAV_NAME.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <div className={styles.brandName}>{NAV_NAME}</div>
            <div className={styles.brandLine}>Web CMS</div>
          </div>
        </section>

        <section className={styles.formPanel}>
          <div className={styles.formHeader}>
            <h1 className={styles.title}>登录工作台</h1>
            <p className={styles.subTitle}>使用控制台管理员账号登录</p>
          </div>

          {authStore.$.error && (
            <Alert type="error" message={authStore.$.error} />
          )}
          <Form
            name="login"
            onFinish={onFinish}
            autoComplete="off"
            className={styles.form}
          >
            <Form.Item
              name="username"
              rules={[{ required: true, message: "请输入用户名!" }]}
            >
              <Input
                prefix={<UserOutlined />}
                placeholder="用户名"
                size="large"
              />
            </Form.Item>

            <Form.Item
              name="password"
              rules={[{ required: true, message: "请输入密码!" }]}
            >
              <Input.Password
                prefix={<LockOutlined />}
                placeholder="密码"
                size="large"
              />
            </Form.Item>

            <Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                loading={saving}
                block
                size="large"
              >
                登录
              </Button>
            </Form.Item>
          </Form>
        </section>
      </div>
    </div>
  );
}
