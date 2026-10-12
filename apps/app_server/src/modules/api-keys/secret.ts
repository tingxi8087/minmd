import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { AppError } from "../../../../../system/server/src/errors";
function encryptionKey(value?: string) {
  if (!value)
    throw new AppError(
      "KEY_STORAGE_UNAVAILABLE",
      "服务端尚未配置密钥加密，请联系管理员",
      503,
    );
  return Buffer.from(value, "hex");
}
export function encryptSecret(secret: string, context: string, key?: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(key), iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}
export function decryptSecret(
  encrypted: string,
  context: string,
  key?: string,
) {
  const bytes = Buffer.from(encrypted, "base64");
  const encryption = encryptionKey(key);
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryption,
      bytes.subarray(0, 12),
    );
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([
      decipher.update(bytes.subarray(28)),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new AppError(
      "KEY_STORAGE_UNAVAILABLE",
      "密钥无法解密，请检查服务端加密配置",
      503,
    );
  }
}
