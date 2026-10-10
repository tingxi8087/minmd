import { logout } from "@/http/services/auth";
import { authStore } from "@/http/authSession";
import React from "react";
import { UserOutlined } from "@ant-design/icons";
import { Avatar, MenuProps } from "antd";
import { Dropdown, Space } from "antd";
import { useNavigate } from "react-router-dom";
import styles from "./index.module.less";

const PersonMenu: React.FC = () => {
  const navigate = useNavigate();
  const { admin, config } = authStore;
  const items: MenuProps["items"] = [
    {
      key: "1",
      label: "退出登录",
      onClick: async () => {
        await logout();
        navigate("/login", { replace: true });
      },
    },
  ];
  return (
    <div className={styles.personMenu}>
      <Dropdown menu={{ items }} placement="bottom">
        <Space>
          <Avatar className={styles.personAvatar} icon={<UserOutlined />} />
          <span className={styles.personName}>
            {admin?.displayName ?? "未登录"} · {config?.environment}
          </span>
        </Space>
      </Dropdown>
    </div>
  );
};

export default PersonMenu;
