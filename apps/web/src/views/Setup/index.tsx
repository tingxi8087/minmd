import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { App, Input, type InputRef } from "antd";
import {
  ArrowRight,
  ArrowLeft,
  Check,
  FileText,
  Folder,
  Loader2,
} from "lucide-react";
import BrandIcon from "@/components/BrandIcon";
import { authApi } from "@/api/auth";
import { useAuth } from "@/store/auth";
import { errorMessage } from "@/http";
import styles from "./index.module.less";
export default function Setup() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const { status, bootstrap, initialize } = useAuth();
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [step, setStep] = useState(1);
  const [account, setAccount] = useState("");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [spaceName, setSpaceName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const active = useRef(true);
  const firstField = useRef<InputRef>(null);
  useEffect(() => {
    if (ready) firstField.current?.focus();
  }, [ready, step]);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (status === "idle") void bootstrap();
    if (status === "authenticated" && !submitting.current)
      navigate("/files", { replace: true });
  }, [status, bootstrap, navigate]);
  useEffect(() => {
    if (status !== "anonymous") return;
    let current = true;
    setLoadError("");
    void authApi
      .setupStatus()
      .then((result) => {
        if (!current) return;
        if (!result.needsSetup) navigate("/login", { replace: true });
        else setReady(true);
      })
      .catch((error: unknown) => {
        if (current) setLoadError(errorMessage(error));
      });
    return () => {
      current = false;
    };
  }, [status, attempt, navigate]);
  const next = () => {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{2,63}$/.test(account.trim()))
      return message.warning("账号为 3–64 位字母、数字或下划线，以字母开头");
    if (password.length < 6 || password.length > 128)
      return message.warning("密码长度为 6–128 位");
    if (password !== confirmation)
      return message.warning("两次输入的密码不一致");
    if (!spaceName)
      setSpaceName(`${nickname.trim() || account.trim().toLowerCase()}的空间`);
    setStep(2);
  };
  const submit = async () => {
    if (submitting.current) return;
    if (!spaceName.trim()) return message.warning("请输入空间名称");
    submitting.current = true;
    setBusy(true);
    try {
      const result = await initialize({
        account: account.trim(),
        nickname: nickname.trim(),
        password,
        spaceName: spaceName.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
      });
      if (active.current)
        navigate(`/document/${result.documentId}`, { replace: true });
    } catch (error) {
      if (!active.current) return;
      message.error(errorMessage(error));
      // 提交结果丢失或会话读取失败时不重复创建账号，转入正常登录恢复。
      try {
        const state = await authApi.setupStatus();
        if (!state.needsSetup && active.current)
          navigate("/login", { replace: true });
      } catch {
        /* 连接失败时保留表单供重试。 */
      }
    } finally {
      submitting.current = false;
      if (active.current) setBusy(false);
    }
  };
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <section className={styles.scene} aria-label="欢迎使用 minmd">
          <div className={styles.brand}>
            <BrandIcon size={30} />
            <span>minmd</span>
          </div>
          <p className={styles.eyebrow}>一个新的开始</p>
          <h1>
            从这里，
            <br />
            <span>留下第一个想法。</span>
          </h1>
          <p className={styles.intro}>
            准备一个账号，一个属于你的空间。
            <br />
            笔记、计划与协作，从此有了落脚点。
          </p>
          <div className={styles.preview} aria-hidden="true">
            <div className={styles.previewHeader}>
              <Folder size={18} />
              <span>{spaceName || "你的空间"}</span>
              <span className={styles.count}>01</span>
            </div>
            <div className={styles.paper}>
              <div className={styles.paperLabel}>
                <FileText size={16} /> 欢迎使用 minmd
              </div>
              <h2>好想法，从一笔开始。</h2>
              <p>先记下来，再慢慢实现。</p>
              <i />
              <i />
              <div className={styles.paperFoot}>
                <Check size={14} /> 已为你准备使用引导
              </div>
            </div>
          </div>
        </section>
        <section className={styles.card} aria-label="首次使用向导">
          <ol className={styles.steps}>
            <li className={step === 1 ? styles.current : styles.done}>
              <span>{step === 2 ? <Check size={13} /> : "1"}</span>创建账号
            </li>
            <li className={step === 2 ? styles.current : ""}>
              <span>2</span>准备空间
            </li>
          </ol>
          {!ready ? (
            <div className={styles.loading} role="status">
              {loadError ? (
                <>
                  <p>{loadError}</p>
                  <button
                    className="secondary-button"
                    onClick={() => setAttempt((value) => value + 1)}
                  >
                    重新连接
                  </button>
                </>
              ) : (
                <>
                  <Loader2 size={20} className={styles.spinner} />
                  正在检查初始化状态…
                </>
              )}
            </div>
          ) : (
            <>
              <h2>{step === 1 ? "先认识一下你" : "给想法一个空间"}</h2>
              <p className={styles.caption}>
                {step === 1
                  ? "创建用于登录 minmd 的第一个账号。"
                  : "你是空间的所有者，之后可以邀请其他成员。"}
              </p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (step === 1) next();
                  else void submit();
                }}
              >
                <fieldset disabled={busy}>
                  {step === 1 ? (
                    <>
                      <div className="field">
                        <label htmlFor="setup-account">登录账号</label>
                        <Input
                          id="setup-account"
                          ref={firstField}
                          value={account}
                          onChange={(e) => setAccount(e.target.value)}
                          maxLength={64}
                          autoComplete="username"
                          placeholder="例如：alex"
                        />
                        <small>3–64 位，以字母开头，可包含数字和下划线</small>
                      </div>
                      <div className="field">
                        <label htmlFor="setup-nickname">
                          昵称 <span>选填</span>
                        </label>
                        <Input
                          id="setup-nickname"
                          value={nickname}
                          onChange={(e) => setNickname(e.target.value)}
                          maxLength={64}
                          autoComplete="nickname"
                          placeholder="希望大家怎么称呼你"
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="setup-password">密码</label>
                        <Input.Password
                          id="setup-password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          maxLength={128}
                          autoComplete="new-password"
                          placeholder="至少 6 位"
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="setup-confirm">确认密码</label>
                        <Input.Password
                          id="setup-confirm"
                          value={confirmation}
                          onChange={(e) => setConfirmation(e.target.value)}
                          maxLength={128}
                          autoComplete="new-password"
                          placeholder="再输入一次密码"
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="field">
                        <label htmlFor="setup-space">空间名称</label>
                        <Input
                          id="setup-space"
                          ref={firstField}
                          value={spaceName}
                          onChange={(e) => setSpaceName(e.target.value)}
                          maxLength={80}
                          placeholder="给你的空间取个名字"
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="setup-description">
                          空间描述 <span>选填</span>
                        </label>
                        <Input.TextArea
                          id="setup-description"
                          value={description}
                          onChange={(e) => setDescription(e.target.value)}
                          maxLength={2000}
                          rows={3}
                          placeholder="这里准备记录些什么？"
                        />
                      </div>
                      <div className={styles.guide}>
                        <FileText size={22} />
                        <div>
                          <strong>欢迎使用 minmd</strong>
                          <p>自动加入一篇引导文档，随时可以编辑或删除。</p>
                        </div>
                      </div>
                    </>
                  )}
                  <div className={styles.footer}>
                    {step === 2 && (
                      <button
                        type="button"
                        className={styles.back}
                        onClick={() => setStep(1)}
                      >
                        <ArrowLeft size={16} />
                        上一步
                      </button>
                    )}
                    <button className="primary-button" type="submit">
                      {busy
                        ? "正在准备空间…"
                        : step === 1
                          ? "下一步"
                          : "创建并进入空间"}
                      {busy ? (
                        <Loader2 size={17} className={styles.spinner} />
                      ) : (
                        <ArrowRight size={17} />
                      )}
                    </button>
                  </div>
                </fieldset>
              </form>
              <p className={styles.note}>首次设置 · 完成后即可开始使用</p>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
