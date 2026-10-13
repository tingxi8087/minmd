import { useEffect, useState, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { App, Input } from "antd";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  FileText,
  Table2,
  Presentation,
  Sun,
  Moon,
  Loader2,
} from "lucide-react";
import BrandIcon from "@/components/BrandIcon";
import { useAuth } from "@/store/auth";
import { errorMessage } from "@/http";
import { useWorkspace } from "@/store/workspace";
import { memberReturnState } from "@/utils/memberReturn";
import styles from "./index.module.less";
import { authApi } from "@/api/auth";
export default function Login() {
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [entering, setEntering] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const { theme, setTheme } = useWorkspace();
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
      if (useAuth.getState().user === identity && mounted.current) {
        setEntering(true);
        if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          const duration = getComputedStyle(document.documentElement)
            .getPropertyValue("--login-leave-duration")
            .trim();
          const delay =
            Number.parseFloat(duration) * (duration.endsWith("ms") ? 1 : 1000);
          await new Promise<void>((resolve) =>
            window.setTimeout(resolve, Number.isFinite(delay) ? delay : 0),
          );
        }
        if (mounted.current && useAuth.getState().user === identity)
          navigate(target.path, { replace: true });
        else if (mounted.current) setEntering(false);
      }
    } finally {
      redirecting.current = false;
    }
  };
  const { login, status, bootstrap, error } = useAuth();
  const [busy, setBusy] = useState(false);
  const [setupCheck, setSetupCheck] = useState<"loading" | "ready" | "failed">(
    "loading",
  );
  const [checkAttempt, setCheckAttempt] = useState(0);
  useEffect(() => {
    if (status !== "anonymous") return;
    let active = true;
    setSetupCheck("loading");
    void authApi
      .setupStatus()
      .then((result) => {
        if (!active) return;
        if (result.needsSetup) navigate("/setup", { replace: true });
        else setSetupCheck("ready");
      })
      .catch(() => {
        if (active) setSetupCheck("failed");
      });
    return () => {
      active = false;
    };
  }, [status, checkAttempt, navigate]);
  useEffect(() => {
    if (status === "anonymous") setEntering(false);
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
    <main
      className={`${styles.page} ${busy ? styles.busy : ""} ${entering ? styles.entering : ""}`}
    >
      <button
        className={styles.themeButton}
        aria-label={theme === "light" ? "切换深色主题" : "切换浅色主题"}
        onClick={() => setTheme(theme === "light" ? "dark" : "light")}
      >
        {theme === "light" ? <Moon size={19} /> : <Sun size={19} />}
      </button>
      <div className={styles.shell}>
        <section className={styles.scene} aria-label="MinMD 文档空间">
          <h2>
            把想法，
            <br />
            <span>放进一个空间。</span>
          </h2>
          <div
            className={styles.illustration}
            aria-hidden="true"
            onPointerMove={(event) => {
              if (event.pointerType !== "mouse") return;
              const bounds = event.currentTarget.getBoundingClientRect();
              event.currentTarget.style.setProperty(
                "--pointer-x",
                `${(event.clientX - bounds.left - bounds.width / 2) / 45}px`,
              );
              event.currentTarget.style.setProperty(
                "--pointer-y",
                `${(event.clientY - bounds.top - bounds.height / 2) / 45}px`,
              );
            }}
            onPointerLeave={(event) => {
              event.currentTarget.style.setProperty("--pointer-x", "0px");
              event.currentTarget.style.setProperty("--pointer-y", "0px");
            }}
          >
            <div className={styles.orbit} />
            <svg className={styles.sketch} viewBox="0 0 84 62" fill="none">
              <path d="M5 43C15 5 47 3 53 25c4 18-15 17-18 7-2-10 20-14 41-1M62 21l15 9-14 8" />
            </svg>
            <div className={`${styles.paperWrapper} ${styles.documentWrapper}`}>
              <div className={`${styles.paper} ${styles.documentPaper}`}>
                <div className={styles.paperLabel}>
                  <FileText size={16} /> 灵感笔记 <span>•••</span>
                </div>
                <h3>下一步，做点什么？</h3>
                <p>先记下来，再慢慢实现。</p>
                <div className={styles.inkLines}>
                  <i />
                  <i />
                  <i />
                </div>
                <div className={styles.task}>
                  <span className={styles.tick}>
                    <Check size={13} />
                  </span>{" "}
                  整理一个好想法
                </div>
                <div className={styles.task}>
                  <span className={styles.liveTick}>
                    <Check size={13} />
                  </span>{" "}
                  把计划变成行动
                </div>
              </div>
            </div>
            <div className={`${styles.paperWrapper} ${styles.sheetWrapper}`}>
              <div className={`${styles.paper} ${styles.sheetPaper}`}>
                <div className={styles.paperLabel}>
                  <Table2 size={16} /> 小小计划 <span>•••</span>
                </div>
                <div className={styles.miniGrid}>
                  <span />
                  <span>A</span>
                  <span>B</span>
                  <span>1</span>
                  <strong>想法</strong>
                  <strong>进度</strong>
                  <span>2</span>
                  <b>新的开始</b>
                  <b className={styles.activeCell}>100%</b>
                  <span>3</span>
                  <b>下一步</b>
                  <b>进行中</b>
                </div>
              </div>
            </div>
            <div className={`${styles.paperWrapper} ${styles.slideWrapper}`}>
              <div className={`${styles.paper} ${styles.slidePaper}`}>
                <div className={styles.paperLabel}>
                  <Presentation size={16} /> 分享时刻 <span>01 / 02</span>
                </div>
                <div className={styles.slideBody}>
                  <h3>
                    <span>
                      让好想法
                      <br />
                      发生。
                    </span>
                    <span>
                      简单，也可以
                      <br />
                      完整。
                    </span>
                  </h3>
                  <ArrowUpRight size={44} />
                </div>
                <div className={styles.slideProgress}>
                  <i />
                  <i />
                </div>
              </div>
            </div>
            <span className={styles.spark}>✳</span>
          </div>
        </section>
        <section className={styles.card} aria-label="账号登录">
          <div className={styles.brand}>
            <BrandIcon size={32} />
            <span>minmd</span>
          </div>
          <h1>打开你的空间</h1>
          {setupCheck !== "ready" ? (
            <div role="status" className={styles.loginNotice}>
              {setupCheck === "failed" ? (
                <>
                  <p>无法连接服务器，请重试。</p>
                  <button
                    className="secondary-button"
                    onClick={() => setCheckAttempt((value) => value + 1)}
                  >
                    重新连接
                  </button>
                </>
              ) : (
                "正在准备你的空间…"
              )}
            </div>
          ) : (
            <>
              <form
                className={styles.form}
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!account.trim() || !password) {
                    message.warning("请输入账号和密码");
                    return;
                  }
                  if (busy || entering || redirecting.current) return;
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
                    disabled={busy || entering}
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
                    disabled={busy || entering}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="请输入密码"
                    autoComplete="current-password"
                  />
                </div>
                <button
                  className="primary-button"
                  type="submit"
                  disabled={busy || entering}
                >
                  {busy ? "登录中…" : entering ? "正在进入…" : "进入空间"}{" "}
                  {busy || entering ? (
                    <Loader2 className={styles.loader} size={18} />
                  ) : (
                    <ArrowRight size={18} />
                  )}
                </button>
              </form>
              {error && (
                <p role="alert" className={styles.loginNotice}>
                  {error}
                </p>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
