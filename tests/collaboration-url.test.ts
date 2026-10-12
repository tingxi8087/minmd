import { expect, test } from "bun:test";
import { collaborationUrl } from "../apps/web/src/utils/collaborationUrl";

test("文档和表格协作跟随当前网页来源，支持开发反代和 HTTPS", () => {
  for (const kind of ["documents", "sheets"]) {
    const path = `/api/app/collaboration/${kind}/test-file`;
    expect(collaborationUrl(path, "http://127.0.0.1:19821")).toBe(
      `ws://127.0.0.1:19821${path}`,
    );
    expect(collaborationUrl(path, "https://minmd.example.com")).toBe(
      `wss://minmd.example.com${path}`,
    );
  }
});
