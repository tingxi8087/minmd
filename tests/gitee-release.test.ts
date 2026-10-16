import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GiteeRelease,
  giteeToken,
  validateGiteeInput,
} from "../scripts/gitee-release";

const revision = "a".repeat(40),
  version = "v0.1.4",
  token = "test-private-token";
async function fixture(failure = "") {
  const dir = await mkdtemp(join(tmpdir(), "minmd-gitee-test-"));
  const files = new Map<string, string>();
  for (const name of [
    `minmd-${version}-china.tar.gz`,
    `minmd-${version}-china.tar.gz.sha256`,
    "install-china.sh",
    "release-china.env",
  ]) {
    files.set(name, `sample:${name}`);
    await writeFile(join(dir, name), files.get(name)!);
  }
  const calls: { url: string; method: string }[] = [],
    uploads = new Map<string, string>();
  let release: {
    id: number;
    tag_name: string;
    target_commitish: string;
    prerelease: boolean;
    body: string;
  } | null = null;
  let promoted = false;
  const request = async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? "GET" });
    expect(url).not.toContain(token);
    if (!url.includes("/api/v5/")) {
      expect(init.headers).toBeUndefined();
      const name = url.split("/").at(-1)!;
      return new Response(
        failure === "html"
          ? "<html>登录</html>"
          : (uploads.get(name) ?? files.get(name)),
        { status: 200 },
      );
    }
    expect(new Headers(init.headers).get("Authorization")).toBe(
      `Bearer ${token}`,
    );
    const form = init.body as FormData | undefined;
    if (form) expect(form.get("access_token")).toBe(token);
    if (url.endsWith("/minmd"))
      return Response.json({
        private: false,
        public: true,
        permission: { push: failure !== "permission" },
      });
    if (url.includes("/releases/tags/")) {
      if (failure === "conflict")
        return Response.json({
          target_commitish: "b".repeat(40),
          body: "unrelated",
        });
      return release
        ? Response.json(release)
        : Response.json({}, { status: 404 });
    }
    if (url.endsWith("/releases")) {
      expect(form!.get("prerelease")).toBe("true");
      release = {
        id: 123,
        tag_name: version,
        target_commitish: revision,
        prerelease: true,
        body: String(form!.get("body")),
      };
      return Response.json(release);
    }
    if (url.includes("attach_files")) {
      if (init.method === "POST") {
        const file = form!.get("file") as File;
        if (failure === "upload") return Response.json({}, { status: 403 });
        uploads.set(file.name, await file.text());
        return Response.json({ id: uploads.size });
      }
      return Response.json(
        [...uploads.keys()].map((name, index) => ({ id: index + 1, name })),
      );
    }
    if (init.method === "PATCH") {
      promoted = true;
      expect(uploads.size).toBe(4);
      release!.prerelease = false;
      return Response.json(release);
    }
    throw new Error("意外请求");
  };
  return {
    dir,
    calls,
    uploads,
    client: new GiteeRelease("example/minmd", token, request),
    promoted: () => promoted,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}
test("Gitee 先上传四个国内附件，匿名逐字节验证后才转稳定版；同提交重跑不覆盖附件", async () => {
  const f = await fixture();
  try {
    await f.client.check(revision, version);
    await f.client.publish(revision, version, f.dir);
    expect(f.promoted()).toBe(true);
    expect(f.uploads.size).toBe(4);
    const count = f.calls.length;
    await f.client.publish(revision, version, f.dir);
    expect(f.calls.slice(count).every((c) => c.method === "GET")).toBe(true);
  } finally {
    await f.cleanup();
  }
});
test("Gitee 权限、版本冲突、附件上传或匿名下载失败时不转稳定版，错误不泄漏令牌", async () => {
  for (const failure of ["permission", "conflict", "upload", "html"]) {
    const f = await fixture(failure);
    try {
      const operation =
        failure === "permission" || failure === "conflict"
          ? f.client.check(revision, version)
          : f.client.publish(revision, version, f.dir);
      await expect(operation).rejects.toThrow();
      expect(f.promoted()).toBe(false);
    } finally {
      await f.cleanup();
    }
  }
  const client = new GiteeRelease("example/minmd", token, async () => {
    throw new Error(token);
  });
  await expect(client.check(revision, version)).rejects.toThrow(
    "Gitee API 连接失败",
  );
});
test("Gitee 令牌从环境或仓库外文件读取，参数校验不允许路径注入", async () => {
  const dir = await mkdtemp(join(tmpdir(), "minmd-gitee-token-"));
  try {
    const path = join(dir, "token");
    await writeFile(path, "local-token\n", { mode: 0o600 });
    expect(await giteeToken({ GITEE_TOKEN: token })).toBe(token);
    expect(await giteeToken({ GITEE_TOKEN_FILE: path })).toBe("local-token");
    await expect(giteeToken({}, dir)).rejects.toThrow("缺少 Gitee 私人令牌");
    for (const args of [
      ["../bad", revision, version],
      ["example/minmd", "HEAD", version],
      ["example/minmd", revision, "latest"],
    ])
      expect(() => validateGiteeInput(args[0]!, args[1]!, args[2]!)).toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
