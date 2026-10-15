import { expect, test } from "bun:test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  chmod,
  symlink,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
const root = join(import.meta.dir, "..");
const installer = join(root, "install.sh");
const command = async (args: string[], env = process.env) => {
  const child = Bun.spawn(args, { env, stdout: "pipe", stderr: "pipe" });
  const [code, out, err] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, out, err };
};
async function fixture(
  options: {
    downloader?: "curl" | "wget" | "none";
    checksum?: "sha256sum" | "shasum" | "none";
    docker?: "ok" | "missing" | "stopped" | "old" | "compose-missing";
    missing?: string;
    imageSource?: "official" | "china";
  } = {},
) {
  const dir = await mkdtemp(join(tmpdir(), "minmd-bootstrap-")),
    bin = join(dir, "bin"),
    assets = join(dir, "assets"),
    target = join(dir, "安装 data"),
    trace = join(dir, "calls");
  await mkdir(bin);
  await mkdir(assets);
  await writeFile(trace, "");
  const executable = async (name: string, body: string) => {
    const path = join(bin, name);
    await writeFile(path, body);
    await chmod(path, 0o700);
  };
  for (const name of [
    "sh",
    "uname",
    "awk",
    "grep",
    "sed",
    "tr",
    "tar",
    "gzip",
    "mktemp",
    "mkdir",
    "mv",
    "rm",
    "rmdir",
    "chmod",
    "df",
    "dirname",
    "cat",
  ]) {
    if (options.missing === name) continue;
    const result = await command([
      "/bin/sh",
      "-c",
      'command -v "$1"',
      "sh",
      name,
    ]);
    if (result.code) throw Error(`本机缺少 ${name}`);
    await symlink(result.out.trim(), join(bin, name));
  }
  if (options.docker !== "missing")
    await executable(
      "docker",
      `#!/bin/sh
case "$1 $2" in
  'info ') exit ${options.docker === "stopped" ? 1 : 0} ;;
  'compose version') ${options.docker === "compose-missing" ? "exit 1" : `echo '${options.docker === "old" ? "2.19.9" : "2.40.3"}'`} ;;
esac
`,
    );
  const checksum = options.checksum ?? "sha256sum";
  if (checksum !== "none") {
    const real = (
      await command(["/bin/sh", "-c", 'command -v "$1"', "sh", checksum])
    ).out.trim();
    if (!real) throw Error(`本机缺少 ${checksum}`);
    await symlink(real, join(bin, checksum));
  }
  const downloader = options.downloader ?? "curl";
  if (downloader !== "none")
    await executable(
      downloader,
      `#!/bin/sh
output= url=
while [ "$#" -gt 0 ]; do
  case "$1" in --output|-O) output=$2; shift 2 ;; https://*) url=$1; shift ;; *) shift ;; esac
done
printf '%s\\n' "$url" >> "$MINMD_TEST_TRACE"
[ ! -f "$MINMD_TEST_ASSETS/fail-download" ] || exit 22
name=\${url##*/}
[ -f "$MINMD_TEST_ASSETS/$name" ] || exit 22
cat "$MINMD_TEST_ASSETS/$name" > "$output"
`,
    );
  const bundle = join(dir, "bundle/minmd");
  await mkdir(join(bundle, "deploy/scripts"), { recursive: true });
  await writeFile(
    join(bundle, "deploy/scripts/manage.sh"),
    "#!/bin/sh\nexit 0\n",
  );
  await writeFile(
    join(bundle, "deploy/release.env"),
    "MINMD_IMAGE_PREFIX=ghcr.io/example/minmd\nMINMD_IMAGE_TAG=v0.1.0\n",
  );
  await writeFile(
    join(bundle, "minmd.sh"),
    `#!/bin/sh
printf '%s\\n' "$@" > "$MINMD_TEST_ARGUMENTS"
if [ "$MINMD_TEST_INTERACTIVE" = true ]; then
  [ -t 0 ] || { echo '没有终端' >&2; exit 9; }
  printf '测试安装方式：'
  IFS= read -r answer
  printf '%s\\n' "$answer" > "$MINMD_TEST_ANSWER"
fi
[ ! -f "$MINMD_TEST_ASSETS/fail-install" ] || exit 23
printf '安装向导完成\\n'
`,
  );
  const archiveName = `minmd-v0.1.0${options.imageSource === "china" ? "-china" : ""}.tar.gz`;
  const archive = join(assets, archiveName);
  if (options.imageSource === "china") {
    await writeFile(
      join(bundle, "deploy/release.env"),
      "MINMD_IMAGE_PREFIX=ccr.ccs.tencentyun.com/tingxi8087/minmd\nMINMD_IMAGE_TAG=v0.1.0\nMINMD_IMAGE_SOURCE=china\n",
    );
  }
  const repack = async () => {
    const packed = await command([
      "tar",
      "czf",
      archive,
      "-C",
      join(dir, "bundle"),
      "minmd",
    ]);
    if (packed.code) throw Error(packed.err);
    const hash = createHash("sha256")
      .update(await readFile(archive))
      .digest("hex");
    await writeFile(archive + ".sha256", `${hash}  ${archiveName}\n`);
  };
  await repack();
  await writeFile(
    join(
      assets,
      options.imageSource === "china" ? "release-china.env" : "release.env",
    ),
    "MINMD_IMAGE_PREFIX=ghcr.io/example/minmd\nMINMD_IMAGE_TAG=v0.1.0\n",
  );
  const env = {
    ...process.env,
    PATH: bin,
    MINMD_TEST_ASSETS: assets,
    MINMD_TEST_TRACE: trace,
    MINMD_TEST_ARGUMENTS: join(dir, "args"),
    MINMD_TEST_ANSWER: join(dir, "answer"),
    MINMD_TEST_INTERACTIVE: "false",
  };
  const run = (
    args: string[] = [
      "--",
      "--mode",
      "direct",
      "--origin",
      "http://192.0.2.10:9811",
      "--yes",
    ],
  ) => command(["/bin/sh", installer, "--install-dir", target, ...args], env);
  return { dir, bin, assets, target, trace, bundle, env, repack, run };
}
const clean = (f: { dir: string }) =>
  rm(f.dir, { recursive: true, force: true });

