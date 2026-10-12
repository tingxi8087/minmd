import { useEffect, useState } from "react";
import { Button, Pagination } from "antd";
import { useNavigate } from "react-router-dom";
import { fileAccessApi, type Notification } from "@/api/fileAccess";
import { errorMessage } from "@/http";
export default function Notifications() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Notification[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    void fileAccessApi
      .notifications(page)
      .then((result) => {
        if (active) {
          setItems(result.items);
          setTotal(result.total);
          setPage(result.page);
        }
      })
      .catch((error: unknown) => {
        if (active) setError(errorMessage(error));
      });
    return () => {
      active = false;
    };
  }, [page, reload]);
  return (
    <main style={{ padding: "16px 20px", flex: 1, overflow: "auto" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 18 }}>站内通知</h2>
        <Button size="small" onClick={() => setReload((value) => value + 1)}>
          刷新
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
      {!items.length && <p>暂无通知</p>}
      {items.map((item) => (
        <div
          key={item.id}
          style={{
            padding: "10px 0",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span
            style={{
              flex: 1,
              color: item.readAt ? "var(--text-secondary)" : "var(--text)",
            }}
          >
            {item.message}
          </span>
          {item.fileId && (
            <Button
              size="small"
              onClick={async () => {
                try {
                  await fileAccessApi.readNotification(item.id);
                  navigate(`/preview/${item.fileId}`);
                } catch (error) {
                  setError(errorMessage(error));
                }
              }}
            >
              打开文件
            </Button>
          )}
          {!item.readAt && (
            <Button
              size="small"
              onClick={async () => {
                try {
                  await fileAccessApi.readNotification(item.id);
                  setReload((value) => value + 1);
                } catch (error) {
                  setError(errorMessage(error));
                }
              }}
            >
              标为已读
            </Button>
          )}
        </div>
      ))}
      {total > 20 && (
        <Pagination
          style={{ marginTop: 12 }}
          current={page}
          total={total}
          pageSize={20}
          showSizeChanger={false}
          onChange={setPage}
        />
      )}
    </main>
  );
}
