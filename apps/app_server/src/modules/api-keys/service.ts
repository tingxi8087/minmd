import { and, eq, isNull, or, gt } from "drizzle-orm";
import type { Database } from "../../../../../system/server/src/database/client";
import type { Transaction } from "../../../../../system/server/src/modules/audit/service";
import { AppError } from "../../../../../system/server/src/errors";
import { hashToken } from "../../../../../system/server/src/modules/auth/password";
import {
  apiKeys,
  spaceAiPolicies,
  type AiPermission,
} from "../../database/schema/ai";
import { requireSpaceAccess } from "../spaces/service";
import { requireFileAccess } from "../files/service";

export type AiIdentity = {
  keyId: string;
  userId: string;
  spaceId: string;
  permissions: AiPermission[];
};
type Db = Database["db"] | Transaction;
/** 不回退浏览器Cookie或后台身份；调用和事务内都重新验证授权交集。 */
export async function authorizeAi(
  db: Db,
  token: string,
  permission?: AiPermission,
): Promise<AiIdentity> {
  if (!/^minmd_[a-zA-Z0-9_-]{32,120}$/.test(token))
    throw new AppError("API_KEY_INVALID", "API密钥无效", 401);
  const [key] = await db
    .select()
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.tokenHash, hashToken(token)),
        isNull(apiKeys.revokedAt),
        or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, new Date())),
      ),
    );
  if (!key)
    throw new AppError("API_KEY_INVALID", "API密钥无效、过期或已撤销", 401);
  await requireSpaceAccess(db, key.createdBy, key.spaceId);
  const [policy] = await db
    .select()
    .from(spaceAiPolicies)
    .where(eq(spaceAiPolicies.spaceId, key.spaceId));
  if (!policy?.enabled)
    throw new AppError("AI_DISABLED", "空间已关闭AI访问", 403);
  const permissions = key.permissions.filter((item) =>
    policy.permissions.includes(item),
  );
  if (permission && !permissions.includes(permission))
    throw new AppError(
      "AI_PERMISSION_DENIED",
      "空间策略或密钥未授予此操作权限",
      403,
    );
  return {
    keyId: key.id,
    userId: key.createdBy,
    spaceId: key.spaceId,
    permissions,
  };
}
export async function authorizeAiFile(
  db: Db,
  token: string,
  permission: AiPermission,
  fileId: string,
) {
  const identity = await authorizeAi(db, token, permission);
  const file = await requireFileAccess(db, identity.userId, fileId, {
    permission:
      permission === "read"
        ? "read"
        : ["organize", "delete_restore"].includes(permission)
          ? "manage"
          : "edit",
  });
  if (file.spaceId !== identity.spaceId)
    throw new AppError("AI_SPACE_MISMATCH", "密钥仅能操作绑定空间", 403);
  return { identity, file };
}