test("国内入口下载独立部署包，重复安装不跨镜像源改写已有部署", async () => {
  const f = await fixture({ imageSource: "china" });
  const args = ["--image-source", "china", "--", "--yes"];
  try {
    expect((await f.run(args)).code).toBe(0);
    const downloads = await readFile(f.trace, "utf8");
    expect(downloads).toContain("/latest/download/release-china.env");
    expect(downloads).toContain("/download/v0.1.0/minmd-v0.1.0-china.tar.gz\n");
    expect(downloads).toContain("minmd-v0.1.0-china.tar.gz.sha256");
    expect(await readFile(join(f.dir, "args"), "utf8")).toBe(
      "install\n--yes\n",
    );
    await writeFile(f.trace, "");
    expect((await f.run(args)).code).toBe(0);
    expect(await readFile(f.trace, "utf8")).toBe("");
    const otherSource = await f.run(["--", "--yes"]);
    expect(otherSource.code).not.toBe(0);
    expect(otherSource.err).toContain("另一镜像源");
    expect(await readFile(f.trace, "utf8")).toBe("");
  } finally {
    await clean(f);
  }
}, 30000);

test("国内包内部源错误及未知下载源在安装前拒绝", async () => {
  const f = await fixture({ imageSource: "china" });
  try {
    await writeFile(
      join(f.bundle, "deploy/release.env"),
      "MINMD_IMAGE_TAG=v0.1.0\nMINMD_IMAGE_SOURCE=official\n",
    );
    await f.repack();
    const mismatch = await f.run(["--image-source", "china", "--", "--yes"]);
    expect(mismatch.code).not.toBe(0);
    expect(mismatch.err).toContain("内部镜像源");
    expect(await Bun.file(join(f.target, "minmd.sh")).exists()).toBe(false);
    await writeFile(f.trace, "");
    const unknown = await f.run(["--image-source", "other", "--", "--yes"]);
    expect(unknown.code).not.toBe(0);
    expect(await readFile(f.trace, "utf8")).toBe("");
  } finally {
    await clean(f);
  }
}, 30000);

