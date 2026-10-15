import { desc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "../../../../../system/server/src/database/client";
import type { Transaction } from "../../../../../system/server/src/modules/audit/service";
import { fileContents, fileVersions } from "../../database/schema/contents";

export const FILE_VERSION_LIMIT = 100;

/** 与内容写入使用同一行锁；删除版本只级联释放历史引用，不触碰当前内容和附件原文件。 */
export async function pruneFileVersions(tx: Transaction, fileId: string) {
  await tx
    .select({ id: fileContents.fileId })
    .from(fileContents)
    .where(eq(fileContents.fileId, fileId))
    .for("update");
  let deleted = 0;
  while (true) {
    const excess = await tx
      .select({ id: fileVersions.id })
      .from(fileVersions)
      .where(eq(fileVersions.fileId, fileId))
      .orderBy(
        desc(fileVersions.createdAt),
        desc(fileVersions.epoch),
        desc(fileVersions.revision),
        desc(fileVersions.id),
      )
      .offset(FILE_VERSION_LIMIT)
      .limit(200);
    if (!excess.length) return deleted;
    const removed = await tx
      .delete(fileVersions)
      .where(
        inArray(
          fileVersions.id,
          excess.map((version) => version.id),
        ),
      )
      .returning({ id: fileVersions.id });
    deleted += removed.length;
  }
}

/** 启动时逐文件处理已有超额版本，不加载正文或跨文件持有长事务。 */
export async function pruneExistingFileVersions(database: Database) {
  const candidates = await database.db
    .select({ fileId: fileVersions.fileId })
    .from(fileVersions)
    .groupBy(fileVersions.fileId)
    .having(sql`count(*) > ${FILE_VERSION_LIMIT}`);
  let deleted = 0;
  for (const { fileId } of candidates) {
    deleted += await database.db.transaction((tx) =>
      pruneFileVersions(tx, fileId),
    );
  }
  return { files: candidates.length, deleted };
}
