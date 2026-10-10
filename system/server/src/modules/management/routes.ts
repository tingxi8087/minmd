import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "@sinclair/typebox";
import {
  and,
  eq,
  inArray,
  ilike,
  gte,
  lte,
  count,
  desc,
  sql,
} from "drizzle-orm";
import type { Database } from "../../database/client";
import type { AppConfig } from "../../config/env";
import {
  admins,
  adminRoles,
  roles,
  rolePermissions,
  sessions,
} from "../../database/schema/system";
import {
  codesFor,
  type PermissionCatalog,
  type RoleScope,
  type RoleMembership,
} from "../permissions/registry";
import { hashPassword } from "../auth/password";
import { writeAudit, type Transaction } from "../audit/service";
import { AppError } from "../../errors";
const uuid = Type.String({ format: "uuid" });
const ids = Type.Array(uuid, { uniqueItems: true, maxItems: 50 });
const text = (maxLength: number) => Type.String({ minLength: 1, maxLength });
const params = Type.Object({
  id: {
    ...uuid,
    description: "记录 ID；操作已有记录时请替换为实际 ID",
    example: "00000000-0000-4000-8000-000000000001",
  },
});
const status = Type.Union([Type.Literal("enabled"), Type.Literal("disabled")]);
const ok = {
  200: Type.Object({
    ok: Type.Boolean({ description: "操作是否成功", example: true }),
  }),
};
const scopeSchema = Type.Union([Type.Literal("admin"), Type.Literal("app")], {
  description: "角色归属：admin 后台 / app 前台",
});
const scopeQuery = Type.Object({ scope: Type.Optional(scopeSchema) });
const roleSchema = Type.Object({
  scope: scopeSchema,
  id: {
    ...uuid,
    description: "记录 ID；操作已有记录时请替换为实际 ID",
    example: "00000000-0000-4000-8000-000000000001",
  },
  code: { ...text(64), description: "稳定标识", example: "demo_role" },
  name: { ...text(64), description: "角色名称", example: "只读角色" },
  description: Type.String({
    description: "用途或补充说明",
    example: "仅用于示例",
  }),
  permissions: Type.Array(Type.String(), {
    description: "权限标识列表",
    example: ["user:read"],
  }),
  members: Type.Number({ description: "关联的后台用户数量", example: 0 }),
});
const adminSchema = Type.Object({
  id: {
    ...uuid,
    description: "记录 ID；操作已有记录时请替换为实际 ID",
    example: "00000000-0000-4000-8000-000000000001",
  },
  account: {
    ...text(64),
    description: "后台用户登录账号",
    example: "demo_admin",
  },
  displayName: {
    ...text(64),
    description: "后台用户显示名称",
    example: "演示管理员",
  },
  status: {
    ...status,
    description: "账号状态：enabled 启用，disabled 停用",
    example: "enabled",
  },
  isSuperAdmin: Type.Boolean({ description: "是否超级管理员", example: false }),
  roles: Type.Array(uuid, {
    description: "关联角色 ID 列表",
    example: ["00000000-0000-4000-8000-000000000001"],
  }),
  lastLoginAt: Type.Union([Type.String(), Type.Null()], {
    description: "最后登录时间；尚未登录为 null",
  }),
  createdAt: Type.String({
    description: "创建时间（ISO 8601）",
    example: "2026-09-19T00:00:00.000Z",
  }),
});
const roleInput = Type.Object(
  {
    scope: Type.Optional(scopeSchema),
    code: Type.String({
      pattern: "^[a-z][a-z0-9_-]{2,63}$",
      description: "稳定标识",
      example: "demo_role",
    }),
    name: {
      ...text(64),
      description: "角色名称",
      example: "只读角色",
    },
    description: Type.String({
      maxLength: 500,
      description: "用途或补充说明",
      example: "仅用于示例",
    }),
    permissions: Type.Array(Type.String(), {
      uniqueItems: true,
      maxItems: 100,
      description: "权限标识列表",
      example: ["user:read"],
    }),
  },
  { additionalProperties: false },
);
const adminFields = {
  account: Type.String({
    pattern: "^[a-zA-Z][a-zA-Z0-9_]{2,63}$",
    description: "后台用户登录账号",
    example: "demo_admin",
  }),
  displayName: {
    ...text(64),
    description: "后台用户显示名称",
    example: "演示管理员",
  },
  roles: {
    ...ids,
    description: "关联角色 ID 列表",
    example: ["00000000-0000-4000-8000-000000000001"],
  },
};
const password = Type.String({ minLength: 12, maxLength: 128 });
type RoleInput = {
  scope?: RoleScope;
  code: string;
  name: string;
  description: string;
  permissions: string[];
};
type AdminInput = { account: string; displayName: string; roles: string[] };
const adminSnapshot = (row: typeof admins.$inferSelect, roleIds: string[]) => ({
  id: row.id,
  account: row.account,
  displayName: row.isSuperAdmin ? "超级管理员" : row.displayName,
  status: row.status,
  isSuperAdmin: row.isSuperAdmin,
  roles: row.isSuperAdmin ? [] : roleIds,
});
const forbidden = () =>
  new AppError(
    "PERMISSION_DENIED",
    "不能修改超级管理员或分配超出自身范围的权限",
    403,
  );
