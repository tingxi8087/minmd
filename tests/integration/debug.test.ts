import { beforeAll, afterAll, describe, test, expect } from "bun:test";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { buildApp } from "../../apps/app_server/src/app";
import { loadConfig } from "../../system/server/src/config/env";
import { createDatabase } from "../../system/server/src/database/client";
import { hashPassword } from "../../system/server/src/modules/auth/password";

const url = process.env.DEBUG_TEST_DATABASE_URL;
if (url && !new URL(url).pathname.endsWith("_test"))
  throw Error("Dedicated _test database required");
const suite = url ? describe : describe.skip;
suite("API debugger authentication and production controls", () => {
  const db = createDatabase(url ?? "postgresql://localhost/unused_test");
  const prefix = `debug_${Date.now()}`;
  const password = "Debug-test-password-123";
  const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
  const ids: string[] = [];
  let roleId: string;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let root: string;
  let reader: string;
  let operator: string;
  const config = (extra = {}) =>
    loadConfig({
      WEB_CMS_DIST: "tests/fixtures/web-cms",
      DATABASE_URL: url,
      LOG_LEVEL: "silent",
      ...extra,
    });
  const login = async (name: string) => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { account: `${prefix}_${name}`, password },
    });
    expect(res.statusCode).toBe(200);
    return res.json().token as string;
  };
  const execute = (
    token: string,
    payload: Record<string, unknown>,
    target = app,
  ) =>
    target.inject({
      method: "POST",
      url: "/api/debug/execute",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        method: "GET",
        url: "/api/health",
        headers: {},
        auth: "current",
        ...payload,
      },
    });
  beforeAll(async () => {
    await migrate(db.db, { migrationsFolder: "database/migrations" });
    const hash = await hashPassword(password);
    for (const name of ["root", "reader", "operator"]) {
      const res = await db.pool.query(
        "insert into sys_admins(account,display_name,password_hash,is_super_admin) values($1,$2,$3,$4) returning id",
        [`${prefix}_${name}`, name, hash, name === "root"],
      );
      ids.push(res.rows[0].id);
    }
    const role = await db.pool.query(
      "insert into sys_roles(code,name) values($1,$1) returning id",
      [prefix],
    );
    roleId = role.rows[0].id;
    await db.pool.query(
      "insert into sys_role_permissions(role_id,permission_code) values($1,'api:read')",
      [roleId],
    );
    await db.pool.query(
      "insert into sys_admin_roles(admin_id,role_id) values($1,$2),($3,$2)",
      [ids[1], roleId, ids[2]],
    );
    app = await buildApp(config(), { logger: false });
    apps.push(app);
    // Static web-cms routes may not declare a schema. They must not break discovery.
    app.get("/static-without-schema", async () => "web-cms");
    root = await login("root");
    reader = await login("reader");
    operator = await login("operator");
  }, 30000);
  afterAll(async () => {
    for (const instance of apps) await instance.close();
    await db.pool.query("delete from sys_admins where id = any($1::uuid[])", [
      ids,
    ]);
    if (roleId)
      await db.pool.query("delete from sys_roles where id=$1", [roleId]);
    await db.pool.query(
      "delete from sys_audit_logs where actor_id = any($1::uuid[])",
      [ids],
    );
    await db.close();
  }, 30000);
  test("docs require permission, expose contracts and route access", async () => {
    expect((await app.inject("/api/openapi.json")).statusCode).toBe(401);
    const res = await app.inject({
      url: "/api/openapi.json",
      headers: { authorization: `Bearer ${reader}` },
    });
    expect(res.statusCode).toBe(200);
    const paths = res.json().paths;
    expect(paths["/api/auth/me"].get["x-access"].auth).toBe(true);
    expect(paths["/api/admin/app-users/{id}"].get.parameters[0].in).toBe(
      "path",
    );
    expect(paths["/api/debug/execute"]).toBeUndefined();
    expect(paths["/static-without-schema"]).toBeUndefined();
    expect((await execute(reader, {})).statusCode).toBe(403);
  });
  test("all published API contracts include Chinese documentation and valid field examples", async () => {
    const response = await app.inject({
      url: "/api/openapi.json",
      headers: { authorization: `Bearer ${root}` },
    });
    const doc = response.json();
    const issues: string[] = [];
    const walk = (schema: any, path: string) => {
      if (!schema || typeof schema !== "object") return;
      for (const [key, value] of Object.entries(schema.properties ?? {})) {
        if (!(value as any).description)
          issues.push(`${path}.${key}: missing description`);
      }
      if (schema.example !== undefined) {
        try {
          const validate = app.validatorCompiler!({
            schema: { type: "object", properties: { value: schema } },
            method: "POST",
            url: "/contract-check",
            httpPart: "body",
          });
          if (!validate({ value: structuredClone(schema.example) }))
            issues.push(
              `${path}: invalid example ${JSON.stringify(validate.errors)}`,
            );
        } catch (e) {
          issues.push(`${path}: ${(e as Error).message}`);
        }
      }
      for (const [key, value] of Object.entries(schema.properties ?? {}))
        walk(value, `${path}.${key}`);
      if (schema.items) walk(schema.items, `${path}[]`);
      for (const kind of ["allOf", "anyOf", "oneOf"])
        for (const value of schema[kind] ?? []) walk(value, path);
    };
    for (const [path, methods] of Object.entries(doc.paths))
      for (const [method, value] of Object.entries(methods as object)) {
        if (!["get", "post", "put", "delete", "patch"].includes(method))
          continue;
        const op = value as any;
        for (const key of ["summary", "description"])
          if (!op[key] || !/[\u4e00-\u9fff]/.test(op[key]))
            issues.push(`${method} ${path}: missing ${key}`);
        if (!/[\u4e00-\u9fff]/.test(op.tags?.[0] ?? ""))
          issues.push(`${path}: missing Chinese group`);
        for (const p of op.parameters ?? []) {
          if (!p.description && !p.schema?.description)
            issues.push(`${path}: parameter ${p.name} missing description`);
          walk(p.schema, `${path}.${p.name}`);
        }
        walk(
          op.requestBody?.content?.["application/json"]?.schema,
          `${path}.body`,
        );
        for (const [status, r] of Object.entries(op.responses)) {
          if (!/[\u4e00-\u9fff]/.test((r as any).description ?? ""))
            issues.push(`${path}.${status}: missing response description`);
          const schema = (r as any).content?.["application/json"]?.schema;
          if (
            status.startsWith("2") &&
            status !== "204" &&
            (!schema || Object.keys(schema).length === 0)
          )
            issues.push(`${path}: missing success structure`);
          walk(schema, `${path}.${status}`);
        }
      }
    expect(issues).toEqual([]);
  });
  test("anonymous and custom credentials preserve target checks without replacing session", async () => {
    const anonymous = await execute(root, {
      url: "/api/auth/me",
      auth: "none",
    });
    expect(anonymous.statusCode).toBe(200);
    expect(anonymous.json().status).toBe(401);
    const custom = await execute(root, {
      url: "/api/auth/me",
      auth: "custom",
      token: reader,
    });
    expect(JSON.parse(custom.json().body).admin.account).toBe(
      `${prefix}_reader`,
    );
    const current = await execute(root, { url: "/api/auth/me" });
    expect(JSON.parse(current.json().body).admin.isSuperAdmin).toBe(true);
    expect(current.json().headers["x-request-id"]).toBeTruthy();
    expect(current.json().headers["set-cookie"]).toBeUndefined();
  });
  test("debug execution does not grant business permissions; unauthorized headers cannot override identity", async () => {
    await db.pool.query(
      "insert into sys_role_permissions(role_id,permission_code) values($1,'api:debug')",
      [roleId],
    );
    const doc = await app.inject({
      url: "/api/openapi.json",
      headers: { authorization: `Bearer ${root}` },
    });
    const protectedPath = Object.entries(doc.json().paths).find(([, v]) =>
      (v as any).get?.["x-access"]?.permissions?.includes("user:read"),
    )?.[0];
    expect(protectedPath).toBeTruthy();
    const response = await execute(operator, {
      url: protectedPath,
      headers: { Authorization: `Bearer ${root}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe(403);
  });
  test("rejects external, recursive and unknown targets", async () => {
    for (const path of [
      "http://example.com/api/health",
      "/api/debug/execute",
      "/api/openapi.json",
      "/api/unknown",
      "/api/../api/debug/config",
    ])
      expect((await execute(root, { url: path })).statusCode).toBe(400);
  });
  test("production off by default; enabled writes require confirmation", async () => {
    const off = await buildApp(config({ APP_ENV: "production" }), {
      logger: false,
    });
    apps.push(off);
    expect((await execute(root, {}, off)).statusCode).toBe(403);
    const on = await buildApp(
      config({ APP_ENV: "production", API_DEBUG_ENABLED: "true" }),
      { logger: false },
    );
    apps.push(on);
    const payload = {
      method: "POST",
      url: "/api/auth/login",
      body: JSON.stringify({ account: `${prefix}_root`, password }),
      auth: "none",
    };
    expect((await execute(root, payload, on)).statusCode).toBe(400);
    const response = await execute(
      root,
      { ...payload, confirmWrite: true },
      on,
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe(200);
  });
  test("Cookie debugging retains CSRF protection and isolates anonymous target requests", async () => {
    const instance = await buildApp(
      config({
        AUTH_TRANSPORT: "cookie",
        PUBLIC_ORIGIN: "http://127.0.0.1:5173",
      }),
      { logger: false },
    );
    apps.push(instance);
    const login = await instance.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "http://127.0.0.1:5173" },
      payload: { account: `${prefix}_root`, password },
    });
    expect(login.statusCode).toBe(200);
    const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    const headers = {
      cookie,
      origin: "http://127.0.0.1:5173",
      "x-csrf-token": login.json().csrfToken,
    };
    const payload = {
      method: "GET",
      url: "/api/auth/me",
      headers: {},
      auth: "current",
    };
    const denied = await instance.inject({
      method: "POST",
      url: "/api/debug/execute",
      headers: { cookie },
      payload,
    });
    expect(denied.statusCode).toBe(403);
    const current = await instance.inject({
      method: "POST",
      url: "/api/debug/execute",
      headers,
      payload,
    });
    expect(current.statusCode).toBe(200);
    expect(JSON.parse(current.json().body).admin.isSuperAdmin).toBe(true);
    const anonymous = await instance.inject({
      method: "POST",
      url: "/api/debug/execute",
      headers,
      payload: { ...payload, auth: "none" },
    });
    expect(anonymous.json().status).toBe(401);
  });
  test("database workbench is exclusively superadmin even with debug permissions", async () => {
    app = await buildApp(config(), { logger: false });
    apps.push(app);
    root = await login("root");
    operator = await login("operator");
    for (const path of [
      "/api/database/config",
      "/api/database/tables",
      "/api/database/table?schema=public&table=sys_admins",
    ]) {
      expect((await app.inject(path)).statusCode).toBe(401);
      expect(
        (
          await app.inject({
            url: path,
            headers: { authorization: `Bearer ${operator}` },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            url: path,
            headers: { authorization: `Bearer ${root}` },
          })
        ).statusCode,
      ).toBe(200);
    }
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/database/execute",
          headers: { authorization: `Bearer ${operator}` },
          payload: { sql: "select 1" },
        })
      ).statusCode,
    ).toBe(403);
  });
  test("database SQL read/write, metadata, audit, bounds and single-statement enforcement", async () => {
    const sql = (sql: string, target = app, extra = {}) =>
      target.inject({
        method: "POST",
        url: "/api/database/execute",
        headers: { authorization: `Bearer ${root}` },
        payload: { sql, ...extra },
      });
    const name = `${prefix}_sql`;
    expect(
      (await sql(`CREATE TABLE "${name}" (id integer primary key, note text)`))
        .statusCode,
    ).toBe(200);
    try {
      expect(
        (await sql(`COMMENT ON COLUMN "${name}".note IS '备注'`)).statusCode,
      ).toBe(200);
      expect(
        (
          await sql(
            `INSERT INTO "${name}" VALUES (1,'private-literal-93847'),(2,'two')`,
          )
        ).json().affectedRows,
      ).toBe(2);
      const read = await app.inject({
        url: `/api/database/table?schema=public&table=${name}&pageSize=1&page=2`,
        headers: { authorization: `Bearer ${root}` },
      });
      expect(read.statusCode).toBe(200);
      expect(read.json().total).toBe(2);
      expect(read.json().rows[0][0]).toBe(2);
      expect(read.json().columns[1].comment).toBe("备注");
      expect(read.json().columns[0].primary).toBe(true);
      expect(
        (
          await sql(
            `UPDATE "${name}" SET note='changed' WHERE id=2 RETURNING id,note`,
          )
        ).json().rows,
      ).toEqual([[2, "changed"]]);
      expect(
        (await sql(`DELETE FROM "${name}" WHERE id=2`)).json().affectedRows,
      ).toBe(1);
      expect(
        (await sql(`INSERT INTO "${name}" VALUES(3,'bad'); SELECT 1`))
          .statusCode,
      ).toBe(400);
      expect((await sql("BEGIN")).statusCode).toBe(400);
      expect(
        (await sql(`SELECT count(*) FROM "${name}"`)).json().rows[0][0],
      ).toBe("1");
      expect(
        (await sql("SELECT * FROM generate_series(1,501)")).json().code,
      ).toBe("SQL_RESULT_LIMIT");
      expect((await sql(`SELECT repeat('x',1100000)`)).json().code).toBe(
        "SQL_RESULT_LIMIT",
      );
      expect(
        (
          await sql(
            `INSERT INTO "${name}" SELECT g,'oversize' FROM generate_series(10,510) g RETURNING *`,
          )
        ).json().code,
      ).toBe("SQL_RESULT_LIMIT");
      expect(
        (await sql(`SELECT count(*) FROM "${name}"`)).json().rows[0][0],
      ).toBe("1");
      const failed = await sql("select nonexistent_column");
      expect(failed.statusCode).toBe(400);
      const audit = await db.pool.query(
        "select action, after from sys_audit_logs where actor_id=$1 and action like 'database.sql.%'",
        [ids[0]],
      );
      expect(
        audit.rows.some((r) => r.action === "database.sql.completed"),
      ).toBe(true);
      expect(audit.rows.some((r) => r.action === "database.sql.failed")).toBe(
        true,
      );
      expect(JSON.stringify(audit.rows)).not.toContain("private-literal-93847");
      const prod = await buildApp(config({ APP_ENV: "production" }), {
        logger: false,
      });
      apps.push(prod);
      expect((await sql("select 1", prod)).json().code).toBe(
        "ENVIRONMENT_CONFIRMATION",
      );
      expect(
        (await sql("select 1", prod, { confirmEnvironment: "production" }))
          .statusCode,
      ).toBe(200);
    } finally {
      await db.pool.query(`DROP TABLE IF EXISTS "${name}"`);
    }
  }, 30000);
  test("SQL timeout actually stops server execution and leaves pool usable", async () => {
    const started = Date.now();
    const response = await app.inject({
      method: "POST",
      url: "/api/database/execute",
      headers: { authorization: `Bearer ${root}` },
      payload: { sql: "SELECT pg_sleep(15)" },
    });
    expect(response.statusCode).toBe(400);
    expect(Date.now() - started).toBeLessThan(10000);
    const active = await db.pool.query(
      "select count(*) from pg_stat_activity where application_name='mas-database-workbench' and state='active'",
    );
    expect(active.rows[0].count).toBe("0");
    expect(
      (
        await app.inject({
          url: "/api/database/tables",
          headers: { authorization: `Bearer ${root}` },
        })
      ).statusCode,
    ).toBe(200);
  }, 15000);
});
