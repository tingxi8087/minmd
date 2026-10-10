import { createHash, randomBytes } from "node:crypto";
export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");
export function validatePassword(password: string) {
  if (password.length < 12 || password.length > 128)
    throw new Error("密码长度必须为 12–128 位");
}
export async function hashPassword(password: string) {
  validatePassword(password);
  return hashValidatedPassword(password);
}
/** 调用方须先完成对应场景的密码校验。 */
export async function hashValidatedPassword(password: string) {
  return Bun.password.hash(password, {
    algorithm: "argon2id",
    memoryCost: 19456,
    timeCost: 2,
  });
}
