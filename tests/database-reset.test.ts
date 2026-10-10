import { expect, test } from "bun:test";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import { postgresTool, resetDatabase } from "../scripts/database/reset";

test("database reset refuses non-interactive input before connecting", async () => {
  const child = Bun.spawn([process.execPath, "scripts/db-reset.ts"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  child.stdin.write("mas_backend\nRESET\n");
  child.stdin.end();
  expect(await child.exited).toBe(1);
  expect(await new Response(child.stderr).text()).toContain("需要交互终端");
});

const url = process.env.RESET_TEST_DATABASE_URL;
if (url && !new URL(url).pathname.endsWith("_test"))
  throw new Error(
    "Reset tests require an explicitly supplied disposable _test database",
  );
const integration = url ? test : test.skip;
integration(
  "reset preserves backups, respects both confirmations and active connections, and restores real data",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "mas-reset-"));
    const migrations = join(root, "database/migrations");
    const databaseName = decodeURIComponent(new URL(url!).pathname.slice(1));
    const connect = async () => {
      const client = new Client({ connectionString: url });
      await client.connect();
      return client;
    };
    let client = await connect();
    const options = { root, connectionString: url!, log: () => {} };
    const source = "CREATE TABLE fixture(id integer primary key, note text);";
    try {
      await client.query(source);
      await client.query("insert into fixture values (1, $1)", ["保留的数据"]);
      await mkdir(migrations, { recursive: true });
      await writeFile(join(migrations, "0000.sql"), source);
      await client.end();
      await resetDatabase({ ...options, confirm: async () => "wrong-name" });
      expect(await Bun.file(join(migrations, "0000.sql")).text()).toBe(source);
      await expect(readdir(join(root, "backups"))).rejects.toThrow();

      const previous = process.env.PG_BIN;
      process.env.PG_BIN = "/missing-postgresql-tools";
      try {
        await expect(
          resetDatabase({ ...options, confirm: async () => databaseName }),
        ).rejects.toThrow("找不到 pg_dump");
      } finally {
        if (previous === undefined) delete process.env.PG_BIN;
        else process.env.PG_BIN = previous;
      }

      let confirmations = [databaseName, "cancel"];
      await resetDatabase({
        ...options,
        confirm: async () => confirmations.shift()!,
      });
      expect(await readdir(join(root, "backups"))).toHaveLength(1);
      expect(await Bun.file(join(migrations, "0000.sql")).text()).toBe(source);

      client = await connect();
      confirmations = [databaseName, "RESET"];
      await expect(
        resetDatabase({
          ...options,
          confirm: async () => confirmations.shift()!,
        }),
      ).rejects.toThrow("仍有连接");
      expect(
        (await client.query("select note from fixture")).rows[0].note,
      ).toBe("保留的数据");
      await client.end();

      confirmations = [databaseName, "RESET"];
      await resetDatabase({
        ...options,
        confirm: async () => confirmations.shift()!,
      });
      expect(confirmations).toEqual([]);
      await expect(stat(migrations)).rejects.toThrow();
      const backups = await readdir(join(root, "backups"));
      const backup = join(root, "backups", backups.sort().at(-1)!);
      expect(await readFile(join(backup, "migrations/0000.sql"), "utf8")).toBe(
        source,
      );
      expect((await stat(join(backup, "database.dump"))).mode & 0o777).toBe(
        0o600,
      );
      expect((await stat(backup)).mode & 0o777).toBe(0o700);
      const manifest = JSON.parse(
        await readFile(join(backup, "manifest.json"), "utf8"),
      );
      expect(manifest.phase).toBe("重置完成");
      expect(manifest.sha256).toHaveLength(64);
      client = await connect();
      expect(
        (
          await client.query(
            "select to_regclass('public.fixture') as table_name",
          )
        ).rows[0].table_name,
      ).toBeNull();
      await client.end();
      const restoreUrl = new URL(url!);
      const restorePassword = decodeURIComponent(restoreUrl.password);
      restoreUrl.password = "";
      const restore = Bun.spawn(
        [
          await postgresTool("pg_restore"),
          "--no-password",
          "--dbname",
          restoreUrl.href,
          join(backup, "database.dump"),
        ],
        {
          env: { ...process.env, PGPASSWORD: restorePassword },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      expect(await restore.exited).toBe(0);
      client = await connect();
      expect(
        (await client.query("select note from fixture")).rows[0].note,
      ).toBe("保留的数据");
    } finally {
      await client.end().catch(() => {});
      await rm(root, { recursive: true, force: true });
    }
  },
  60000,
);
