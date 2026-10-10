import { forwardRef, useImperativeHandle, useState } from "react";
import { Modal } from "antd";
import MarkdownViewer from "@/components/MarkdownViewer";
import styles from "./index.module.less";

/** 当前展示的本地文档。 */
export interface DocumentEntry {
  title: string;
  text: string;
  path: string;
}

/** 文档链接点击和弹窗关闭事件。 */
export type DocumentModalEvent =
  | { type: "link"; href: string }
  | { type: "closed" };

/** 打开文档弹窗所需的数据与事件回调。 */
export interface DocumentModalConfig {
  document: DocumentEntry;
  documents: Record<string, string>;
  onEvent?: (event: DocumentModalEvent) => void | Promise<void>;
}

/** 文档弹窗的调用入口。 */
export interface DocumentModalRef {
  /** 打开文档，重置当前内容并注册本次事件回调。 */
  open(config: DocumentModalConfig): void;
}

const DocumentModal = forwardRef<DocumentModalRef, {}>(function DocumentModal(_, ref) {
  const [visible, setVisible] = useState(false);
  const [document, setDocument] = useState<DocumentEntry>();
  const [documents, setDocuments] = useState<Record<string, string>>({});
  const [onEventFn, setOnEventFn] = useState<NonNullable<DocumentModalConfig["onEvent"]>>(() => () => {});

  useImperativeHandle(ref, () => ({
    open(config) {
      setDocument(config.document);
      setDocuments(config.documents);
      setOnEventFn(() => config.onEvent ?? (() => {}));
      setVisible(true);
    },
  }), []);

  const handleClose = async () => {
    await onEventFn({ type: "closed" });
    setVisible(false);
  };

  const handleLinkClick = (href: string) => {
    void onEventFn({ type: "link", href });
    if (!document || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(href)) return false;
    const path = decodeURIComponent(new URL(href, `https://docs.local/${document.path}`).pathname.slice(1));
    if (!documents[path]) return false;
    const title = documents[path].match(/^#\s+(.+)$/m)?.[1] || path;
    setDocument({ path, title, text: documents[path] });
    return true;
  };

  return <Modal title={document?.title} open={visible} onCancel={handleClose} footer={null} width={840}>
    {document && <div key={document.path} className={styles.document}>
      <MarkdownViewer content={document.text} onLinkClick={handleLinkClick} />
    </div>}
  </Modal>;
});

export default DocumentModal;
