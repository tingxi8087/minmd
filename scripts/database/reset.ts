import {
  access,
  chmod,
  cp,
  lstat,
  mkdir,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { Client } from "pg";
import { closeClientOnce } from "./close-client";

const identifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;

export async function postgresTool(name: string) {
  const directories = process.env.PG_BIN
    ? [process.env.PG_BIN]
    : [
        ...(process.env.PATH ?? "").split(":"),
        ...["18", "17", "16", "15", "14"].flatMap((version) => [
          `/Library/PostgreSQL/${version}/bin`,
          `/opt/homebrew/opt/postgresql@${version}/bin`,
          `/Applications/Postgres.app/Contents/Versions/${version}/bin`,
        ]),
        "/opt/homebrew/opt/libpq/bin",
      ];
  for (const directory of directories) {
    const path = join(directory, name);
    try {
      await access(path, constants.X_OK);
      return path;
    } catch {
      /* try next */
    }
  }
  throw new Error(
    `找不到 ${name}，请安装 PostgreSQL 客户端，或通过 PG_BIN 指定其 bin 目录。`,
  );
}

async function command(args: string[], connectionString?: string) {
  // 密码仅通过子进程环境传递，不放入命令参数和日志。
  const connection = connectionString ? new URL(connectionString) : undefined;
  const password =
    connection?.searchParams.get("password") ??
    (connection ? decodeURIComponent(connection.password) : undefined);
  if (connection) {
    connection.password = "";
    connection.searchParams.delete("password");
  }
  const child = Bun.spawn(
    connection ? [...args, "--dbname", connection.href] : args,
    {
      env: {
        ...process.env,
        ...(password !== undefined ? { PGPASSWORD: password } : {}),
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [status, output] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (status !== 0)
    throw new Error(
      `${args[0]?.split("/").at(-1)} 执行失败（退出码 ${status}）；请检查工具版本、连接及权限。未输出可能含凭据的工具错误。`,
    );
  return output.trim();
}

async function privateTree(path: string) {
  const info = await lstat(path);
  if (info.isSymbolicLink()) throw new Error("迁移备份中不允许符号链接。");
  await chmod(path, info.isDirectory() ? 0o700 : 0o600);
  if (info.isDirectory())
    for (const entry of await readdir(path))
      await privateTree(join(path, entry));
}

export interface ResetOptions {
  root: string;
  connectionString: string;
  confirm: (question: string) => Promise<string>;
  log?: (message: string) => void;
}

/** 仅由交互式 CLI 调用；可注入确认函数，以便在独立数据库验证完整流程。 */
export async function resetDatabase({
  root,
  connectionString,
  confirm,
  log = console.log,
}: ResetOptions) {
  const url = new URL(connectionString);
  if (!/^postgres(ql)?:$/.test(url.protocol))
    throw new Error("DATABASE_URL 必须是 PostgreSQL 连接。");
  const target = new Client({
    connectionString,
    connectionTimeoutMillis: 5000,
    query_timeout: 15000,
  });
  const closeTarget = closeClientOnce(target);
  let backup: string | undefined;
  let phase = "尚未修改数据库";
  let manifest: Record<string, unknown> | undefined;
  const save = async () => {
    if (backup && manifest)
      await writeFile(
        join(backup, "manifest.json"),
        JSON.stringify({ ...manifest, phase }, null, 2) + "\n",
        { mode: 0o600 },
      );
  };
  try {
    await target.connect();
    const {
      rows: [db],
    } = await target.query(`
      select d.datname, pg_get_userbyid(d.datdba) as owner,
        pg_encoding_to_char(d.encoding) as encoding, d.datcollate, d.datctype,
        to_jsonb(d)->>'datlocprovider' as provider,
        coalesce(to_jsonb(d)->>'datlocale', to_jsonb(d)->>'daticulocale') as locale,
        d.datistemplate, version() as version
      from pg_database d where d.datname = current_database()
    `);
    if (
      !db ||
      db.datistemplate ||
      ["postgres", "template0", "template1"].includes(db.datname)
    )
      throw new Error("不允许重置 PostgreSQL 维护库或模板库。");
    const migrations = resolve(root, "database/migrations");
    const backups = resolve(root, "backups");
    log(
      `目标：${url.hostname}:${url.port || "5432"}/${db.datname}\n迁移目录：${migrations}\n备份目录：${backups}\n请先停止项目服务及其他写入程序。此操作会删除并重建整个目标数据库。`,
    );
    if ((await confirm("第一次确认：请输入完整数据库名称：")) !== db.datname) {
      log("已取消，未修改数据库及迁移文件。");
      return;
    }
    const dump = await postgresTool("pg_dump");
    const restore = await postgresTool("pg_restore");
    const version = await command([dump, "--version"]);
    await mkdir(backups, { recursive: true, mode: 0o700 });
    if ((await lstat(backups)).isSymbolicLink())
      throw new Error("backups 不允许是符号链接。");
    await chmod(backups, 0o700);
    backup = join(
      backups,
      `${db.datname.replace(/[^a-zA-Z0-9_-]/g, "_")}_${new Date().toISOString().replace(/[:.]/g, "-")}_${crypto.randomUUID().slice(0, 8)}`,
    );
    await mkdir(backup, { mode: 0o700 });
    manifest = {
      database: db.datname,
      host: url.hostname,
      port: url.port || "5432",
      createdAt: new Date().toISOString(),
      serverVersion: db.version,
      dumpVersion: version,
      migrationsPresent: false,
    };
    await save();
    const archive = join(backup, "database.dump");
    await writeFile(archive, "", { mode: 0o600 });
    log("正在备份数据库……");
    await command(
      [dump, "--no-password", "--format=custom", "--create", "--file", archive],
      connectionString,
    );
    await chmod(archive, 0o600);
    const contents = await command([restore, "--list", archive]);
    // 解析完整归档数据，而不只是读取目录；不连接数据库、不执行 SQL。
    await command([restore, "--file", "/dev/null", archive]);
    await writeFile(join(backup, "archive-list.txt"), contents + "\n", {
      mode: 0o600,
    });
    let info;
    try {
      info = await lstat(migrations);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (info) {
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error("迁移路径必须是普通目录。");
      await cp(migrations, join(backup, "migrations"), { recursive: true });
      await privateTree(join(backup, "migrations"));
      manifest.migrationsPresent = true;
    }
    const hasher = createHash("sha256");
    for await (const chunk of Bun.file(archive).stream()) hasher.update(chunk);
    manifest.sha256 = hasher.digest("hex");
    phase = "备份完成并通过归档读取检查";
    await save();
    log(`备份完成：${backup}\n检查通过仅表示归档可读取，不等同于恢复演练。`);
    if (
      (await confirm("第二次确认：输入 RESET 删除目标数据库及迁移文件：")) !==
      "RESET"
    ) {
      log("已取消清库，备份已保留。");
      return;
    }
    // 先断开自身连接，DROP 不使用 FORCE；其他连接存在时由 PostgreSQL 拒绝。
    log("已收到 RESET，正在关闭目标数据库连接……");
    await closeTarget();
    const maintenanceUrl = new URL(connectionString);
    maintenanceUrl.pathname = "/postgres";
    const maintenance = new Client({
      connectionString: maintenanceUrl.href,
      connectionTimeoutMillis: 5000,
      query_timeout: 15000,
    });
    const closeMaintenance = closeClientOnce(maintenance);
    try {
      log("正在连接维护库并检查其他活动连接……");
      await maintenance.connect();
      await maintenance.query("SET statement_timeout = '10s'");
      await maintenance.query("SET standard_conforming_strings = on");
      const sessions = await maintenance.query(
        "select 1 from pg_stat_activity where datname = $1 limit 1",
        [db.datname],
      );
      if (sessions.rowCount)
        throw new Error(
          "目标库仍有连接，请停止项目服务及其他连接后重试；未清库。",
        );
      let locale = `LC_COLLATE ${literal(db.datcollate)} LC_CTYPE ${literal(db.datctype)}`;
      if (db.provider === "i")
        locale += ` LOCALE_PROVIDER icu ICU_LOCALE ${literal(db.locale)}`;
      else if (db.provider === "b")
        locale = `LOCALE_PROVIDER builtin BUILTIN_LOCALE ${literal(db.locale)}`;
      else if (db.provider === "c") locale += " LOCALE_PROVIDER libc";
      phase = "正在删除目标数据库；如中断需检查数据库状态";
      await save();
      log("正在删除目标数据库（语句超时 10 秒）……");
      await maintenance.query(`DROP DATABASE ${identifier(db.datname)}`);
      phase = "数据库已删除，尚未重建；迁移文件尚未删除";
      await save();
      log("正在重建空数据库……");
      await maintenance.query(
        `CREATE DATABASE ${identifier(db.datname)} WITH TEMPLATE template0 OWNER ${identifier(db.owner)} ENCODING ${literal(db.encoding)} ${locale}`,
      );
      phase = "数据库已重建为空库，迁移文件尚未删除";
      await save();
      log("正在删除迁移文件……");
      await rm(migrations, { recursive: true, force: true });
      phase = "重置完成";
      await save();
      log(
        `重置完成，备份保留在：${backup}\n接下来依次执行 bun run db:generate、bun run db:migrate、bun run dev。`,
      );
    } finally {
      await closeMaintenance();
    }
  } catch (error) {
    // 数据库异常不输出原始 SQL/连接信息。
    const reason =
      error instanceof Error && !("severity" in error) && !("query" in error)
        ? error.message
        : "数据库操作失败，请检查连接、权限及其他活动连接。";
    throw new Error(
      `${reason}\n当前进度：${phase}${backup ? `\n备份目录：${backup}` : ""}`,
    );
  } finally {
    await closeTarget().catch(() => {});
  }
}
