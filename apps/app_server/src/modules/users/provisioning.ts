import { sql } from "drizzle-orm";
import type { Database } from "../../../../../system/server/src/database/client";
import type { Transaction } from "../../../../../system/server/src/modules/audit/service";
import { appInstallation, appUsers } from "../../database/schema/users";
import { spaces, spaceMembers } from "../../database/schema/spaces";
import { files } from "../../database/schema/files";
import { initializeFileContent } from "../collaboration/storage";
import type { JSONContent } from "@tiptap/core";

/** 所有账号创建入口共用锁，首次初始化与后台创建、注册不能同时通过空库检查。 */
export async function lockAccountCreation(tx: Transaction) {
  await tx.execute(sql`select pg_advisory_xact_lock(731904204)`);
}
export async function needsSetup(db: Database["db"] | Transaction) {
  const [state] = await db
    .select({ id: appInstallation.id })
    .from(appInstallation)
    .limit(1);
  if (state) return false;
  const [user] = await db.select({ id: appUsers.id }).from(appUsers).limit(1);
  return !user;
}
export async function completeSetup(tx: Transaction) {
  await tx.insert(appInstallation).values({ id: 1 }).onConflictDoNothing();
}
const paragraph = (text: string): JSONContent => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});
const heading = (text: string): JSONContent => ({
  type: "heading",
  attrs: { level: 2 },
  content: [{ type: "text", text }],
});
const welcomeDocument: JSONContent = {
  type: "doc",
  content: [
    paragraph(
      "欢迎来到 minmd。这里是你的第一个空间，把想法记下来，再慢慢实现。你可以自由修改或删除这篇文档。",
    ),
    heading("从一篇文档开始"),
    paragraph(
      "点击正文即可编辑。在空白行输入 /，插入标题、待办、表格、图片、代码块或表情。修改顶部标题就能重命名文档。",
    ),
    paragraph(
      "内容会自动保存，顶部状态图标可查看保存进度。按 Command / Ctrl + S 可以立即保存；版本历史可保存版本和恢复内容。",
    ),
    heading("让文件井井有条"),
    paragraph(
      "使用左侧「空间文件」旁的 ＋ 创建文档、表格或文件夹。拖动文件到文件夹可以整理位置，右键菜单提供移动、收藏和删除等操作。",
    ),
    heading("表格与演示"),
    paragraph(
      "表格支持多工作表、公式、筛选和排序，也能导入和导出 .xlsx 文件。上传 .pptx 文件即可只读查看演示文稿。",
    ),
    heading("邀请别人一起完成"),
    paragraph(
      "在空间设置中添加成员，通过文档右上角「分享」设置只读、编辑和公开访问。未登录访客只能查看；多人打开同一文档或表格可以共同编辑。",
    ),
    heading("按自己的方式工作"),
    paragraph(
      "在空间设置中修改名称和描述，在顶部主题按钮中调整外观。AI 接入支持创建独立权限的空间密钥，并复制 MCP 或 HTTP 接入配置。",
    ),
    paragraph("现在，试着写下你的第一个想法。"),
  ],
};
/** 账号、空间、成员与文档权威状态均由调用方事务提交。 */
export async function createDefaultSpace(
  tx: Transaction,
  user: { id: string; account: string; nickname: string },
  options?: { name: string; description?: string },
) {
  const [space] = await tx
    .insert(spaces)
    .values({
      ownerId: user.id,
      name:
        options?.name.trim() || `${user.nickname.trim() || user.account}的空间`,
      description: options?.description?.trim() ?? "",
    })
    .returning();
  await tx.insert(spaceMembers).values({ spaceId: space!.id, userId: user.id });
  const [file] = await tx
    .insert(files)
    .values({
      spaceId: space!.id,
      createdBy: user.id,
      kind: "doc",
      name: "欢迎使用 minmd",
    })
    .returning();
  await initializeFileContent(tx, file!, welcomeDocument);
  return { spaceId: space!.id, documentId: file!.id };
}
