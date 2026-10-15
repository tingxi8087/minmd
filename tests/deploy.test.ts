import { test, expect } from "bun:test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  chmod,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
const projectRoot = join(import.meta.dir, "..");
const dockerStub = `#!/usr/bin/env bun
import { appendFileSync, writeFileSync } from "node:fs";
const args=process.argv.slice(2);appendFileSync(process.env.MINMD_DEPLOY_TRACE, JSON.stringify(args)+"\\n");
if(args[0]==="compose" && args.includes("ps")){console.log(args.at(-1)==="app"?"fake-app":"fake-web");}
if(args[0]==="inspect"){
 const format=args.at(-1);
 console.log(format.includes("ExitCode")?(process.env.MINMD_FAKE_EXIT??"0"):format.includes("Mounts")?"fake-asset-volume":"sha256:fixture");
}
if(args[0]==="compose" && args.includes("exec") && args.at(-1).includes("pg_dump")) console.log("database-fixture");
if(args[0]==="run" && args.includes("tar")){
 const mount=args.find(value=>value.endsWith(":/backup"));writeFileSync(mount.slice(0,-8)+"/assets.tar.gz", "assets-fixture");
}
`;
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "minmd-deploy-test-"));
  await mkdir(join(root, "bin"));
  await writeFile(join(root, "bin/docker"), dockerStub);
  await chmod(join(root, "bin/docker"), 0o700);
  await writeFile(join(root, "env"), "fixture=true\n");
  const trace = join(root, "trace");
  await writeFile(trace, "");
  const run = async (script: string, args: string[], exit = "0") => {
    const child = Bun.spawn(
      [
        "sh",
        join(projectRoot, "deploy/scripts", script),
        join(root, "env"),
        ...args,
      ],
      {
        env: {
          ...process.env,
          PATH: `${join(root, "bin")}:${process.env.PATH}`,
          MINMD_DEPLOY_TRACE: trace,
          MINMD_FAKE_EXIT: exit,
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    return {
      code: await child.exited,
      output: await new Response(child.stdout).text(),
      error: await new Response(child.stderr).text(),
    };
  };
  const commands = async () =>
    (await readFile(trace, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as string[]);
  return { root, trace, run, commands };
}
test("备份停止统一应用入口及房间，正常退出后再收集数据库与附件", async () => {
  const f = await fixture();
  try {
    const result = await f.run("backup.sh", [join(f.root, "backup")]);
    expect(result.code).toBe(0);
    const commands = await f.commands();
    const stopApp = commands.findIndex(
      (args) => args.includes("stop") && args.at(-1) === "app",
    );
    const dump = commands.findIndex((args) => args.at(-1)?.includes("pg_dump"));
    const archive = commands.findIndex((args) => args.includes("tar"));
    expect(commands.some((args) => args.includes("web"))).toBe(false);
    expect(stopApp).toBeGreaterThanOrEqual(0);
    expect(stopApp).toBeLessThan(dump);
    expect(dump).toBeLessThan(archive);
    expect(await readFile(join(f.root, "backup/SHA256SUMS"), "utf8")).toContain(
      "database.dump",
    );
    expect(
      commands
        .slice(archive)
        .some((args) => args.includes("up") && args.at(-1) === "app"),
    ).toBe(true);
    const reused = await f.run("backup.sh", [join(f.root, "backup")]);
    expect(reused.code).not.toBe(0);
    expect(reused.error).toContain("已存在");
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
test("协作进程异常退出拒绝一致备份且不重新开放写入", async () => {
  const f = await fixture();
  try {
    const result = await f.run("backup.sh", [join(f.root, "failed")], "1");
    expect(result.code).not.toBe(0);
    const commands = await f.commands();
    expect(commands.some((args) => args.at(-1)?.includes("pg_dump"))).toBe(
      false,
    );
    expect(commands.some((args) => args.includes("up"))).toBe(false);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
test("恢复必须显式确认并校验备份，失败不接触目标数据", async () => {
  const f = await fixture();
  try {
    await f.run("backup.sh", [join(f.root, "backup")]);
    await writeFile(f.trace, "");
    expect((await f.run("restore.sh", [join(f.root, "backup")])).code).not.toBe(
      0,
    );
    expect(await f.commands()).toHaveLength(0);
    await writeFile(join(f.root, "backup/assets.tar.gz"), "corrupted");
    expect(
      (await f.run("restore.sh", [join(f.root, "backup"), "--replace-data"]))
        .code,
    ).not.toBe(0);
    expect(await f.commands()).toHaveLength(0);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
test("恢复等待数据库、单事务导入并保持应用停止供独立核验", async () => {
  const f = await fixture();
  try {
    await f.run("backup.sh", [join(f.root, "backup")]);
    await writeFile(f.trace, "");
    const result = await f.run("restore.sh", [
      join(f.root, "backup"),
      "--replace-data",
    ]);
    expect(result.code).toBe(0);
    const commands = await f.commands();
    expect(
      commands.some(
        (args) => args.includes("--wait") && args.at(-1) === "postgres",
      ),
    ).toBe(true);
    expect(
      commands.some(
        (args) =>
          args.at(-1)?.includes("pg_restore") &&
          args.at(-1)?.includes("--single-transaction"),
      ),
    ).toBe(true);
    expect(
      commands.some(
        (args) =>
          args.includes("up") && ["web", "app"].includes(args.at(-1) ?? ""),
      ),
    ).toBe(false);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