test("最新稳定版下载、校验、路径含空格和中文，向导参数按原样传递", async () => {
  const f = await fixture();
  try {
    const result = await f.run();
    expect(result.code).toBe(0);
    expect(result.out).toContain("安装向导完成");
    expect(await readFile(join(f.dir, "args"), "utf8")).toBe(
      "install\n--mode\ndirect\n--origin\nhttp://192.0.2.10:9811\n--yes\n",
    );
    const downloads = await readFile(f.trace, "utf8");
    expect(downloads).toContain(
      "https://github.com/tingxi8087/minmd/releases/latest/download/release.env",
    );
    expect(downloads).toContain("/download/v0.1.0/minmd-v0.1.0.tar.gz.sha256");
    expect(
      (await readdir(f.dir)).some(
        (name) =>
          name.includes(".minmd-download") || name.endsWith(".bootstrap-lock"),
      ),
    ).toBe(false);
  } finally {
    await clean(f);
  }
}, 30000);
test("指定版本绕过 latest；wget 和 shasum 备用工具可以完成安装", async () => {
  const f = await fixture({ downloader: "wget", checksum: "shasum" });
  try {
    expect(
      (
        await f.run([
          "--repo",
          "example/fork",
          "--version",
          "v0.1.0",
          "--",
          "--yes",
        ])
      ).code,
    ).toBe(0);
    const downloads = await readFile(f.trace, "utf8");
    expect(downloads).not.toContain("/latest/");
    expect(downloads).toContain(
      "https://github.com/example/fork/releases/download/v0.1.0/",
    );
  } finally {
    await clean(f);
  }
}, 30000);
test("缺环境时提示对应原因，在联网和写入部署文件前退出，不自动安装环境", async () => {
  for (const [options, text] of [
    [{ docker: "missing" }, "未安装 Docker"],
    [{ docker: "stopped" }, "Docker 不可用"],
    [{ docker: "old" }, "版本过旧"],
    [{ docker: "compose-missing" }, "缺少 Docker Compose"],
    [{ downloader: "none" }, "缺少 curl 或 wget"],
    [{ checksum: "none" }, "缺少 sha256sum 或 shasum"],
    [{ missing: "tar" }, "缺少工具 tar"],
    [{ missing: "gzip" }, "缺少工具 gzip"],
  ] as const) {
    const f = await fixture(options);
    try {
      const result = await f.run();
      expect(result.code).not.toBe(0);
      expect(result.err).toContain(text);
      expect(await readFile(f.trace, "utf8")).toBe("");
      expect(await Bun.file(join(f.target, "minmd.sh")).exists()).toBe(false);
    } finally {
      await clean(f);
    }
  }
}, 30000);
test("无终端不读取脚本作为向导回答；参数和版本校验拒绝命令注入", async () => {
  for (const [args, text] of [
    [[], "没有交互终端"],
    [["--version", "latest;touch bad"], "--version"],
    [["--repo", "x/../../bad"], "--repo"],
    [["--version", "v0.1.0\nanything"], "换行"],
    [["--unknown"], "未知入口选项"],
  ] as [string[], string][]) {
    const f = await fixture();
    try {
      const r = await f.run(args);
      expect(r.code).not.toBe(0);
      expect(r.err).toContain(text);
      expect(await readFile(f.trace, "utf8")).toBe("");
    } finally {
      await clean(f);
    }
  }
}, 30000);
test("下载失败、校验失败和缺失必要文件均不产生安装目录，临时目录和锁清理", async () => {
  for (const fault of [
    "download",
    "checksum",
    "checksum-name",
    "missing",
    "version",
  ]) {
    const f = await fixture();
    try {
      if (fault === "download")
        await writeFile(join(f.assets, "fail-download"), "");
      if (fault === "checksum")
        await writeFile(
          join(f.assets, "minmd-v0.1.0.tar.gz.sha256"),
          `${"0".repeat(64)}  minmd-v0.1.0.tar.gz\n`,
        );
      if (fault === "checksum-name")
        await writeFile(
          join(f.assets, "minmd-v0.1.0.tar.gz.sha256"),
          `${"0".repeat(64)}  ../../outside\n`,
        );
      if (fault === "missing") {
        await rm(join(f.bundle, "deploy/scripts/manage.sh"));
        await f.repack();
      }
      if (fault === "version") {
        await writeFile(
          join(f.bundle, "deploy/release.env"),
          "MINMD_IMAGE_TAG=v9.9.9\n",
        );
        await f.repack();
      }
      const r = await f.run();
      expect(r.code).not.toBe(0);
      expect(await Bun.file(join(f.target, "minmd.sh")).exists()).toBe(false);
      expect(
        (await readdir(f.dir)).some(
          (name) =>
            name.includes(".minmd-download") ||
            name.endsWith(".bootstrap-lock"),
        ),
      ).toBe(false);
    } finally {
      await clean(f);
    }
  }
}, 30000);
test("版本元数据不执行 Shell，拒绝重复版本和错误 latest 测试版本", async () => {
  for (const value of [
    "MINMD_IMAGE_TAG=$(touch injected)\n",
    "MINMD_IMAGE_TAG=v0.1.0\nMINMD_IMAGE_TAG=v0.2.0\n",
    "MINMD_IMAGE_TAG=v0.1.0-rc.1\n",
  ]) {
    const f = await fixture();
    try {
      await writeFile(join(f.assets, "release.env"), value);
      expect((await f.run()).code).not.toBe(0);
      expect(await Bun.file(join(f.dir, "injected")).exists()).toBe(false);
    } finally {
      await clean(f);
    }
  }
}, 30000);
test("归档中的符号链接与外部目录被拒绝，不落盘执行", async () => {
  for (const type of ["link", "outside"]) {
    const f = await fixture();
    try {
      if (type === "link") {
        await symlink("../../outside", join(f.bundle, "escape"));
        await f.repack();
      } else {
        await writeFile(join(f.dir, "bundle/outside"), "outside");
        const archive = join(f.assets, "minmd-v0.1.0.tar.gz");
        expect(
          (
            await command([
              "tar",
              "czf",
              archive,
              "-C",
              join(f.dir, "bundle"),
              "minmd",
              "outside",
            ])
          ).code,
        ).toBe(0);
        await writeFile(
          archive + ".sha256",
          `${createHash("sha256")
            .update(await readFile(archive))
            .digest("hex")}  minmd-v0.1.0.tar.gz\n`,
        );
      }
      const result = await f.run();
      expect(result.code).not.toBe(0);
      expect(result.err).toMatch(/路径|链接/);
      expect(await Bun.file(join(f.target, "minmd.sh")).exists()).toBe(false);
    } finally {
      await clean(f);
    }
  }
}, 30000);
test("已有部署重复安装不下载不覆盖；更换版本和非部署目录拒绝", async () => {
  const f = await fixture();
  try {
    expect((await f.run()).code).toBe(0);
    await writeFile(join(f.target, ".local-marker"), "keep");
    await writeFile(f.trace, "");
    expect((await f.run()).code).toBe(0);
    expect(await readFile(f.trace, "utf8")).toBe("");
    expect(await readFile(join(f.target, ".local-marker"), "utf8")).toBe(
      "keep",
    );
    const version = await f.run(["--version", "v0.2.0", "--", "--yes"]);
    expect(version.code).not.toBe(0);
    expect(version.err).toContain("upgrade");
  } finally {
    await clean(f);
  }
  const g = await fixture();
  try {
    await mkdir(g.target);
    expect((await g.run()).err).toContain("不会覆盖");
  } finally {
    await clean(g);
  }
}, 30000);
test("向导失败保留已校验部署包以便重试，传播失败退出码；锁与符号链接不能覆盖", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.assets, "fail-install"), "");
    expect((await f.run()).code).toBe(23);
    expect(await Bun.file(join(f.target, "minmd.sh")).exists()).toBe(true);
    await rm(join(f.assets, "fail-install"));
    expect((await f.run()).code).toBe(0);
  } finally {
    await clean(f);
  }
  const g = await fixture();
  try {
    await mkdir(g.target + ".bootstrap-lock");
    expect((await g.run()).err).toContain("正在执行");
    expect((await readdir(g.dir)).includes("安装 data.bootstrap-lock")).toBe(
      true,
    );
  } finally {
    await clean(g);
  }
  const h = await fixture();
  try {
    await symlink(h.assets, h.target);
    expect((await h.run()).err).toContain("符号链接");
  } finally {
    await clean(h);
  }
}, 30000);
test("管道脚本下载被截断时不会执行半份安装流程", async () => {
  const f = await fixture();
  try {
    const script = await readFile(installer, "utf8"),
      broken = join(f.dir, "broken.sh");
    await writeFile(
      broken,
      script.slice(0, script.indexOf("MINMD_RELEASE_URL=")),
    );
    const result = await command(["/bin/sh", broken], f.env);
    expect(result.code).not.toBe(0);
    expect(await readFile(f.trace, "utf8")).toBe("");
  } finally {
    await clean(f);
  }
}, 30000);

