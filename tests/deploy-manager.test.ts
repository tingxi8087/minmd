import { expect, test } from "bun:test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  chmod,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

const root = join(import.meta.dir, "..");
const stub = `#!/usr/bin/env bun
import {readFileSync,writeFileSync,appendFileSync,existsSync} from "node:fs";
const args=process.argv.slice(2),stateFile=process.env.MINMD_FAKE_STATE;
const state=JSON.parse(readFileSync(stateFile,"utf8"));
appendFileSync(process.env.MINMD_TRACE,JSON.stringify({args,projectEnv:process.env.COMPOSE_PROJECT_NAME,passwordEnv:process.env.POSTGRES_PASSWORD})+"\\n");
const save=()=>writeFileSync(stateFile,JSON.stringify(state));
const envIndex=args.indexOf("--env-file");
const env=envIndex<0?{}:Object.fromEntries(readFileSync(args[envIndex+1],"utf8").trim().split("\\n").filter(l=>l.includes("=")&&!l.startsWith("#")).map(l=>[l.slice(0,l.indexOf("=")),l.slice(l.indexOf("=")+1)]));
const foreign=state.foreign;
if(args[0]==="info")process.exit(0);
if(args[0]==="compose" && args[1]==="version"){console.log("2.40.3");process.exit(0);}
if(args[0]==="image" && args[1]==="inspect")process.exit(state.missingImage?1:0);
if(args[0]==="pull")process.exit(state.pullFail?1:0);
if(args[0]==="ps"){
 if(foreign==="container")console.log("foreign");
 else if(state.created)console.log(args.includes("-aq")?"fake-pg\\nfake-app":state.app?"fake-app":"");
 process.exit(0);
}
if(args[0]==="volume" && args[1]==="ls"){if(foreign==="volume")console.log("foreign-volume");process.exit(0);}
if(args[0]==="volume" && args[1]==="inspect"){
 if(foreign==="volume"){console.log("other-owner");process.exit(0);}if(state.created&&!state.missingVolume&&!(state.missingAssets&&args.at(-1).endsWith("_asset_data"))){console.log(state.owner);process.exit(0);}process.exit(1);
}
if(args[0]==="network" && args[1]==="inspect"){
 if(foreign==="network"){console.log("other-owner");process.exit(0);}
 if(!state.created)process.exit(1);
 console.log(args.join(" ").includes("Gateway")?"172.31.42.1":state.owner);process.exit(0);
}
if(args[0]==="inspect"){
 const f=args[args.indexOf("--format")+1]??args.at(-1);
 console.log(f.includes("Labels")?(foreign==="container"?"other-owner":state.owner):f.includes("ExitCode")?"0":f.includes("Health.Status")?"healthy":f.includes("Mounts")?"fake-assets":f.includes("IPAddress")?"172.31.42.3":f.includes("PortBindings")||f.includes("HostPort")?(state.app?"127.0.0.1 "+(state.port??9811):""):"sha256:fixture");process.exit(0);
}
if(args[0]==="run"){
 if(args.includes("-p")){const binding=args[args.indexOf("-p")+1];process.exit(state.occupied && binding.split(":")[1]===String(state.occupied)?1:0);}
 if(args.includes("psql")||args.some(a=>a.includes("exec psql")))process.exit(state.dbFail?1:0);
 if(args.includes("tar")){const mount=args.find(a=>a.endsWith(":/backup"));if(mount)writeFileSync(mount.slice(0,-8)+"/assets.tar.gz","asset-bytes");}process.exit(0);
}
if(args[0]==="compose"){
 if(args.includes("pull"))process.exit(state.pullFail?1:0);
 if(args.includes("ps")){const last=args.at(-1);console.log(last==="postgres"?(state.created?"fake-pg":""):last==="caddy"?"fake-caddy":state.app?"fake-app":"");process.exit(0);}
 if(args.includes("up")){state.created=true;state.owner=env.MINMD_INSTALLATION_ID;state.port=env.APP_BIND_PORT;if(args.at(-1)==="app")state.app=true;save();process.exit(0);}
 if(args.includes("stop")){state.app=false;save();process.exit(0);}
 if(args.includes("run")&&args.at(-1)==="migrate")process.exit(state.migrateFail?23:0);
 if(args.includes("exec")&&args.at(-1).includes("pg_dump"))console.log("database-bytes");
 process.exit(0);
}
`;
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "minmd-manager-"));
  const data = join(dir, "配置 data");
  await mkdir(join(dir, "bin"));
  await mkdir(join(dir, "tmp"));
  const stateFile = join(dir, "state.json"),
    trace = join(dir, "trace");
  await writeFile(stateFile, "{}");
  await writeFile(trace, "");
  await writeFile(join(dir, "bin/docker"), stub);
  await chmod(join(dir, "bin/docker"), 0o700);
  await writeFile(
    join(dir, "bin/curl"),
    '#!/bin/sh\nprintf \'{"database":"connected"}\\n\'\n',
  );
  await chmod(join(dir, "bin/curl"), 0o700);
  const run = async (
    args: string[],
    extra: Record<string, string> = {},
    entry = join(root, "minmd.sh"),
  ) => {
    const p = Bun.spawn(["sh", entry, ...args, "--dir", data], {
      env: {
        ...process.env,
        PATH: `${join(dir, "bin")}:${process.env.PATH}`,
        TMPDIR: join(dir, "tmp"),
        MINMD_FAKE_STATE: stateFile,
        MINMD_TRACE: trace,
        ...extra,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([
      new Response(p.stdout).text(),
      new Response(p.stderr).text(),
      p.exited,
    ]);
    return { code, out, err };
  };
  const change = async (value: Record<string, unknown>) =>
    writeFile(
      stateFile,
      JSON.stringify({
        ...(JSON.parse(await readFile(stateFile, "utf8")) as Record<
          string,
          unknown
        >),
        ...value,
      }),
    );
  const commands = async () =>
    (await readFile(trace, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(
        (l) =>
          JSON.parse(l) as {
            args: string[];
            projectEnv?: string;
            passwordEnv?: string;
          },
      );
  const config = () => readFile(join(data, ".env"), "utf8");
  const install = (mode = "proxy", extra: string[] = []) =>
    run([
      "install",
      "--mode",
      mode,
      "--origin",
      "https://docs.example.com",
      "--image-prefix",
      "minmd-unit",
      "--version",
      "v0.1.0",
      "--offline",
      "--yes",
      ...extra,
    ]);
  return { dir, data, run, change, commands, config, install, trace };
}
const clean = (f: { dir: string }) =>
  rm(f.dir, { recursive: true, force: true });

test("旧配置沿用基础镜像默认值，非法基础镜像在启动前拒绝", async () => {
  const f = await fixture();
  try {
    expect((await f.install()).code).toBe(0);
    const original = await f.config();
    const legacy = original
      .replace(/^POSTGRES_IMAGE=.*\n/m, "")
      .replace(/^CADDY_IMAGE=.*\n/m, "");
    await writeFile(join(f.data, ".env"), legacy);
    expect((await f.run(["restart", "--offline"])).code).toBe(0);
    expect(await f.config()).toBe(legacy);
    for (const image of [
      "postgres:latest",
      "bad;echo injected:18",
      "missing-tag",
    ]) {
      await writeFile(
        join(f.data, ".env"),
        legacy + `POSTGRES_IMAGE=${image}\n`,
      );
      const before = (await f.commands()).length;
      const result = await f.run(["start", "--offline"]);
      expect(result.code).not.toBe(0);
      expect(result.err).toContain("基础镜像");
      const calls = (await f.commands()).slice(before);
      expect(
        calls.some(
          (c) =>
            c.args[0] === "run" ||
            c.args[0] === "pull" ||
            c.args.includes("up"),
        ),
      ).toBe(false);
    }
  } finally {
    await clean(f);
  }
}, 30000);

test("首次安装生成独立凭证；已有反代和自动 HTTPS 选择各自的 Compose，不泄漏 Shell 覆盖", async () => {
  for (const mode of ["proxy", "https"]) {
    const f = await fixture();
    try {
      const result = await f.install(mode);
      expect(result.code).toBe(0);
      const env = await f.config();
      for (const key of [
        "POSTGRES_PASSWORD",
        "ADMIN_PASSWORD",
        "AI_KEY_ENCRYPTION_KEY",
        "MINMD_INSTALLATION_ID",
      ])
        expect(env).toMatch(new RegExp(`^${key}=[a-f0-9]{64}$`, "m"));
      expect((await stat(join(f.data, ".env"))).mode & 0o777).toBe(0o600);
      const commands = await f.commands();
      expect(
        commands
          .filter((c) => c.args[0] === "compose")
          .filter((c) => !c.args.includes("version"))
          .every((c) =>
            c.args.includes(join(root, `deploy/compose.${mode}.yaml`)),
          ),
      ).toBe(true);
      const probes = commands
        .filter((c) => c.args.includes("-p"))
        .map((c) => c.args[c.args.indexOf("-p") + 1]);
      expect(probes).toContain(
        mode === "proxy" ? "127.0.0.1:9811:5432" : "0.0.0.0:80:5432",
      );
      if (mode === "https") expect(probes).toContain("0.0.0.0:443:5432");
      expect(env).toContain(
        `TRUST_PROXY_ADDRESSES=${mode === "proxy" ? "172.31.42.1" : "172.31.42.3"}`,
      );
      await writeFile(f.trace, "");
      const status = await f.run(["status"], {
        COMPOSE_PROJECT_NAME: "wrong-target",
        POSTGRES_PASSWORD: "wrong-secret",
      });
      expect(status.code).toBe(0);
      const compose = (await f.commands()).filter(
        (c) => c.args[0] === "compose" && !c.args.includes("version"),
      );
      expect(
        compose.every(
          (c) => c.projectEnv === undefined && c.passwordEnv === undefined,
        ),
      ).toBe(true);
      expect(status.out).not.toContain(
        env.match(/^POSTGRES_PASSWORD=(.*)$/m)![1]!,
      );
      expect((await f.run(["doctor"])).code).toBe(0);
    } finally {
      await clean(f);
    }
  }
}, 30000);

test("重复安装不重置配置和密钥；指定不同参数拒绝且不改原配置", async () => {
  const f = await fixture();
  try {
    expect((await f.install()).code).toBe(0);
    const before = await f.config();
    expect((await f.run(["install", "--offline", "--yes"])).code).toBe(0);
    expect(await f.config()).toBe(before);
    expect((await f.install("proxy", ["--port", "9812"])).code).not.toBe(0);
    expect(await f.config()).toBe(before);
  } finally {
    await clean(f);
  }
}, 15000);

test("端口、同名容器/卷/网络冲突在创建实例前拒绝，失败不残留新凭证", async () => {
  for (const conflict of [
    { occupied: 9811 },
    { foreign: "container" },
    { foreign: "volume" },
    { foreign: "network" },
  ]) {
    const f = await fixture();
    try {
      await f.change(conflict);
      expect((await f.install()).code).not.toBe(0);
      expect(await Bun.file(join(f.data, ".env")).exists()).toBe(false);
      expect(await Bun.file(join(f.data, ".env.candidate")).exists()).toBe(
        false,
      );
      expect((await f.commands()).some((c) => c.args.includes("up"))).toBe(
        false,
      );
    } finally {
      await clean(f);
    }
  }
}, 20000);

test("443 冲突拒绝自动 HTTPS，已有反代可选择其他端口；自动 HTTPS 不探测 9811", async () => {
  const f = await fixture();
  try {
    await f.change({ occupied: 443 });
    expect((await f.install("https")).err).toContain("443");
    expect((await f.install("proxy", ["--port", "19899"])).code).toBe(0);
  } finally {
    await clean(f);
  }
  const g = await fixture();
  try {
    await g.change({ occupied: 9811 });
    expect((await g.install("https")).code).toBe(0);
  } finally {
    await clean(g);
  }
}, 20000);

test("迁移失败可以继续首次安装，保留原始凭证；错误数据库密码不会重建数据库", async () => {
  const f = await fixture();
  try {
    await f.change({ migrateFail: true });
    expect((await f.install()).code).not.toBe(0);
    const before = await f.config();
    await f.change({ migrateFail: false });
    expect((await f.run(["install", "--offline", "--yes"])).code).toBe(0);
    expect(await f.config()).toBe(before);
    await f.change({ dbFail: true });
    await writeFile(f.trace, "");
    const result = await f.run(["start", "--offline"]);
    expect(result.err).toContain("数据库认证失败");
    expect(
      (await f.commands()).some(
        (c) => c.args.includes("up") && c.args.at(-1) === "postgres",
      ),
    ).toBe(false);
  } finally {
    await clean(f);
  }
}, 20000);

test("配置不执行命令，拒绝损坏配置、加密密钥改动和跨目录复制", async () => {
  const f = await fixture();
  try {
    expect((await f.install()).code).toBe(0);
    const before = await f.config();
    await writeFile(
      join(f.data, ".env"),
      before.replace(
        /^POSTGRES_PASSWORD=.*$/m,
        "POSTGRES_PASSWORD=$(touch injected)",
      ),
    );
    expect((await f.run(["status"])).code).not.toBe(0);
    expect(await Bun.file(join(root, "injected")).exists()).toBe(false);
    await writeFile(
      join(f.data, ".env"),
      before.replace(
        /^AI_KEY_ENCRYPTION_KEY=.*$/m,
        `AI_KEY_ENCRYPTION_KEY=${"a".repeat(64)}`,
      ),
    );
    expect((await f.run(["start", "--offline"])).err).toContain("加密密钥");
    await writeFile(
      join(f.data, ".env"),
      before.replace(
        /^MINMD_INSTALL_DIR=.*$/m,
        "MINMD_INSTALL_DIR=/another/path",
      ),
    );
    expect((await f.run(["status"])).err).toContain("原安装记录");
  } finally {
    await clean(f);
  }
}, 20000);

test("升级先拉取再停写备份，成功更新固定版本；失败保持停止并可重试，不重复备份", async () => {
  const f = await fixture();
  try {
    expect((await f.install()).code).toBe(0);
    const before = await f.config();
    await f.change({ pullFail: true });
    await writeFile(f.trace, "");
    expect((await f.run(["upgrade", "v0.2.0"])).code).not.toBe(0);
    expect(await f.config()).toBe(before);
    expect((await f.commands()).some((c) => c.args.includes("stop"))).toBe(
      false,
    );
    await f.change({ pullFail: false, migrateFail: true });
    await writeFile(f.trace, "");
    expect((await f.run(["upgrade", "v0.2.0", "--offline"])).code).not.toBe(0);
    expect(await Bun.file(join(f.data, ".maintenance")).exists()).toBe(true);
    const commands = await f.commands();
    const stop = commands.findIndex((c) => c.args.includes("stop"));
    const dump = commands.findIndex((c) =>
      c.args.some((a) => a.includes("pg_dump")),
    );
    const migrate = commands.findIndex(
      (c) => c.args.includes("run") && c.args.at(-1) === "migrate",
    );
    expect(stop).toBeLessThan(dump);
    expect(dump).toBeLessThan(migrate);
    expect(
      commands
        .slice(dump, migrate)
        .some((c) => c.args.includes("up") && c.args.at(-1) === "app"),
    ).toBe(false);
    expect((await f.run(["start", "--offline"])).err).toContain("上次升级");
    await f.change({ migrateFail: false });
    await writeFile(f.trace, "");
    expect((await f.run(["upgrade", "v0.2.0", "--offline"])).code).toBe(0);
    expect(
      (await f.commands()).some((c) =>
        c.args.some((a) => a.includes("pg_dump")),
      ),
    ).toBe(false);
    expect(await Bun.file(join(f.data, ".maintenance")).exists()).toBe(false);
    expect(await f.config()).toContain("MINMD_IMAGE_TAG=v0.2.0");
    expect((await f.run(["upgrade", "v0.1.0", "--offline"])).err).toContain(
      "降低版本",
    );
  } finally {
    await clean(f);
  }
}, 30000);

test("统一备份包含受限权限的配置；恢复先确认和校验，使用备份版本并保持应用停止", async () => {
  const f = await fixture();
  try {
    expect((await f.install()).code).toBe(0);
    const backup = join(f.dir, "backup data");
    expect((await f.run(["backup", backup])).code).toBe(0);
    expect((await stat(join(backup, "deployment.env"))).mode & 0o777).toBe(
      0o600,
    );
    await writeFile(f.trace, "");
    expect((await f.run(["restore", backup, "--offline"])).code).not.toBe(0);
    expect((await f.commands()).some((c) => c.args.includes("stop"))).toBe(
      false,
    );
    expect((await f.run(["upgrade", "v0.2.0", "--offline"])).code).toBe(0);
    await writeFile(f.trace, "");
    const result = await f.run(["restore", backup, "--offline", "--yes"]);
    expect(result.code).toBe(0);
    expect(await f.config()).toContain("MINMD_IMAGE_TAG=v0.1.0");
    expect(
      (await f.commands()).some(
        (c) => c.args.includes("up") && c.args.at(-1) === "app",
      ),
    ).toBe(false);
    expect((await f.run(["start", "--offline"])).code).toBe(0);
    await writeFile(join(backup, "assets.tar.gz"), "corrupted");
    await writeFile(f.trace, "");
    expect(
      (await f.run(["restore", backup, "--offline", "--yes"])).code,
    ).not.toBe(0);
    expect((await f.commands()).some((c) => c.args.includes("stop"))).toBe(
      false,
    );
  } finally {
    await clean(f);
  }
}, 30000);

test("首次安装严格校验来源、模式、端口及非交互确认", async () => {
  for (const args of [
    ["--origin", "http://docs.example.com"],
    ["--port", "65536"],
    ["--mode", "wrong"],
    ["--origin", "https://docs.example.com/path"],
    ["--version", "latest"],
    ["--trust-proxy", "0.0.0.0/0"],
  ]) {
    const f = await fixture();
    try {
      expect((await f.install("proxy", args)).code).not.toBe(0);
    } finally {
      await clean(f);
    }
  }
  const f = await fixture();
  try {
    expect(
      (
        await f.run([
          "install",
          "--mode",
          "proxy",
          "--origin",
          "https://docs.example.com",
          "--image-prefix",
          "minmd-unit",
          "--version",
          "v0.1.0",
          "--offline",
        ])
      ).err,
    ).toContain("--yes");
  } finally {
    await clean(f);
  }
}, 30000);

test("数据卷缺失时拒绝创建空库，同一实例的维护锁阻止并发操作", async () => {
  const f = await fixture();
  try {
    expect((await f.install()).code).toBe(0);
    await f.change({ missingVolume: true });
    await writeFile(f.trace, "");
    expect((await f.run(["start", "--offline"])).err).toContain(
      "原数据库卷缺失",
    );
    expect((await f.commands()).some((c) => c.args.includes("up"))).toBe(false);
    await f.change({ missingVolume: false, missingAssets: true });
    expect((await f.run(["start", "--offline"])).err).toContain("原附件卷缺失");
    await f.change({ missingAssets: false });
    await mkdir(join(f.data, ".lock"));
    expect((await f.run(["restart", "--offline"])).err).toContain("维护任务");
    await rm(join(f.data, ".lock"), { recursive: true });
    expect((await f.run(["start", "--offline"])).code).toBe(0);
  } finally {
    await clean(f);
  }
}, 15000);

test("发布包仅包含运行脚本和公开模板，解压后可独立使用 help，携带固定版本和校验文件", async () => {
  const dir = await mkdtemp(join(tmpdir(), "minmd-package-"));
  try {
    const file = join(dir, "minmd-v0.1.0.tar.gz");
    const p = Bun.spawn(
      [
        "sh",
        join(root, "deploy/scripts/package-release.sh"),
        "ghcr.io/example/minmd",
        "v0.1.0",
        file,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(await p.exited).toBe(0);
    const unpack = Bun.spawn(["tar", "xzf", file, "-C", dir], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await unpack.exited).toBe(0);
    expect(
      await Bun.file(join(dir, "minmd/deploy/compose.direct.yaml")).exists(),
    ).toBe(true);
    expect(await readFile(join(dir, "minmd/deploy/release.env"), "utf8")).toBe(
      "MINMD_IMAGE_PREFIX=ghcr.io/example/minmd\nMINMD_IMAGE_TAG=v0.1.0\nMINMD_IMAGE_SOURCE=official\n",
    );
    expect(await Bun.file(join(dir, "minmd/.env")).exists()).toBe(false);
    expect(await Bun.file(join(dir, "minmd/deploy/Dockerfile")).exists()).toBe(
      false,
    );
    const help = Bun.spawn(["sh", join(dir, "minmd/minmd.sh"), "help"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await new Response(help.stdout).text()).toContain("install");
    expect(await help.exited).toBe(0);
    const checksum = Bun.spawn(
      [
        "sh",
        "-c",
        "if command -v sha256sum >/dev/null 2>&1; then sha256sum -c minmd-v0.1.0.tar.gz.sha256; else shasum -a 256 -c minmd-v0.1.0.tar.gz.sha256; fi",
      ],
      { cwd: dir, stdout: "pipe", stderr: "pipe" },
    );
    expect(await checksum.exited).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("IP 直连使用独立 Compose，自动匹配地址端口且不信任代理；安装复用和重启保留配置", async () => {
  const f = await fixture();
  try {
    const result = await f.install("direct", [
      "--origin",
      "http://192.168.1.10:19876",
    ]);
    expect(result.code).toBe(0);
    const before = await f.config();
    expect(before).toContain("APP_BIND_HOST=0.0.0.0");
    expect(before).toContain("APP_BIND_PORT=19876");
    expect(before).toContain("MINMD_TRUST_AUTOMATIC=false");
    expect(before).toMatch(/^TRUST_PROXY_ADDRESSES=$/m);
    const commands = await f.commands();
    expect(commands.some((c) => c.args.includes("0.0.0.0:19876:5432"))).toBe(
      true,
    );
    expect(
      commands
        .filter((c) => c.args[0] === "compose" && !c.args.includes("version"))
        .every((c) =>
          c.args.includes(join(root, "deploy/compose.direct.yaml")),
        ),
    ).toBe(true);
    expect(
      commands.some(
        (c) => c.args.includes("caddy") || c.args.includes("0.0.0.0:443:5432"),
      ),
    ).toBe(false);
    expect((await f.run(["install", "--offline", "--yes"])).code).toBe(0);
    expect((await f.run(["restart", "--offline"])).code).toBe(0);
    expect(await f.config()).toBe(before);
    expect((await f.run(["doctor"])).code).toBe(0);
  } finally {
    await clean(f);
  }
}, 20000);

test("IP 直连拒绝域名、无效 IP、来源端口不匹配和代理参数，且不写入配置", async () => {
  for (const args of [
    ["--origin", "https://192.168.1.10:9811"],
    ["--origin", "http://docs.example.com:9811"],
    ["--origin", "http://999.1.1.1:9811"],
    ["--origin", "http://192.168.01.10:9811"],
    ["--origin", "http://0.0.0.0:9811"],
    ["--origin", "http://255.255.255.255:9811"],
    ["--origin", "http://192.168.1.10:9811", "--port", "9812"],
    ["--origin", "http://192.168.1.10:9811", "--trust-proxy", "127.0.0.1"],
  ]) {
    const f = await fixture();
    try {
      expect((await f.install("direct", args)).code).not.toBe(0);
      expect(await Bun.file(join(f.data, ".env")).exists()).toBe(false);
    } finally {
      await clean(f);
    }
  }
  const f = await fixture();
  try {
    expect(
      (await f.install("direct", ["--origin", "http://192.168.1.10"])).code,
    ).toBe(0);
    expect(await f.config()).toContain("APP_BIND_PORT=80");
  } finally {
    await clean(f);
  }
}, 30000);

test("发布资源绑定实际仓库，一行安装和手动 Release 均调用真实维护入口，重复安装保持凭证", async () => {
  for (const method of [
    "bootstrap",
    "release",
    "china-bootstrap",
    "china-release",
  ]) {
    const china = method.startsWith("china-");
    const prefix = china
      ? "ccr.ccs.tencentyun.com/tingxi8087/minmd"
      : "minmd-unit";
    const metadata = china ? "release-china.env" : "release.env";
    const bootstrap = china ? "install-china.sh" : "install.sh";
    const f = await fixture();
    try {
      const assets = join(f.dir, "release-assets"),
        archive = join(assets, `minmd-v0.1.0${china ? "-china" : ""}.tar.gz`);
      const pack = Bun.spawn(
        [
          "sh",
          join(root, "deploy/scripts/package-release.sh"),
          prefix,
          "v0.1.0",
          archive,
          "example/fork",
          china ? "china" : "official",
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      expect(await pack.exited).toBe(0);
      // BSD tar 的列表会隐藏 AppleDouble；直接检查归档头，确保 Linux 也能安全解压。
      const tar = gunzipSync(await readFile(archive));
      for (let offset = 0; tar[offset];) {
        const header = tar.subarray(offset, offset + 512);
        const name = header.subarray(0, 100).toString().split("\0")[0];
        const type = String.fromCharCode(header[156] || 48);
        expect(name).toMatch(/^minmd(?:\/[A-Za-z0-9_.-]+)*\/?$/);
        expect(["0", "5"]).toContain(type);
        const size = Number.parseInt(
          header.subarray(124, 136).toString().replace(/\0/g, "").trim(),
          8,
        );
        offset += 512 + Math.ceil(size / 512) * 512;
      }
      expect(await readFile(join(assets, metadata), "utf8")).toBe(
        `MINMD_IMAGE_PREFIX=${prefix}\nMINMD_IMAGE_TAG=v0.1.0\nMINMD_IMAGE_SOURCE=${china ? "china" : "official"}\n` +
          (china
            ? `POSTGRES_IMAGE=${prefix}-postgres:18\nCADDY_IMAGE=${prefix}-caddy:2.11.4-alpine\n`
            : ""),
      );
      expect(await readFile(join(assets, bootstrap), "utf8")).toContain(
        "MINMD_DEFAULT_REPOSITORY=example/fork",
      );
      const target = join(f.dir, "installed"),
        bootTrace = join(f.dir, "downloads");
      await writeFile(bootTrace, "");
      await writeFile(
        join(f.dir, "bin/curl"),
        `#!/bin/sh
output= url=
while [ "$#" -gt 0 ]; do
  case "$1" in --output) output=$2; shift 2 ;; https://*) url=$1; shift ;; *) shift ;; esac
done
printf '%s\\n' "$url" >> "$MINMD_BOOT_TRACE"
name=REPLACE_SHELL_NAME
cp "$MINMD_BOOT_ASSETS/$name" "$output"
`.replace("REPLACE_SHELL_NAME", "$" + "{url##*/}"),
      );
      const env = { MINMD_BOOT_TRACE: bootTrace, MINMD_BOOT_ASSETS: assets };
      const options = [
        "--mode",
        "direct",
        "--origin",
        "http://192.0.2.10:19891",
        "--offline",
        "--yes",
      ];
      if (method.endsWith("bootstrap")) {
        const result = await f.run(
          ["--install-dir", target, "--", ...options],
          env,
          join(assets, bootstrap),
        );
        if (result.code) throw new Error(result.err);
        expect(result.code).toBe(0);
        expect(await readFile(bootTrace, "utf8")).toContain(
          `https://github.com/example/fork/releases/latest/download/${metadata}`,
        );
        const config = await f.config();
        await writeFile(bootTrace, "");
        expect(
          (
            await f.run(
              ["--install-dir", target, "--", "--offline", "--yes"],
              env,
              join(assets, bootstrap),
            )
          ).code,
        ).toBe(0);
        expect(await f.config()).toBe(config);
        expect(await readFile(bootTrace, "utf8")).toBe("");
      } else {
        const extract = Bun.spawn(["tar", "xzf", archive, "-C", f.dir], {
          stdout: "pipe",
          stderr: "pipe",
        });
        expect(await extract.exited).toBe(0);
        expect(
          (
            await f.run(
              ["install", ...options],
              {},
              join(f.dir, "minmd/minmd.sh"),
            )
          ).code,
        ).toBe(0);
      }
      if (china) {
        expect(await f.config()).toContain(
          `POSTGRES_IMAGE=${prefix}-postgres:18`,
        );
        expect(await f.config()).toContain(
          `CADDY_IMAGE=${prefix}-caddy:2.11.4-alpine`,
        );
        await f.change({ missingImage: true });
        expect((await f.run(["upgrade", "v0.1.1", "--yes"])).code).toBe(0);
        const backup = join(f.dir, "国内源备份");
        expect((await f.run(["backup", backup])).code).toBe(0);
        expect((await f.run(["restore", backup, "--yes"])).code).toBe(0);
        const calls = await f.commands();
        expect(
          calls.some(
            (c) =>
              c.args[0] === "pull" && c.args[1] === `${prefix}-postgres:18`,
          ),
        ).toBe(true);
        expect(
          calls.some(
            (c) =>
              c.args.includes("postgres:18") ||
              c.args.includes("caddy:2.11.4-alpine"),
          ),
        ).toBe(false);
      }
      expect(await f.config()).toContain("MINMD_DEPLOY_MODE=direct");
      expect(
        (await f.config()).match(/^POSTGRES_PASSWORD=[a-f0-9]{64}$/m),
      ).not.toBeNull();
    } finally {
      await clean(f);
    }
  }
}, 60000);
