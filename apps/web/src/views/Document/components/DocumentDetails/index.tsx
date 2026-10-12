import { useEffect, useState } from "react";
import { Alert, Modal, Spin } from "antd";
import { FileText, Globe2, LockKeyhole } from "lucide-react";
import { filesApi, type RemoteFile } from "@/api/files";
import { errorMessage } from "@/http";
import styles from "./index.module.less";

const formatTime = (value: string) =>
  new Date(value).toLocaleString("zh-CN", { hour12: false });

export default function DocumentDetails({
  fileId,
  count,
  close,
}: {
  fileId: string;
  count: number;
  close: () => void;
}) {
  const [file, setFile] = useState<RemoteFile>();
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void filesApi
      .get(fileId, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setFile(result);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(reason));
      });
    return () => controller.abort();
  }, [fileId]);

  return (
    <Modal
      open
      title="文档详情"
      width={480}
      onCancel={close}
      footer={
        <button className="secondary-button" onClick={close}>
          关闭
        </button>
      }
    >
      {error ? (
        <Alert type="error" showIcon message={error} />
      ) : !file ? (
        <div className={styles.loading}>
          <Spin aria-label="正在加载文档详情" />
        </div>
      ) : (
        <div className={styles.details}>
          <div className={styles.heading}>
            <span className={styles.icon}>
              <FileText size={24} />
            </span>
            <div>
              <h3>{file.name}</h3>
              <span>文档 · {count.toLocaleString("zh-CN")} 字</span>
            </div>
          </div>
          <dl className={styles.fields}>
            <div>
              <dt>可见性</dt>
              <dd className={styles.visibility}>
                {file.visibility === "public" ? (
                  <Globe2 size={14} />
                ) : (
                  <LockKeyhole size={14} />
                )}
                {file.visibility === "public" ? "公开" : "私有"}
              </dd>
            </div>
            <div>
              <dt>创建者 ID</dt>
              <dd>{file.createdBy}</dd>
            </div>
            <div>
              <dt>创建时间</dt>
              <dd>
                <time dateTime={file.createdAt}>
                  {formatTime(file.createdAt)}
                </time>
              </dd>
            </div>
            <div>
              <dt>更新时间</dt>
              <dd>
                <time dateTime={file.updatedAt}>
                  {formatTime(file.updatedAt)}
                </time>
              </dd>
            </div>
          </dl>
        </div>
      )}
    </Modal>
  );
}
