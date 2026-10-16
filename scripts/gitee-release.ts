import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
interface Release {
  id: number;
  tag_name: string;
  target_commitish: string;
  prerelease: boolean;
  body: string;
}
interface Attachment {
  id: number;
  name: string;
  browser_download_url: string;
}
const versionPattern = /^v\d+\.\d+\.\d+(?:[.-][A-Za-z0-9.-]+)?$/;
export function validateGiteeInput(
  repository: string,
  revision: string,
  version: string,
) {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(
      repository,
    ) ||
    !/^[a-f0-9]{40}$/.test(revision) ||
    !versionPattern.test(version)
  )
    throw new Error("Gitee 发布仓库、提交或版本参数无效");
}
export async function giteeToken(env = process.env, home = homedir()) {
  const token =
    env.GITEE_TOKEN ??
    (await readFile(
      env.GITEE_TOKEN_FILE ?? join(home, ".config/minmd/gitee-token"),
      "utf8",
    ).catch(() => ""));
  if (!token.trim() || /\s/.test(token.trim()))
    throw new Error(
      "缺少 Gitee 私人令牌：设置 GITEE_TOKEN，或保存到 ~/.config/minmd/gitee-token；需要 projects 权限，不要提交令牌",
    );
  return token.trim();
}
export class GiteeRelease {
  private base: string;
  constructor(
    private repository: string,
    private token: string,
    private request: Fetch = fetch,
  ) {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(
        repository,
      )
    )
      throw new Error("Gitee 仓库格式无效");
    this.base = `https://gitee.com/api/v5/repos/${repository}`;
  }
  private async api(
    path: string,
    method = "GET",
    fields?: Record<string, string | Blob>,
    missing = false,
  ): Promise<unknown> {
    const form = fields ? new FormData() : undefined;
    if (form) {
      form.set("access_token", this.token);
      for (const [key, value] of Object.entries(fields!)) {
        if (value instanceof Blob)
          form.set(key, value, value instanceof File ? value.name : key);
        else form.set(key, value);
      }
    }
    let reply: Response;
    try {
      reply = await this.request(this.base + path, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/json",
        },
        body: form,
        signal: AbortSignal.timeout(90000),
        redirect: "error",
      });
    } catch {
      throw new Error("Gitee API 连接失败，请检查网络；令牌未写入日志");
    }
    if (missing && reply.status === 404) return null;
    if (!reply.ok)
      throw new Error(
        `Gitee API 请求失败（HTTP ${reply.status}），请检查 projects 权限及仓库访问权限`,
      );
    try {
      return await reply.json();
    } catch {
      throw new Error(
        "Gitee API 没有返回有效 JSON，请检查是否被登录页或访问验证拦截",
      );
    }
  }
  async check(revision: string, version: string) {
    validateGiteeInput(this.repository, revision, version);
    const repo = (await this.api("")) as {
      public?: boolean;
      private?: boolean;
      permission?: { push?: boolean; admin?: boolean };
    };
    if (repo.private !== false || repo.public === false)
      throw new Error("Gitee 仓库必须公开，国内安装需要匿名下载");
    if (!repo.permission?.push && !repo.permission?.admin)
      throw new Error("Gitee 令牌没有当前仓库的推送/发布权限");
    const existing = await this.find(version);
    if (existing) this.sameRelease(existing, revision);
  }
  private find(version: string) {
    return this.api(
      `/releases/tags/${version}`,
      "GET",
      undefined,
      true,
    ) as Promise<Release | null>;
  }
  private marker(revision: string) {
    return `<!-- minmd-release:${revision} -->`;
  }
  private sameRelease(release: Release, revision: string) {
    if (
      release.target_commitish !== revision ||
      !release.body?.includes(this.marker(revision))
    )
      throw new Error(
        "Gitee 同名 Release 不属于本次提交；禁止覆盖，请核实或使用新版本",
      );
  }
  private fields(revision: string, version: string, prerelease: boolean) {
    return {
      tag_name: version,
      target_commitish: revision,
      name: `MinMD ${version}`,
      body: `国内部署包：下载 minmd-${version}-china.tar.gz 及对应 SHA256 校验文件，解压后执行 ./minmd.sh install。\n\n${this.marker(revision)}`,
      prerelease: String(prerelease),
    };
  }
  async publish(revision: string, version: string, directory: string) {
    validateGiteeInput(this.repository, revision, version);
    let release = await this.find(version);
    if (release) this.sameRelease(release, revision);
    else
      release = (await this.api(
        "/releases",
        "POST",
        this.fields(revision, version, true),
      )) as Release;
    if (!Number.isSafeInteger(release.id) || release.id < 1)
      throw new Error("Gitee Release ID 无效");
    const names = [
      `minmd-${version}-china.tar.gz`,
      `minmd-${version}-china.tar.gz.sha256`,
      "install-china.sh",
      "release-china.env",
    ];
    const assets = (await this.api(
      `/releases/${release.id}/attach_files?per_page=100`,
    )) as Attachment[];
    if (!Array.isArray(assets)) throw new Error("Gitee 附件列表无效");
    for (const name of names) {
      const file = Bun.file(join(directory, name));
      if (!(await file.exists()))
        throw new Error(`缺少 Gitee 发布附件：${name}`);
      const existing = assets.find((asset) => asset.name === name);
      if (!existing) {
        // Gitee 没有 draft：上传期间保留 prerelease，避免 latest 选到不完整附件。
        if (!release.prerelease)
          throw new Error("Gitee 正式版本缺少附件，不能原地修改正式版本");
        await this.api(`/releases/${release.id}/attach_files`, "POST", {
          file: new File([await file.arrayBuffer()], name),
        });
      }
      // 下载不携带令牌，逐字节比较；登录 HTML、重定向 GitHub 或错误文件都不能通过。
      const url = `https://gitee.com/${this.repository}/releases/download/${version}/${name}`;
      let reply: Response;
      try {
        reply = await this.request(url, {
          signal: AbortSignal.timeout(90000),
          redirect: "follow",
        });
      } catch {
        throw new Error(`Gitee 附件匿名下载失败：${name}`);
      }
      const destination = new URL(reply.url || url);
      if (
        !reply.ok ||
        !["gitee.com", "giteeusercontent.com"].some(
          (host) =>
            destination.hostname === host ||
            destination.hostname.endsWith(`.${host}`),
        )
      )
        throw new Error(`Gitee 附件不能通过国内地址匿名下载：${name}`);
      const expected = Bun.SHA256.hash(await file.arrayBuffer(), "hex");
      if (Bun.SHA256.hash(await reply.arrayBuffer(), "hex") !== expected)
        throw new Error(
          `Gitee 附件内容不一致或遇到登录/验证页面：${name}；未发布为稳定版`,
        );
    }
    const prerelease = !/^v\d+\.\d+\.\d+$/.test(version);
    if (release.prerelease !== prerelease)
      await this.api(
        `/releases/${release.id}`,
        "PATCH",
        this.fields(revision, version, prerelease),
      );
  }
}
if (import.meta.main) {
  try {
    const [
      operation,
      repository = "",
      revision = "",
      version = "",
      directory = "",
    ] = process.argv.slice(2);
    validateGiteeInput(repository, revision, version);
    const client = new GiteeRelease(repository, await giteeToken());
    if (operation === "check") await client.check(revision, version);
    else if (operation === "publish" && directory)
      await client.publish(revision, version, resolve(directory));
    else
      throw new Error(
        "用法：gitee-release.ts check|publish 仓库 提交 版本 [附件目录]",
      );
    console.log(
      `Gitee ${operation === "check" ? "发布权限检查" : "Release 附件及匿名下载验证"}通过`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Gitee 发布失败");
    process.exitCode = 1;
  }
}
