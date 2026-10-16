import { homedir } from "node:os";
import { join } from "node:path";

interface DockerCredentials {
  auths?: Record<string, { auth?: string; identitytoken?: string }>;
  credHelpers?: Record<string, string>;
  credsStore?: string;
}
const registries = ["ghcr.io", "ccr.ccs.tencentyun.com"];
const host = (value: string) => {
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).host;
  } catch {
    return "";
  }
};
export async function checkCredentials(
  config: DockerCredentials,
  list: (helper: string) => Promise<Record<string, string>>,
) {
  const loaded = new Map<string, Promise<Record<string, string>>>();
  for (const registry of registries) {
    const direct = Object.entries(config.auths ?? {}).find(
      ([key]) => host(key) === registry,
    )?.[1];
    if (direct?.auth || direct?.identitytoken) continue;
    const helper = config.credHelpers?.[registry] ?? config.credsStore;
    if (helper && /^[A-Za-z0-9_.-]+$/.test(helper)) {
      if (!loaded.has(helper)) loaded.set(helper, list(helper));
      try {
        const entries = await loaded.get(helper)!;
        if (
          Object.entries(entries).some(
            ([key, username]) => host(key) === registry && username,
          )
        )
          continue;
      } catch {
        /* 不输出凭证工具的原始内容。 */
      }
    }
    throw new Error(
      `未检测到 ${registry} 的 Docker 登录，请先执行 docker login ${registry}；GHCR token 需要 write:packages 权限`,
    );
  }
}
if (import.meta.main) {
  try {
    const path = join(
      process.env.DOCKER_CONFIG ?? join(homedir(), ".docker"),
      "config.json",
    );
    const config = (await Bun.file(path).exists())
      ? ((await Bun.file(path).json()) as DockerCredentials)
      : {};
    await checkCredentials(config, async (helper) => {
      const child = Bun.spawn([`docker-credential-${helper}`, "list"], {
        stdout: "pipe",
        stderr: "pipe",
        timeout: 15000,
      });
      const [code, raw] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      if (code) throw new Error("凭证工具不可用");
      return JSON.parse(raw) as Record<string, string>;
    });
    console.log(
      "已检测到 GHCR 和腾讯云的 Docker 登录记录；实际推送仍由仓库验证权限。",
    );
  } catch (error) {
    console.error(
      error instanceof Error && error.message.startsWith("未检测到 ")
        ? error.message
        : "无法读取 Docker 登录配置，请检查配置或重新登录",
    );
    process.exitCode = 1;
  }
}
