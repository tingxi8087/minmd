import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { App, Input } from "antd";
import { ArrowRight, Leaf } from "lucide-react";
import { useWorkspace } from "@/store/workspace";
import styles from "./index.module.less";
export default function Login() {
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();
  const setLoggedIn = useWorkspace((s) => s.setLoggedIn);
  const { message } = App.useApp();
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <Leaf size={28} />
        <div className={styles.brand}>minmd.</div>
        <h1>登录</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!account.trim() || !password) {
              message.warning("请输入演示账号和密码");
              return;
            }
            setLoggedIn(true);
            navigate("/files");
          }}
        >
          <div className="field">
            <label htmlFor="account">账号</label>
            <Input
              id="account"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder="任意演示账号"
              autoComplete="username"
            />
          </div>
          <div className="field">
            <label htmlFor="password">密码</label>
            <Input.Password
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="任意演示密码"
              autoComplete="current-password"
            />
          </div>
          <button className="primary-button" type="submit">
            进入空间 <ArrowRight size={16} />
          </button>
        </form>
        <p className={styles.loginNotice}>演示登录，不验证或保存密码。</p>
        <button
          className={styles.skip}
          onClick={() => {
            setLoggedIn(true);
            navigate("/files");
          }}
        >
          直接体验演示
        </button>
      </div>
    </main>
  );
}
