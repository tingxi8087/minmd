import MediaPreview, { type MediaKind } from "@/views/Media/MediaPreview";
import { useAuth } from "@/store/auth";
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
  useCallback,
} from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Input, Button } from "antd";
import axios from "axios";
import type { JSONContent } from "@tiptap/core";
import type { Sheet } from "@fortune-sheet/core";
import { sharesApi, type PublicShare } from "@/api/shares";
import type { PresentationProjection } from "@/api/assets";
import { errorMessage } from "@/http";
import { ReadonlyPreview } from "@/views/Document/components/VersionHistory";
import { publicDocument } from "./projection";
import "./index.less";
const SharedSpreadsheet = lazy(() => import("./SharedSpreadsheet"));
const SharedPresentation = lazy(() => import("./SharedPresentation"));
export default function Share() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const { status, user, bootstrap } = useAuth();
  const [requiresLogin, setRequiresLogin] = useState(false),
    [entering, setEntering] = useState(false);
  useEffect(() => {
    if (status === "idle") void bootstrap();
  }, [status, bootstrap]);
  const login = () =>
    navigate("/login", { state: { returnTo: `/share/${token}` } });
  const [share, setShare] = useState<PublicShare | null>(null);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setShare(null);
    setLoading(true);
    setLocked(false);
    setError("");
    setRequiresLogin(false);
    void sharesApi
      .public(token, controller.signal, status === "authenticated")
      .then((result) => {
        if (active) setShare(result);
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (
          axios.isAxiosError<{ code: string }>(error) &&
          error.response?.data.code === "SHARE_PASSWORD_REQUIRED"
        )
          setLocked(true);
        else if (
          axios.isAxiosError<{ code: string }>(error) &&
          error.response?.data.code === "SHARE_LOGIN_REQUIRED"
        ) {
          setRequiresLogin(true);
          if (useAuth.getState().status === "authenticated")
            useAuth.getState().clear();
          setError("此分享需要登录后访问");
        } else setError(errorMessage(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [token, reload, status]);
  const document = useMemo(
    () =>
      share?.file.kind === "doc"
        ? publicDocument(
            share.content.projection as JSONContent,
            token,
            status === "authenticated",
          )
        : null,
    [share, token, status],
  );
  const unlock = async () => {
    if (!password || unlocking) return;
    setUnlocking(true);
    setError("");
    try {
      await sharesApi.authenticate(token, password, status === "authenticated");
      setPassword("");
      setReload((value) => value + 1);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setUnlocking(false);
    }
  };
  const authenticatedAsset = useCallback(
    (assetId: string, signal?: AbortSignal) =>
      sharesApi.asset(token, assetId, signal, true),
    [token],
  );
  const projection = share?.content.projection;
  const sheets = Array.isArray(projection)
    ? projection
    : projection && "sheets" in projection
      ? (projection.sheets as Sheet[])
      : [];
  return (
    <main className="public-share">
      <header>
        <strong>minmd</strong>
        <span>{share?.file.name ?? "公开分享"}</span>
        <span className="muted">只读</span>
        {share && ["pdf", "video", "image"].includes(share.file.kind) && (
          <a
            className="secondary-button"
            href={`/api/public/shares/${encodeURIComponent(token)}/assets/${(projection as PresentationProjection).assetId}?download=true`}
            download={share.file.name}
          >
            下载原文件
          </a>
        )}
        {share && user && status === "authenticated" && (
          <Button
            size="small"
            loading={entering}
            onClick={async () => {
              setEntering(true);
              try {
                const result = await sharesApi.accept(token);
                navigate(
                  `${result.kind === "doc" ? "/document/" : "/preview/"}${result.fileId}`,
                );
              } catch (error) {
                if (
                  axios.isAxiosError<{ code: string }>(error) &&
                  error.response?.data.code === "SHARE_PASSWORD_REQUIRED"
                )
                  setLocked(true);
                setError(errorMessage(error));
              } finally {
                setEntering(false);
              }
            }}
          >
            进入文档
          </Button>
        )}
        {!user && (
          <Button size="small" onClick={login}>
            登录
          </Button>
        )}
      </header>
      {loading && (
        <p className="share-message" role="status">
          正在打开分享…
        </p>
      )}
      {locked && (
        <section className="share-unlock">
          <h2>请输入分享密码</h2>
          <Input.Password
            autoFocus
            value={password}
            maxLength={128}
            onChange={(event) => setPassword(event.target.value)}
            onPressEnter={() => void unlock()}
            aria-label="分享密码"
          />
          <button
            className="primary-button"
            disabled={unlocking || !password}
            onClick={() => void unlock()}
          >
            {unlocking ? "正在验证…" : "打开分享"}
          </button>
        </section>
      )}
      {error && (
        <div className="share-message" role="alert">
          {error}
          {requiresLogin ? (
            <Button type="primary" onClick={login}>
              登录后查看
            </Button>
          ) : (
            !locked && (
              <button
                className="secondary-button"
                onClick={() => setReload((value) => value + 1)}
              >
                重试
              </button>
            )
          )}
        </div>
      )}
      {share && (
        <Suspense fallback={<p className="share-message">正在渲染…</p>}>
          {document ? (
            <article className="share-document">
              <h1>{share.file.name}</h1>
              <ReadonlyPreview
                key={`${share.file.id}-${share.content.revision}`}
                projection={document}
                label="公开文档只读正文"
              />
            </article>
          ) : share.file.kind === "sheet" ? (
            <SharedSpreadsheet sheets={sheets} />
          ) : ["pdf", "video", "image"].includes(share.file.kind) ? (
            <div style={{ height: "calc(100dvh - 50px)" }}>
              <MediaPreview
                key={share.file.id}
                kind={share.file.kind as MediaKind}
                name={share.file.name}
                url={`/api/public/shares/${encodeURIComponent(token)}/assets/${(projection as PresentationProjection).assetId}`}
              />
            </div>
          ) : (
            <SharedPresentation
              token={token}
              loadAsset={
                status === "authenticated" ? authenticatedAsset : undefined
              }
              projection={projection as PresentationProjection}
            />
          )}
        </Suspense>
      )}
    </main>
  );
}