test("curl 管道安装仍从控制终端接收向导回答", async () => {
  const python = Bun.which("python3");
  if (!python)
    throw new Error("终端回归测试需要 python3（仅开发测试，用户部署不需要）");
  const f = await fixture();
  try {
    const probe = join(f.dir, "terminal-probe.py");
    await writeFile(
      probe,
      `import os, pty, select, sys, time
pid, fd = pty.fork()
if pid == 0:
    os.execve('/bin/sh', ['sh', '-c', 'cat "$1" | sh -s -- --install-dir "$2"', 'sh', sys.argv[1], sys.argv[2]], dict(os.environ))
data = b''
sent = False
end = time.time() + 15
while time.time() < end:
    ready, _, _ = select.select([fd], [], [], 0.2)
    if not ready:
        continue
    try:
        chunk = os.read(fd, 4096)
    except OSError:
        break
    if not chunk:
        break
    data += chunk
    if not sent and '测试安装方式：'.encode() in data:
        os.write(fd, b'3'+bytes([10]))
        sent = True
else:
    os.kill(pid, 9)
_, status = os.waitpid(pid, 0)
sys.stdout.buffer.write(data)
sys.exit(os.waitstatus_to_exitcode(status))
`,
    );
    const result = await command([python, probe, installer, f.target], {
      ...f.env,
      MINMD_TEST_INTERACTIVE: "true",
    });
    if (result.code) throw new Error(result.err + result.out);
    expect(result.code).toBe(0);
    expect(result.out).toContain("安装向导完成");
    expect(await readFile(join(f.dir, "answer"), "utf8")).toBe("3\n");
  } finally {
    await clean(f);
  }
}, 30000);

test("磁盘不足和无效安装目录在下载前拒绝", async () => {
  const f = await fixture();
  try {
    await rm(join(f.bin, "df"));
    await writeFile(
      join(f.bin, "df"),
      '#!/bin/sh\necho "disk 100 99 1 99% /"\n',
    );
    await chmod(join(f.bin, "df"), 0o700);
    expect((await f.run()).err).toContain("空间不足");
    expect(await readFile(f.trace, "utf8")).toBe("");
  } finally {
    await clean(f);
  }
  const g = await fixture();
  try {
    expect((await g.run(["--install-dir", "/", "--", "--yes"])).err).toContain(
      "根目录",
    );
    expect(await readFile(g.trace, "utf8")).toBe("");
  } finally {
    await clean(g);
  }
}, 30000);