export async function registerManagementRoutes(
  app: FastifyInstance,
  database: Database,
  config: AppConfig,
  catalog: PermissionCatalog,
  appRoleMembership?: RoleMembership,
) {
  const transaction = <T>(fn: (tx: Transaction) => Promise<T>) =>
    database.db.transaction(async (tx) => {
      // All role/account mutations share a lock: checks and assignments cannot race.
      await tx.execute(sql`select pg_advisory_xact_lock(731904203)`);
      return fn(tx);
    });
  const assertGrant = (
    request: FastifyRequest,
    codes: string[],
    scope: RoleScope = "admin",
  ) => {
    if (codes.some((code) => !codesFor(catalog, scope).includes(code)))
      throw new AppError("INVALID_PERMISSION", "权限不存在或已停用");
    if (
      scope === "admin" &&
      !request.identity!.isSuperAdmin &&
      codes.some((code) => !request.identity!.permissions.includes(code))
    )
      throw forbidden();
  };
  const roleCodes = async (
    tx: Transaction,
    roleIds: string[],
    scope: RoleScope = "admin",
  ) => {
    if (!roleIds.length) return [];
    const found = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(inArray(roles.id, roleIds), eq(roles.scope, scope)));
    if (found.length !== roleIds.length)
      throw new AppError("INVALID_ROLE", "角色不存在或归属不匹配");
    return (
      await tx
        .select({ code: rolePermissions.permissionCode })
        .from(rolePermissions)
        .where(inArray(rolePermissions.roleId, roleIds))
    )
      .map((p) => p.code)
      .filter((code) => codesFor(catalog, scope).includes(code));
  };
  const targetAdmin = async (
    tx: Transaction,
    request: FastifyRequest,
    id: string,
  ) => {
    const [target] = await tx
      .select()
      .from(admins)
      .where(eq(admins.id, id))
      .for("update");
    if (!target) throw new AppError("NOT_FOUND", "管理员账号不存在", 404);
    const roleIds = (
      await tx
        .select({ id: adminRoles.roleId })
        .from(adminRoles)
        .where(eq(adminRoles.adminId, id))
    ).map((r) => r.id);
    if (!request.identity!.isSuperAdmin) {
      if (target.isSuperAdmin) throw forbidden();
      assertGrant(request, await roleCodes(tx, roleIds));
    }
    return { target, roleIds };
  };
  app.get<{ Querystring: { scope?: RoleScope } }>(
    "/api/admin/role-options",
    {
      config: { auth: true },
      schema: {
        tags: ["角色"],
        summary: "可分配角色",
        querystring: scopeQuery,
        description:
          "列出角色选择项；需具备用户查看/创建/编辑或角色查看权限之一。列表包含全部角色，实际分配时另行检查操作者的授权范围。",
        response: {
          200: Type.Object({
            items: Type.Array(
              Type.Object({
                value: {
                  ...uuid,
                  description: "选项值；角色 ID",
                  example: "00000000-0000-4000-8000-000000000001",
                },
                label: Type.String({
                  description: "选项显示名称",
                  example: "只读角色",
                }),
              }),
              { description: "当前页记录列表" },
            ),
          }),
        },
      },
    },
    async (request) => {
      if (
        !request.identity!.isSuperAdmin &&
        ![
          "user:read",
          "user:create",
          "user:update",
          "role:read",
          "app-user:read",
          "app-user:create",
          "app-user:update",
        ].some((code) => request.identity!.permissions.includes(code))
      )
        throw forbidden();
      return {
        items: await database.db
          .select({ value: roles.id, label: roles.name })
          .from(roles)
          .where(eq(roles.scope, request.query.scope ?? "admin"))
          .orderBy(roles.name),
      };
    },
  );
  app.get<{ Querystring: { scope?: RoleScope } }>(
    "/api/admin/permissions",
    {
      config: { auth: true, permissions: ["role:read"] },
      schema: {
        tags: ["角色"],
        summary: "权限目录",
        querystring: scopeQuery,
        description:
          "返回代码声明且已启用的权限分组与明细，供角色授权使用。实际保存角色时检查操作者可授予的权限范围。",
        response: {
          200: Type.Object({
            groups: Type.Array(
              Type.Object({
                code: Type.String({
                  description: "权限分组标识",
                  example: "admin",
                }),
                name: Type.String({
                  description: "权限分组名称",
                  example: "管理员账号",
                }),
                permissions: Type.Array(
                  Type.Object({
                    code: Type.String({
                      description: "权限标识；授权时使用此值",
                      example: "user:read",
                    }),
                    name: Type.String({
                      description: "权限名称",
                      example: "查看账号",
                    }),
                    description: Type.String({
                      description: "用途或补充说明",
                      example: "仅用于示例",
                    }),
                    write: Type.Boolean({
                      description: "是否属于写操作权限",
                      example: false,
                    }),
                  }),
                  { description: "分组内的权限明细列表" },
                ),
              }),
              { description: "权限分组列表" },
            ),
          }),
        },
      },
    },
    async (request) => ({ groups: catalog[request.query.scope ?? "admin"] }),
  );
  app.get<{
    Querystring: {
      page?: number;
      pageSize?: number;
      name?: string;
      scope?: RoleScope;
    };
  }>(
    "/api/admin/roles",
    {
      config: { auth: true, permissions: ["role:read"] },
      schema: {
        tags: ["角色"],
        summary: "查询角色",
        description: "按名称筛选并分页查询角色、权限标识和关联用户数量。",
        querystring: Type.Object({
          scope: Type.Optional(scopeSchema),
          page: Type.Optional(
            Type.Integer({
              minimum: 1,
              description: "页码，从 1 开始",
              example: 1,
            }),
          ),
          pageSize: Type.Optional(
            Type.Integer({
              minimum: 1,
              maximum: 100,
              description: "每页条数，最多 100",
              example: 20,
            }),
          ),
          name: Type.Optional(
            Type.String({
              maxLength: 64,
              description: "角色名称",
              example: "只读角色",
            }),
          ),
        }),
        response: {
          200: Type.Object({
            items: Type.Array(roleSchema, { description: "当前页记录列表" }),
            total: Type.Number({
              description: "符合条件的记录总数",
              example: 1,
            }),
            page: Type.Number({ description: "页码，从 1 开始", example: 1 }),
            pageSize: Type.Number({
              description: "每页条数，最多 100",
              example: 20,
            }),
          }),
        },
      },
    },
    async (request) => {
      const { page = 1, pageSize = 20, name, scope = "admin" } = request.query;
      const where = and(
        eq(roles.scope, scope),
        name ? ilike(roles.name, `%${name}%`) : undefined,
      );
      const [total] = await database.db
        .select({ value: count() })
        .from(roles)
        .where(where);
      const currentPage = Math.max(
        1,
        Math.min(page, Math.ceil(total!.value / pageSize) || 1),
      );
      const rows = await database.db
        .select()
        .from(roles)
        .where(where)
        .orderBy(roles.createdAt, roles.id)
        .limit(pageSize)
        .offset((currentPage - 1) * pageSize);
      const items = await Promise.all(
        rows.map(async (row) => {
          const assigned = await database.db
            .select({ code: rolePermissions.permissionCode })
            .from(rolePermissions)
            .where(eq(rolePermissions.roleId, row.id));
          const [members] = await database.db
            .select({ value: count() })
            .from(adminRoles)
            .where(eq(adminRoles.roleId, row.id));
          return {
            ...row,
            permissions: assigned
              .map((p) => p.code)
              .filter((code) => codesFor(catalog, row.scope).includes(code)),
            members:
              row.scope === "app"
                ? await database.db.transaction(
                    (tx) =>
                      appRoleMembership?.count(tx, row.id) ??
                      Promise.resolve(0),
                  )
                : members!.value,
          };
        }),
      );
      return { items, total: total!.value, page: currentPage, pageSize };
    },
  );
  for (const edit of [false, true]) {
    app.route<{ Params: { id: string }; Body: RoleInput }>({
      method: edit ? "PUT" : "POST",
      url: edit ? "/api/admin/roles/:id" : "/api/admin/roles",
      config: { auth: true, permissions: ["role:update"] },
      schema: {
        tags: ["角色"],
        summary: edit ? "编辑角色" : "创建角色",
        description:
          "创建或更新角色及其权限列表。权限必须在操作者可授予范围内；角色权限修改对后续请求生效。",
        body: roleInput,
        ...(edit ? { params } : {}),
        response: ok,
      },
      handler: async (request) => {
        await transaction(async (tx) => {
          const scope = request.body.scope ?? "admin";
          assertGrant(request, request.body.permissions, scope);
          if (!request.body.name.trim())
            throw new AppError("INVALID_NAME", "角色名称不能为空");
          let before: Record<string, unknown> | undefined;
          let id = request.params.id;
          if (edit) {
            const [row] = await tx.select().from(roles).where(eq(roles.id, id));
            if (!row) throw new AppError("NOT_FOUND", "角色不存在", 404);
            if (row.scope !== scope)
              throw new AppError("ROLE_SCOPE_IMMUTABLE", "角色归属不能修改");
            const oldCodes = await roleCodes(tx, [id], scope);
            if (!request.identity!.isSuperAdmin)
              assertGrant(request, oldCodes, scope);
            before = { ...row, permissions: oldCodes };
            await tx
              .update(roles)
              .set({
                code: request.body.code,
                name: request.body.name.trim(),
                description: request.body.description,
                updatedAt: new Date(),
              })
              .where(eq(roles.id, id));
            await tx
              .delete(rolePermissions)
              .where(eq(rolePermissions.roleId, id));
          } else {
            const [created] = await tx
              .insert(roles)
              .values({
                scope,
                code: request.body.code,
                name: request.body.name.trim(),
                description: request.body.description,
              })
              .returning({ id: roles.id });
            id = created!.id;
          }
          if (request.body.permissions.length)
            await tx.insert(rolePermissions).values(
              request.body.permissions.map((code) => ({
                roleId: id,
                permissionCode: code,
              })),
            );
          await writeAudit(tx, request, config.APP_ENV, {
            action: edit ? "role.update" : "role.create",
            targetType: "role",
            targetId: id,
            result: "success",
            before,
            after: { ...request.body },
          });
        });
        return { ok: true };
      },
    });
  }
  app.delete<{ Params: { id: string } }>(
    "/api/admin/roles/:id",
    {
      config: { auth: true, permissions: ["role:update"] },
      schema: {
        tags: ["角色"],
        summary: "删除角色",
        description: "删除指定角色；仍有关联用户时拒绝删除。",
        params,
        response: ok,
      },
    },
    async (request) => {
      await transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(roles)
          .where(eq(roles.id, request.params.id));
        if (!row) throw new AppError("NOT_FOUND", "角色不存在", 404);
        assertGrant(
          request,
          await roleCodes(tx, [row.id], row.scope),
          row.scope,
        );
        if (row.scope === "app" && (await appRoleMembership?.count(tx, row.id)))
          throw new AppError("ROLE_IN_USE", "角色仍有关联成员", 409);
        if (
          (
            await tx
              .select()
              .from(adminRoles)
              .where(eq(adminRoles.roleId, row.id))
              .limit(1)
          ).length
        )
          throw new AppError("ROLE_IN_USE", "角色仍有关联成员", 409);
        await tx.delete(roles).where(eq(roles.id, row.id));
        await writeAudit(tx, request, config.APP_ENV, {
          action: "role.delete",
          targetType: "role",
          targetId: row.id,
          result: "success",
          before: { code: row.code, name: row.name },
        });
      });
      return { ok: true };
    },
  );
  app.get<{
    Querystring: {
      page?: number;
      pageSize?: number;
      account?: string;
      roles?: string;
      from?: string;
      to?: string;
      name?: string;
      status?: string;
    };
  }>(
    "/api/admin/accounts",
    {
      config: { auth: true, permissions: ["user:read"] },
      schema: {
        tags: ["后台用户"],
        summary: "查询后台用户",
        description:
          "分页查询后台用户，可按账号、名称、角色、状态和创建时间范围筛选；不会返回密码哈希。",
        querystring: Type.Object({
          page: Type.Optional(
            Type.Integer({
              minimum: 1,
              description: "页码，从 1 开始",
              example: 1,
            }),
          ),
          pageSize: Type.Optional(
            Type.Integer({
              minimum: 1,
              maximum: 100,
              description: "每页条数，最多 100",
              example: 20,
            }),
          ),
          roles: Type.Optional(
            Type.String({
              maxLength: 3700,
              pattern: "^[0-9a-fA-F-]{36}(,[0-9a-fA-F-]{36})*$",
              description: "角色 ID 筛选；多个 UUID 用逗号分隔",
              example: "00000000-0000-4000-8000-000000000001",
            }),
          ),
          from: Type.Optional(
            Type.String({
              format: "date-time",
              description: "起始时间（包含，ISO 8601）",
              example: "2026-09-01T00:00:00.000Z",
            }),
          ),
          to: Type.Optional(
            Type.String({
              format: "date-time",
              description: "结束时间（包含，ISO 8601）",
              example: "2026-10-01T00:00:00.000Z",
            }),
          ),
          account: Type.Optional(
            Type.String({
              maxLength: 64,
              description: "后台用户登录账号",
              example: "demo_admin",
            }),
          ),
          name: Type.Optional(
            Type.String({
              maxLength: 64,
              description: "后台用户显示名称，支持模糊筛选",
              example: "演示管理员",
            }),
          ),
          status: {
            ...Type.Optional(status),
            description: "账号状态：enabled 启用，disabled 停用",
            example: "enabled",
          },
        }),
        response: {
          200: Type.Object({
            items: Type.Array(adminSchema, { description: "当前页记录列表" }),
            total: Type.Number({
              description: "符合条件的记录总数",
              example: 1,
            }),
            page: Type.Number({ description: "页码，从 1 开始", example: 1 }),
            pageSize: Type.Number({
              description: "每页条数，最多 100",
              example: 20,
            }),
          }),
        },
      },
    },
    async (request) => {
      const { page = 1, pageSize = 20, account, name, status } = request.query;
      const q = request.query;
      if (q.from && q.to && new Date(q.from) > new Date(q.to))
        throw new AppError("INVALID_RANGE", "开始时间不能晚于结束时间");
      const roleIds = q.roles?.split(",");
      if (
        roleIds?.some(
          (id) =>
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
              id,
            ),
        )
      )
        throw new AppError("INVALID_ROLE", "角色标识格式错误");
      const where = and(
        roleIds?.length
          ? inArray(
              admins.id,
              database.db
                .select({ id: adminRoles.adminId })
                .from(adminRoles)
                .where(inArray(adminRoles.roleId, roleIds)),
            )
          : undefined,
        q.from ? gte(admins.createdAt, new Date(q.from)) : undefined,
        q.to ? lte(admins.createdAt, new Date(q.to)) : undefined,
        account ? ilike(admins.account, `%${account}%`) : undefined,
        name ? ilike(admins.displayName, `%${name}%`) : undefined,
        status ? eq(admins.status, status) : undefined,
      );
      const [total] = await database.db
        .select({ value: count() })
        .from(admins)
        .where(where);
      const currentPage = Math.max(
        1,
        Math.min(page, Math.ceil(total!.value / pageSize) || 1),
      );
      const rows = await database.db
        .select()
        .from(admins)
        .where(where)
        .orderBy(desc(admins.createdAt), admins.id)
        .limit(pageSize)
        .offset((currentPage - 1) * pageSize);
      return {
        total: total!.value,
        page: currentPage,
        pageSize,
        items: await Promise.all(
          rows.map(async (row) => ({
            ...adminSnapshot(
              row,
              (
                await database.db
                  .select({ id: adminRoles.roleId })
                  .from(adminRoles)
                  .where(eq(adminRoles.adminId, row.id))
              ).map((r) => r.id),
            ),
            createdAt: row.createdAt.toISOString(),
            lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
          })),
        ),
      };
    },
  );
  app.post<{ Body: AdminInput & { password: string } }>(
    "/api/admin/accounts",
    {
      config: { auth: true, permissions: ["user:create"] },
      schema: {
        tags: ["后台用户"],
        summary: "创建后台用户",
        description:
          "创建后台用户并分配角色。密码至少 12 个字符；普通管理员不能授予超出自身范围的角色权限。",
        body: Type.Object(
          {
            ...adminFields,
            password: {
              ...password,
              description: "密码；创建或重置时至少 12 个字符，请手动填写",
            },
          },
          { additionalProperties: false },
        ),
        response: ok,
      },
    },
    async (request) => {
      const passwordHash = await hashPassword(request.body.password);
      await transaction(async (tx) => {
        assertGrant(request, await roleCodes(tx, request.body.roles));
        if (!request.body.displayName.trim())
          throw new AppError("INVALID_NAME", "显示名称不能为空");
        const [row] = await tx
          .insert(admins)
          .values({
            account: request.body.account.toLowerCase(),
            displayName: request.body.displayName.trim(),
            passwordHash,
          })
          .returning();
        if (request.body.roles.length)
          await tx.insert(adminRoles).values(
            request.body.roles.map((roleId) => ({
              adminId: row!.id,
              roleId,
            })),
          );
        await writeAudit(tx, request, config.APP_ENV, {
          action: "admin.create",
          targetType: "admin",
          targetId: row!.id,
          result: "success",
          after: adminSnapshot(row!, request.body.roles),
        });
      });
      return { ok: true };
    },
  );
  app.put<{ Params: { id: string }; Body: AdminInput }>(
    "/api/admin/accounts/:id",
    {
      config: { auth: true, permissions: ["user:update"] },
      schema: {
        tags: ["后台用户"],
        summary: "编辑后台用户",
        description:
          "更新后台用户账号、显示名称和角色。超级管理员的身份资料不可通过此接口修改。",
        params,
        body: Type.Object(adminFields, { additionalProperties: false }),
        response: ok,
      },
    },
    async (request) => {
      await transaction(async (tx) => {
        const { target, roleIds } = await targetAdmin(
          tx,
          request,
          request.params.id,
        );
        if (target.isSuperAdmin)
          throw new AppError(
            "ACCOUNT_PROTECTED",
            "超级管理员的账号、显示名称和角色不可修改",
            409,
          );
        assertGrant(request, await roleCodes(tx, request.body.roles));
        if (!request.body.displayName.trim())
          throw new AppError("INVALID_NAME", "显示名称不能为空");
        const [row] = await tx
          .update(admins)
          .set({
            account: request.body.account.toLowerCase(),
            displayName: request.body.displayName.trim(),
            updatedAt: new Date(),
          })
          .where(eq(admins.id, target.id))
          .returning();
        await tx.delete(adminRoles).where(eq(adminRoles.adminId, target.id));
        if (request.body.roles.length)
          await tx.insert(adminRoles).values(
            request.body.roles.map((roleId) => ({
              adminId: target.id,
              roleId,
            })),
          );
        await writeAudit(tx, request, config.APP_ENV, {
          action: "admin.update",
          targetType: "admin",
          targetId: target.id,
          result: "success",
          before: adminSnapshot(target, roleIds),
          after: adminSnapshot(row!, request.body.roles),
        });
      });
      return { ok: true };
    },
  );
  app.post<{ Body: { ids: string[]; status: "enabled" | "disabled" } }>(
    "/api/admin/accounts/status",
    {
      config: { auth: true, permissions: ["user:disable"] },
      schema: {
        tags: ["后台用户"],
        summary: "启停后台用户",
        description:
          "批量启用或停用后台用户，最多 50 个 ID。停用会撤销已有会话；不能修改超级管理员状态。",
        body: Type.Object(
          {
            ids: Type.Array(uuid, {
              minItems: 1,
              maxItems: 100,
              uniqueItems: true,
              description: "目标记录 ID 列表",
              example: ["00000000-0000-4000-8000-000000000001"],
            }),
            status: {
              ...status,
              description: "账号状态：enabled 启用，disabled 停用",
              example: "enabled",
            },
          },
          { additionalProperties: false },
        ),
        response: ok,
      },
    },
    async (request) => {
      await transaction(async (tx) => {
        for (const id of request.body.ids) {
          const { target, roleIds } = await targetAdmin(tx, request, id);
          if (
            target.isSuperAdmin ||
            (request.body.status === "disabled" &&
              target.id === request.identity!.id)
          )
            throw new AppError(
              "ACCOUNT_PROTECTED",
              "不能更改超级管理员状态或停用当前账号",
              409,
            );
          await tx
            .update(admins)
            .set({ status: request.body.status, updatedAt: new Date() })
            .where(eq(admins.id, id));
          if (request.body.status === "disabled")
            await tx
              .update(sessions)
              .set({ revokedAt: new Date() })
              .where(eq(sessions.adminId, id));
          await writeAudit(tx, request, config.APP_ENV, {
            action: "admin.status",
            targetType: "admin",
            targetId: id,
            result: "success",
            before: adminSnapshot(target, roleIds),
            after: { status: request.body.status },
          });
        }
      });
      return { ok: true };
    },
  );
  app.post<{ Params: { id: string }; Body: { password: string } }>(
    "/api/admin/accounts/:id/password",
    {
      config: { auth: true, permissions: ["user:reset-password"] },
      schema: {
        tags: ["后台用户"],
        summary: "重置密码",
        description:
          "重置指定后台用户密码并撤销该用户全部会话。密码至少 12 个字符。",
        params,
        body: Type.Object(
          {
            password: {
              ...password,
              description: "密码；创建或重置时至少 12 个字符，请手动填写",
            },
          },
          { additionalProperties: false },
        ),
        response: ok,
      },
    },
    async (request) => {
      const passwordHash = await hashPassword(request.body.password);
      await transaction(async (tx) => {
        await targetAdmin(tx, request, request.params.id);
        await tx
          .update(admins)
          .set({ passwordHash, updatedAt: new Date() })
          .where(eq(admins.id, request.params.id));
        await tx
          .update(sessions)
          .set({ revokedAt: new Date() })
          .where(eq(sessions.adminId, request.params.id));
        await writeAudit(tx, request, config.APP_ENV, {
          action: "admin.reset-password",
          targetType: "admin",
          targetId: request.params.id,
          result: "success",
        });
      });
      return { ok: true };
    },
  );
}
