import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Input } from "antd";
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
    void sharesApi
      .public(token, controller.signal)
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
        else setError(errorMessage(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [token, reload]);
  const document = useMemo(
    () =>
      share?.file.kind === "doc"
        ? publicDocument(share.content.projection as JSONContent, token)
        : null,
    [share, token],
  );
  const unlock = async () => {
    if (!password || unlocking) return;
    setUnlocking(true);
    setError("");
    try {
      await sharesApi.authenticate(token, password);
      setPassword("");
      setReload((value) => value + 1);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setUnlocking(false);
    }
  };
  const projection = share?.content.projection;
  const sheets = Array.isArray(projection)
    ? projection
    : projection && "sheets" in projection
      ? (projection.sheets as Sheet[])
      : [];
  return (
    <main className="public-share">
      <header>
        <strong>minmd.</strong>
        <span>{share?.file.name ?? "公开分享"}</span>
        <span className="muted">只读</span>
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
          {!locked && (
            <button
              className="secondary-button"
              onClick={() => setReload((value) => value + 1)}
            >
              重试
            </button>
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
          ) : (
            <SharedPresentation
              token={token}
              projection={projection as PresentationProjection}
            />
          )}
        </Suspense>
      )}
    </main>
  );
}
