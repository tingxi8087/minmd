import { expect, test } from "bun:test";
import {
  encryptSecret,
  decryptSecret,
} from "../apps/app_server/src/modules/api-keys/secret";
import { loadMinmdConfig } from "../config/minmd";
import { loadConfig } from "../system/server/src/config/env";
const key = "ab".repeat(32);
test("密钥原文加密可恢复，密文篡改、跨记录和错误主密钥均拒绝", () => {
  const secret = "minmd_test_secret";
  const ciphertext = encryptSecret(secret, "id:space", key);
  expect(ciphertext).not.toContain(secret);
  expect(decryptSecret(ciphertext, "id:space", key)).toBe(secret);
  expect(encryptSecret(secret, "id:space", key)).not.toBe(ciphertext);
  expect(() => decryptSecret(ciphertext, "other:space", key)).toThrow(
    "无法解密",
  );
  expect(() => decryptSecret(ciphertext, "id:space", "cd".repeat(32))).toThrow(
    "无法解密",
  );
  const bytes = Buffer.from(ciphertext, "base64");
  bytes[30] ^= 1;
  expect(() =>
    decryptSecret(bytes.toString("base64"), "id:space", key),
  ).toThrow("无法解密");
  expect(() => encryptSecret(secret, "id:space")).toThrow("尚未配置");
});
test("密钥加密配置通过统一入口校验，空值可启动、非32字节密钥拒绝", () => {
  const config = loadConfig({
    DATABASE_URL: "postgresql://localhost/unused_test",
  });
  expect(
    loadMinmdConfig(config, { AI_KEY_ENCRYPTION_KEY: "" }).aiKeyEncryptionKey,
  ).toBeUndefined();
  expect(
    loadMinmdConfig(config, { AI_KEY_ENCRYPTION_KEY: key }).aiKeyEncryptionKey,
  ).toBe(key);
  expect(() =>
    loadMinmdConfig(config, { AI_KEY_ENCRYPTION_KEY: "short" }),
  ).toThrow("AI_KEY_ENCRYPTION_KEY");
});
