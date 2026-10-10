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
        <h1>给想法，一个空间。</h1>
        <p>登录，继续你的下一页。</p>
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
        <small>
          静态演示 · 不验证账号，不会发送或保存密码。
          <br />
          正式登录后续接入 MAS 用户认证。
        </small>
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
