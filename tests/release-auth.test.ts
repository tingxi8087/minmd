import { expect, test } from "bun:test";
import { checkCredentials } from "../scripts/release-auth";

test("Docker 明文或外部凭证存储均可识别，不读取完整密钥", async () => {
  await checkCredentials(
    {
      auths: {
        "ghcr.io": { auth: "opaque" },
        "ccr.ccs.tencentyun.com": { identitytoken: "opaque" },
      },
    },
    async () => {
      throw new Error("不应调用");
    },
  );
  let calls = 0;
  await checkCredentials(
    {
      credsStore: "desktop",
      auths: { "ghcr.io": {}, "ccr.ccs.tencentyun.com": {} },
    },
    async (helper) => {
      expect(helper).toBe("desktop");
      calls++;
      return { "https://ghcr.io": "user", "ccr.ccs.tencentyun.com": "user" };
    },
  );
  expect(calls).toBe(1);
});
test("未登录、损坏 helper 和 helper 失败均明确拒绝，错误不包含凭证输出", async () => {
  for (const config of [
    {},
    { credsStore: "../invalid" },
    { credsStore: "desktop" },
  ])
    await expect(
      checkCredentials(config, async () => {
        throw new Error("sensitive output");
      }),
    ).rejects.toThrow("未检测到 ghcr.io");
  await expect(
    checkCredentials(
      { auths: { "ghcr.io": { auth: "opaque" } } },
      async () => ({}),
    ),
  ).rejects.toThrow("ccr.ccs.tencentyun.com");
});
