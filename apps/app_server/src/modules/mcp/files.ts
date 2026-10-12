import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { AiFileService } from "../ai/files-service";
const requestId = z
  .string()
  .min(8)
  .max(100)
  .regex(/^[A-Za-z0-9_-]+$/)
  .describe("当前密钥唯一幂等键，重试保持原请求");
const revision = z
  .number()
  .int()
  .min(1)
  .describe("读取文件资料得到的metadataRevision");
const outputSchema = z
  .object({ result: z.record(z.string(), z.unknown()) })
  .strict();
type Runner = (execute: () => Promise<Record<string, unknown>>) => Promise<{
  content: { type: "text"; text: string }[];
  structuredContent?: { result: Record<string, unknown> };
  isError?: boolean;
}>;
export function registerFileTools(
  server: McpServer,
  service: AiFileService,
  token: string,
  run: Runner,
) {
  server.registerTool(
    "read_file_metadata",
    {
      title: "读取文件资料",
      description:
        "需要read权限，读取绑定空间文件的metadataRevision、父目录与回收站删除状态；不返回正文、历史或分享凭证。删除后先读取此元数据再restore_file。",
      inputSchema: z.object({ fileId: z.uuid() }).strict(),
      outputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ fileId }) => run(() => service.readMetadata(token, fileId)),
  );
  const annotations = {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };
  server.registerTool(
    "create_file",
    {
      title: "创建文件或文件夹",
      description:
        "需要create授权，在密钥绑定空间创建私有文档、表格、幻灯片或文件夹。父节点必须是同空间有效文档或文件夹。不创建空间。",
      inputSchema: z
        .object({
          requestId,
          kind: z.enum(["doc", "sheet", "slide", "folder"]),
          name: z.string().min(1).max(200).regex(/\S/),
          parentId: z.uuid().nullable().optional(),
        })
        .strict(),
      outputSchema,
      annotations,
    },
    (input) => run(() => service.create(token, input)),
  );
  server.registerTool(
    "rename_file",
    {
      title: "重命名文件",
      description:
        "需要organize授权。先list_files取得metadataRevision，冲突刷新后用新requestId重试。",
      inputSchema: z
        .object({
          fileId: z.uuid(),
          requestId,
          name: z.string().min(1).max(200).regex(/\S/),
          expectedMetadataRevision: revision,
        })
        .strict(),
      outputSchema,
      annotations,
    },
    ({ fileId, ...input }) => run(() => service.rename(token, fileId, input)),
  );
  server.registerTool(
    "move_file",
    {
      title: "移动或排序文件",
      description:
        "需要organize授权。parentId=null移动到空间根；beforeId指定目标同级节点之前，省略追加末尾。阻止跨空间与循环目录。",
      inputSchema: z
        .object({
          fileId: z.uuid(),
          requestId,
          expectedMetadataRevision: revision,
          parentId: z.uuid().nullable(),
          beforeId: z.uuid().optional(),
        })
        .strict(),
      outputSchema,
      annotations,
    },
    ({ fileId, ...input }) => run(() => service.move(token, fileId, input)),
  );
  server.registerTool(
    "delete_file",
    {
      title: "移入回收站",
      description:
        "需要delete_restore授权。删除指定文件及有效后代，关闭相关协作会话。不会永久删除，可用restore_file恢复。",
      inputSchema: z
        .object({
          fileId: z.uuid(),
          requestId,
          expectedMetadataRevision: revision,
        })
        .strict(),
      outputSchema,
      annotations: { ...annotations, destructiveHint: true },
    },
    ({ fileId, ...input }) => run(() => service.delete(token, fileId, input)),
  );
  server.registerTool(
    "restore_file",
    {
      title: "恢复回收站文件",
      description:
        "需要delete_restore授权。恢复同一删除批次，parentId省略沿用原父节点，null恢复根目录；先读取回收站metadataRevision，已删除原父必须更换有效位置。",
      inputSchema: z
        .object({
          fileId: z.uuid(),
          requestId,
          expectedMetadataRevision: revision,
          parentId: z.uuid().nullable().optional(),
        })
        .strict(),
      outputSchema,
      annotations,
    },
    ({ fileId, ...input }) => run(() => service.restore(token, fileId, input)),
  );
  server.registerTool(
    "upload_asset",
    {
      title: "上传图片附件",
      description:
        "需要upload授权。上传不超过1MB的PNG/JPEG/WebP/GIF，返回私有assetId；插图仍须edit权限。大PPTX原文件请用HTTP POST /api/v1/assets multipart，x-request-id传幂等键，限制50MB。",
      inputSchema: z
        .object({
          requestId,
          filename: z.string().min(1).max(200),
          mime: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
          base64: z
            .string()
            .min(4)
            .max(1398104)
            .regex(/^[A-Za-z0-9+/]+={0,2}$/)
            .describe("原始图片的base64，不包含data:前缀"),
        })
        .strict(),
      outputSchema,
      annotations,
    },
    ({ base64, ...input }) =>
      run(() =>
        service.upload(token, {
          ...input,
          bytes: Buffer.from(base64, "base64"),
        }),
      ),
  );
}
