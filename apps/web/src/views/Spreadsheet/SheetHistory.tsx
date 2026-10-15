import { useMemberNames } from "@/hooks/useMemberNames";
import { useEffect, useState } from "react";
import { App, Button, Drawer, Input, Pagination, Spin } from "antd";
import { Workbook } from "@fortune-sheet/react";
import type { Sheet } from "@fortune-sheet/core";
import type { DocumentVersion } from "@/api/documents";
import { sheetApi } from "@/api/sheets";
import { errorMessage } from "@/http";
import type { Entry } from "@/store/workspace";
import { prepareWorkbook } from "./workbook";
import styles from "./index.module.less";

export default function SheetHistory({
  file,
  open,
  close,
  revision,
  epoch,
  reload,
  checkpoint,
}: {
  file: Entry;
  open: boolean;
  close: () => void;
  revision: number;
  epoch: number;
  reload: () => void;
  checkpoint: () => Promise<unknown>;
}) {
  const { message, modal } = App.useApp();
  const [items, setItems] = useState<DocumentVersion[]>([]);
  const [total, setTotal] = useState(0),
    [page, setPage] = useState(1);
  const [selected, setSelected] = useState<DocumentVersion>(),
    [sheets, setSheets] = useState<Sheet[]>();
  const actorName = useMemberNames(file.space, open);
  const [note, setNote] = useState(""),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!open) return;
    let disposed = false;
    void sheetApi
      .versions(file.id, page)
      .then((result) => {
        if (disposed) return;
        setItems(result.items);
        setTotal(result.total);
        setSelected(
          (previous) =>
            result.items.find((item) => item.id === previous?.id) ??
            result.items[0],
        );
      })
      .catch((error: unknown) => {
        if (!disposed) message.error(errorMessage(error));
      });
    return () => {
      disposed = true;
    };
  }, [open, file.id, page, refresh, message]);
  useEffect(() => {
    if (!open || !selected) return;
    let disposed = false;
    setSheets(undefined);
    setNote(selected.note);
    void sheetApi
      .version(file.id, selected.id)
      .then((result) => {
        if (!disposed) setSheets(prepareWorkbook(result.projection.sheets));
      })
      .catch((error: unknown) => {
        if (!disposed) message.error(errorMessage(error));
      });
    return () => {
      disposed = true;
    };
  }, [open, file.id, selected, message]);
  const run = async (task: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await task();
      setRefresh((value) => value + 1);
    } catch (error) {
      message.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const restore = () => {
    if (!selected) return;
    modal.confirm({
      title: "恢复这个版本？",
      content: "恢复前会保存当前内容，所有在线编辑者将重新载入。",
      okText: "恢复",
      cancelText: "取消",
      onOk: async () => {
        await sheetApi.restore(file.id, selected.id, revision, epoch);
        reload();
        close();
        message.success("已恢复表格版本");
      },
    });
  };
  const labels: Record<string, string> = {
    initial: "初始版本",
    manual: "手动保存",
    auto: "自动保存",
    import: "导入",
    restore: "恢复",
    ai: "AI 修改",
    "before-replace": "替换前备份",
  };
  return (
    <Drawer
      open={open}
      onClose={close}
      title="表格版本历史"
      width="min(1100px, 94vw)"
      destroyOnClose
    >
      <p>最多保留最近 100 个历史版本，超出后自动清理最旧版本。</p>
      <div className={styles.historyActions}>
        <Button loading={busy} onClick={() => void run(checkpoint)}>
          保存当前版本
        </Button>
        <Input
          value={note}
          disabled={!selected || selected.source !== "manual"}
          maxLength={200}
          placeholder="版本备注"
          onChange={(event) => setNote(event.target.value)}
        />
        <Button
          disabled={!selected || selected.source !== "manual"}
          loading={busy}
          onClick={() =>
            selected &&
            void run(() => sheetApi.note(file.id, selected.id, note))
          }
        >
          保存备注
        </Button>
        <Button disabled={!selected || busy} onClick={restore}>
          恢复版本
        </Button>
      </div>
      <div className={styles.historyLayout}>
        <div className={styles.historyList}>
          {items.map((item) => (
            <button
              key={item.id}
              aria-selected={selected?.id === item.id}
              onClick={() => setSelected(item)}
            >
              <strong>{item.note || labels[item.source] || "历史版本"}</strong>
              <span>
                {new Date(item.createdAt).toLocaleString("zh-CN")} ·{" "}
                {actorName(item.actorId)}
                <br />
                {labels[item.source] || "历史版本"} · v{item.revision}
              </span>
            </button>
          ))}
          <Pagination
            simple
            current={page}
            total={total}
            pageSize={30}
            onChange={setPage}
          />
        </div>
        <div className={styles.historyPreview}>
          {sheets ? (
            <Workbook
              key={selected?.id}
              data={sheets}
              lang="zh"
              allowEdit={false}
              forceCalculation={false}
              toolbarItems={[]}
            />
          ) : (
            <Spin />
          )}
        </div>
      </div>
    </Drawer>
  );
}
