import { expect, test } from "bun:test";
import { loadMinmdConfig } from "../config/minmd";
import { loadConfig } from "../system/server/src/config/env";
import { documentCollaborationConfig } from "../config/document-collaboration";

test("文档连接入口频率采用统一配置并拒绝无界值", () => {
  expect(documentCollaborationConfig({}).DOC_COLLAB_MESSAGES_PER_SECOND).toBe(
    100,
  );
  expect(
    documentCollaborationConfig({ DOC_COLLAB_MESSAGES_PER_SECOND: "20" })
      .DOC_COLLAB_MESSAGES_PER_SECOND,
  ).toBe(20);
  for (const value of ["0", "1001", "1.5", "invalid"])
    expect(() =>
      documentCollaborationConfig({ DOC_COLLAB_MESSAGES_PER_SECOND: value }),
    ).toThrow("DOC_COLLAB_MESSAGES_PER_SECOND");
});

const config = loadConfig({
  DATABASE_URL: "postgresql://localhost/unused_test",
  PUBLIC_ORIGIN: "http://127.0.0.1:5174",
});
test("MinMD registration is disabled by default and frontend sources are explicit", () => {
  expect(loadMinmdConfig(config, {})).toMatchObject({
    registrationEnabled: false,
    allowedOrigins: [config.PUBLIC_ORIGIN],
  });
  const env = {
    APP_REGISTRATION_ENABLED: "true",
    APP_PUBLIC_ORIGIN: "http://127.0.0.1:5173",
    APP_DEV_ORIGINS: "http://127.0.0.1:5183",
  };
  expect(loadMinmdConfig(config, env).allowedOrigins).toEqual([
    env.APP_PUBLIC_ORIGIN,
    env.APP_DEV_ORIGINS,
  ]);
  expect(
    loadMinmdConfig({ ...config, APP_ENV: "staging" }, env).allowedOrigins,
  ).toEqual([env.APP_PUBLIC_ORIGIN]);
  expect(() =>
    loadMinmdConfig(config, { APP_DEV_ORIGINS: "https://example.com/path" }),
  ).toThrow("APP_DEV_ORIGINS");
  expect(() =>
    loadMinmdConfig(
      { ...config, APP_ENV: "production", AUTH_TRANSPORT: "cookie" },
      env,
    ),
  ).toThrow("APP_PUBLIC_ORIGIN");
  expect(() =>
    loadMinmdConfig(config, {
      ASSET_STORAGE_DIR: `${config.STATIC_DIR}/private`,
    }),
  ).toThrow("ASSET_STORAGE_DIR");
});

test("AI额度与执行期限有明确默认值和边界", () => {
  expect(loadMinmdConfig(config, {})).toMatchObject({
    aiRequestsPerMinute: 60,
    aiExecutionTimeoutMs: 15000,
  });
  for (const value of ["0", "1001", "1.5"]) {
    expect(() =>
      loadMinmdConfig(config, { AI_REQUESTS_PER_MINUTE: value }),
    ).toThrow("AI_REQUESTS_PER_MINUTE");
  }
  for (const value of ["999", "60001", "abc"]) {
    expect(() =>
      loadMinmdConfig(config, { AI_EXECUTION_TIMEOUT_MS: value }),
    ).toThrow("AI_EXECUTION_TIMEOUT_MS");
  }
});
