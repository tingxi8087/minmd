import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../../../../../system/server/src/config/env";
import type { Database } from "../../../../../system/server/src/database/client";
import { AppError } from "../../../../../system/server/src/errors";
import {
  McpServer,
  WebStandardStreamableHTTPServerTransport,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import { Type } from "@sinclair/typebox";
import { loadMinmdConfig } from "../../../../../config/minmd";
import { authorizeAi } from "../api-keys/service";
import type { AiService } from "../ai/service";
import type { DocumentCommand } from "../collaboration/document-commands";
import { aiErrors as errors } from "../ai/schemas";
import { workbookReadSchema, workbookUpdateSchema } from "../ai/workbook";
import { registerFileTools } from "./files";

const blockId = z.string().min(1).max(100).describe("读取结果中的稳定块ID");
const blocks = z
  .array(z.record(z.string(), z.unknown()))
  .min(1)
  .max(100)
  .describe("服务端Schema验证的新内容块");
const operations = z
  .array(
    z.discriminatedUnion("type", [
      z
        .object({
          type: z.literal("replace_text"),
          blockId,
          oldText: z.string().min(1).max(10000),
          newText: z.string().max(10000),
        })
        .strict(),
      z
        .object({
          type: z.literal("insert_blocks"),
          parentBlockId: blockId.nullable().optional(),
          beforeBlockId: blockId.optional(),
          blocks: blocks.optional(),
          markdown: z
            .string()
            .min(1)
            .max(200000)
            .optional()
            .describe("标准Markdown，服务端转换为新稳定ID块"),
        })
        .strict()
        .refine(
          (input) =>
            (input.blocks !== undefined) !== (input.markdown !== undefined),
          "blocks和markdown必须且只能提供一种",
        ),
      z
        .object({
          type: z.literal("replace_block"),
          blockId,
          blocks: blocks.optional(),
          markdown: z
            .string()
            .min(1)
            .max(200000)
            .optional()
            .describe("标准Markdown，仅替换当前指定块"),
        })
        .strict()
        .refine(
          (input) =>
            (input.blocks !== undefined) !== (input.markdown !== undefined),
          "blocks和markdown必须且只能提供一种",
        ),
      z.object({ type: z.literal("delete_block"), blockId }).strict(),
      z
        .object({
          type: z.literal("set_block_type"),
          blockId,
          nodeType: z.string().min(1).max(50),
          attrs: z.record(z.string(), z.unknown()).optional(),
        })
        .strict(),
    ]),
  )
  .min(1)
  .max(100)
  .describe("原子操作批次，失败不部分提交");
const outputSchema = z
  .object({ result: z.record(z.string(), z.unknown()) })
  .strict();

/** Stateless传输不保留授权缓存；每次工具调用与HTTP共用实时授权和业务事务。 */
export async function registerMcp(
  app: FastifyInstance,
  database: Database,
  config: AppConfig,
  service: AiService,
  maxResponseBytes = 2 * 1024 * 1024,
) {
  const settings = loadMinmdConfig(config);
  for (const method of ["GET", "DELETE"] as const)
    app.route({
      method,
      url: "/mcp",
      config: { auth: false },
      schema: {
        tags: ["MCP"],
        summary: "拒绝stateless传输不支持的方法",
        description:
          "MCP使用无会话Streamable HTTP，只允许POST；GET和DELETE明确返回405及Allow。",
        response: { 405: errors[400] },
      },
      handler: (_request, reply) =>
        reply.header("allow", "POST").code(405).send({
          code: "METHOD_NOT_ALLOWED",
          message: "MCP仅支持POST",
          requestId: _request.id,
        }),
    });
  app.post<{ Body: Record<string, unknown> }>(
    "/mcp",
    {
      bodyLimit: 2 * 1024 * 1024,
      config: { auth: false, rateLimit: { max: 60, timeWindow: "1 minute" } },
      schema: {
        tags: ["MCP"],
        summary: "空间AI的Streamable HTTP入口",
        description:
          "官方SDK处理MCP JSON-RPC协议，使用独立Bearer API密钥。工具发现不会授予操作权限，每次调用重新校验空间策略、密钥与创建者资格；不使用Cookie身份。",
        body: Type.Record(Type.String(), Type.Unknown(), {
          description: "MCP JSON-RPC协议消息，由官方SDK校验",
        }),
        response: {
          ...errors,
          429: errors[400],
          200: Type.Record(Type.String(), Type.Unknown(), {
            description: "官方MCP协议响应",
          }),
        },
      },
    },
    async (request, reply) => {
      const allowedHosts = settings.allowedOrigins.map(
        (origin) => new URL(origin).host,
      );
      if (!request.headers.host || !allowedHosts.includes(request.headers.host))
        throw new AppError("HOST_FORBIDDEN", "MCP请求Host不被允许", 403);
      const authorization = request.headers.authorization;
      if (!authorization?.startsWith("Bearer "))
        throw new AppError("API_KEY_REQUIRED", "MCP需要Bearer API密钥", 401);
      if (
        request.headers.origin &&
        !settings.allowedOrigins.includes(request.headers.origin)
      )
        throw new AppError("ORIGIN_FORBIDDEN", "MCP来源不被允许", 403);
      const secret = authorization.slice(7);
      await authorizeAi(database.db, secret);
      const server = new McpServer({
        name: "minmd-mcp-server",
        version: "0.1.0",
      });
      const result = async (
        execute: () => Promise<Record<string, unknown>>,
      ) => {
        try {
          const data = await execute();
          return {
            content: [{ type: "text" as const, text: JSON.stringify(data) }],
            structuredContent: { result: data },
          };
        } catch (error) {
          const message = JSON.stringify(
            error instanceof AppError
              ? { code: error.code, message: error.message, ...error.conflict }
              : { code: "INTERNAL_ERROR", message: "操作失败，请重试" },
          );
          return {
            isError: true,
            content: [{ type: "text" as const, text: message }],
          };
        }
      };
      server.registerTool(
        "read_document",
        {
          title: "读取文档",
          description:
            "读取空间内文档的已持久化修订、epoch及稳定块内容。大文档请指定blockIds分批读取；将revision和epoch用于后续修改。",
          inputSchema: z
            .object({
              fileId: z.uuid().describe("文档UUID"),
              blockIds: z.array(blockId).min(1).max(100).optional(),
            })
            .strict(),
          outputSchema,
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
        },
        ({ fileId, blockIds }) =>
          result(() => service.readDocument(secret, fileId, blockIds)),
      );
      server.registerTool(
        "update_document",
        {
          title: "修改文档",
          description:
            "先read_document获取稳定blockId、revision和epoch，再原子修改指定块。replace_text必须唯一匹配旧文字并保留格式；相同requestId重试返回原结果，冲突时重新读取。成功生成AI历史版本并广播在线页面，不切换epoch。",
          inputSchema: z
            .object({
              fileId: z.uuid().describe("文档UUID"),
              expectedRevision: z.number().int().min(1),
              expectedEpoch: z.number().int().min(1),
              requestId: z
                .string()
                .min(8)
                .max(100)
                .regex(/^[a-zA-Z0-9_-]+$/)
                .describe("当前密钥唯一幂等请求ID"),
              operations,
            })
            .strict(),
          outputSchema,
          annotations: {
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: true,
            openWorldHint: false,
          },
        },
        ({ fileId, ...input }) =>
          result(() =>
            service.updateDocument(secret, fileId, {
              ...input,
              operations: input.operations as DocumentCommand[],
            }),
          ),
      );
      server.registerTool(
        "list_files",
        {
          title: "列出或搜索文件",
          description:
            "读取密钥绑定空间的文件元数据分页。可按名称搜索或父文档/文件夹定位，不授予其他空间、回收站或历史访问。",
          inputSchema: z
            .object({
              page: z.number().int().min(1).optional(),
              pageSize: z.number().int().min(1).max(100).optional(),
              search: z.string().min(1).max(200).optional(),
              parentId: z.uuid().optional(),
            })
            .strict(),
          outputSchema,
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
        },
        (input) => result(() => service.listFiles(secret, input)),
      );
      server.registerTool(
        "read_workbook",
        {
          title: "读取工作簿",
          description:
            "先获取稳定sheetId和revision/epoch，再按0基闭区间读取单元格value与formula。未传sheetId只列工作表；默认范围50行20列，最多2000格，includeFormat按需读取格式。",
          inputSchema: workbookReadSchema.safeExtend({
            fileId: z.uuid().describe("表格UUID"),
          }),
          outputSchema,
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
        },
        ({ fileId, ...query }) =>
          result(() => service.readWorkbook(secret, fileId, query)),
      );
      server.registerTool(
        "update_workbook",
        {
          title: "修改工作簿",
          description:
            "先read_workbook读取revision和epoch，以requestId原子提交set_cells/clear_range/format_range及插删行列、工作表管理。value与formula不能同时指定；未指定格式保留。过期修订409，重新读取后使用新requestId。成功生成AI版本并实时广播。",
          inputSchema: workbookUpdateSchema.safeExtend({
            fileId: z.uuid().describe("表格UUID"),
          }),
          outputSchema,
          annotations: {
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: true,
            openWorldHint: false,
          },
        },
        ({ fileId, ...input }) =>
          result(() => service.updateWorkbook(secret, fileId, input)),
      );
      registerFileTools(server, service.files, secret, result);
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await server.connect(transport);
      try {
        // Fastify已解析请求体。直接使用官方Web传输，避免Node适配器再次drain raw流。
        const headers = new Headers();
        for (const [name, value] of Object.entries(request.headers))
          if (value !== undefined)
            headers.set(name, Array.isArray(value) ? value.join(", ") : value);
        const webRequest = new Request(
          `${request.protocol}://${request.headers.host}/mcp`,
          { method: "POST", headers },
        );
        const response = await transport.handleRequest(webRequest, {
          parsedBody: request.body,
        });
        const reader = response.body?.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        if (reader)
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > maxResponseBytes) {
              await reader.cancel();
              throw new AppError(
                "AI_RESPONSE_TOO_LARGE",
                "MCP响应超过2MB，请缩小查询范围",
                413,
              );
            }
            chunks.push(value);
          }
        const body = Buffer.concat(chunks).toString("utf8");
        for (const [name, value] of response.headers) reply.header(name, value);
        return reply.code(response.status).send(body);
      } finally {
        await server.close();
      }
    },
  );
}
