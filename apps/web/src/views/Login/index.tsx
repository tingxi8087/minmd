import { useEffect, useState, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { App, Input } from "antd";
import { ArrowRight } from "lucide-react";
import BrandIcon from "@/components/BrandIcon";
import { useAuth } from "@/store/auth";
import { errorMessage } from "@/http";
import { useWorkspace } from "@/store/workspace";
import { memberReturnState } from "@/utils/memberReturn";
import styles from "./index.module.less";
export default function Login() {
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  const redirecting = useRef(false);
  const returnAfterLogin = async () => {
    if (redirecting.current) return;
    redirecting.current = true;
    const target = memberReturnState(location.state);
    const identity = useAuth.getState().user;
    try {
      await useWorkspace.getState().loadSpaces();
      if (!identity || useAuth.getState().user !== identity) return;
      const workspace = useWorkspace.getState();
      if (
        target.spaceId &&
        workspace.spaces.some((item) => item.id === target.spaceId)
      )
        await workspace.setSpace(target.spaceId);
      if (useAuth.getState().user === identity)
        navigate(target.path, { replace: true });
    } finally {
      redirecting.current = false;
    }
  };
  const { login, status, bootstrap, error } = useAuth();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (status === "idle") void bootstrap();
  }, [status, bootstrap]);
  useEffect(() => {
    if (status === "authenticated")
      void returnAfterLogin().catch((error: unknown) =>
        message.error(errorMessage(error)),
      );
  }, [status, navigate]);
  const { message } = App.useApp();
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <BrandIcon size={32} />
        <div className={styles.brand}>minmd</div>
        <h1>登录</h1>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!account.trim() || !password) {
              message.warning("请输入账号和密码");
              return;
            }
            if (busy) return;
            setBusy(true);
            try {
              await login(account, password);
              await returnAfterLogin();
            } catch (error) {
              message.error(errorMessage(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="field">
            <label htmlFor="account">账号</label>
            <Input
              id="account"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder="请输入账号"
              autoComplete="username"
            />
          </div>
          <div className="field">
            <label htmlFor="password">密码</label>
            <Input.Password
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入密码"
              autoComplete="current-password"
            />
          </div>
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? "登录中…" : "进入空间"} <ArrowRight size={16} />
          </button>
        </form>
        {error && (
          <p role="alert" className={styles.loginNotice}>
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
