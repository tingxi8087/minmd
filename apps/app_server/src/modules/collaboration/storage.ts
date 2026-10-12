import type { Transaction } from "../../../../../system/server/src/modules/audit/service";
import type { files } from "../../database/schema/files";
import { fileContents, fileVersions } from "../../database/schema/contents";
import { createDocumentState, documentProjection } from "./document-schema";
import * as Y from "yjs";

/** 文件与初始权威状态同事务创建，客户端不再用样例正文初始化房间。 */
export async function initializeFileContent(
  tx: Transaction,
  file: typeof files.$inferSelect,
) {
  if (file.kind === "folder") return;
  const doc = file.kind === "doc" ? createDocumentState() : undefined;
  const projection: Record<string, unknown> = doc
    ? documentProjection(doc)
    : file.kind === "sheet"
      ? {
          sheets: [
            {
              id: crypto.randomUUID(),
              name: "工作表1",
              order: 0,
              status: 1,
              row: 100,
              column: 26,
              celldata: [],
            },
          ],
        }
      : {};
  const documentState = doc ? Buffer.from(Y.encodeStateAsUpdate(doc)) : null;
  doc?.destroy();
  const engine =
    file.kind === "doc" ? "yjs" : file.kind === "sheet" ? "fortune" : "pptx";
  await tx
    .insert(fileContents)
    .values({ fileId: file.id, engine, projection, documentState });
  await tx
    .insert(fileVersions)
    .values({
      fileId: file.id,
      revision: 1,
      epoch: 1,
      source: "initial",
      actorId: file.createdBy,
      projection,
      documentState,
    });
}
