import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { and, eq, inArray } from "drizzle-orm";
import { mkdtemp, rm, readdir, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { request as httpRequest, type ClientRequest } from "node:http";
import JSZip from "jszip";
import { createDatabase } from "../../system/server/src/database/client";
import { loadConfig } from "../../system/server/src/config/env";
import { hashPassword } from "../../system/server/src/modules/auth/password";
import { buildApp } from "../../apps/app_server/src/app";
import { appUsers } from "../../apps/app_server/src/database/schema/users";
import {
  spaces,
  spaceMembers,
} from "../../apps/app_server/src/database/schema/spaces";
import { files } from "../../apps/app_server/src/database/schema/files";
import {
  assets,
  fileAssets,
  versionAssets,
} from "../../apps/app_server/src/database/schema/assets";
import {
  fileContents,
  fileVersions,
} from "../../apps/app_server/src/database/schema/contents";
import { fileTransferImports } from "../../apps/app_server/src/database/schema/file-transfers";
import { storeAsset } from "../../apps/app_server/src/modules/assets/service";
import { jobResponse } from "../../apps/app_server/src/modules/file-transfer/jobs";

type Job = ReturnType<typeof jobResponse>;
const url = process.env.TEST_DATABASE_URL;
if (url && !new URL(url).pathname.endsWith("_test"))
  throw Error("文件导入导出测试只允许独立 _test 库");
(url ? describe : describe.skip)("前台文件包真实数据库往返与授权", () => {
  const database = createDatabase(url ?? "postgresql://localhost/unused_test");
  const prefix = `transfer_${Date.now()}`;
  const password = "transfer-test-123";
  let app: Awaited<ReturnType<typeof buildApp>>, directory: string;
  let owner: string, other: string, token: string, otherToken: string;
  let source: string,
    destination: string,
    folder: string,
    doc: string,
    sheet: string,
    image: string,
    assetId: string;
  let fullBytes: Buffer, portableBytes: Buffer;
  let recipientSpace = "";
  const oldDirectory = process.env.ASSET_STORAGE_DIR;
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
    "base64",
  );
  const headers = (credential = token) => ({
    authorization: `Bearer ${credential}`,
  });
  const request = (
    method: "POST" | "GET" | "PUT" | "DELETE",
    path: string,
    payload?: object | Buffer,
    credential = token,
    zip = false,
  ) =>
    app.inject({
      method,
      url: `/api/app/${path}`,
      headers: {
        ...headers(credential),
        ...(zip ? { "content-type": "application/zip" } : {}),
      },
      payload,
    });
  const createFile = async (
    name: string,
    kind = "doc",
    parentId: string | null = null,
  ) => {
    const result = await request("POST", `spaces/${source}/files`, {
      name,
      kind,
      parentId,
    });
    expect(result.statusCode).toBe(200);
    return result.json().id as string;
  };
  const wait = async (id: string, credential = token): Promise<Job> => {
    for (let count = 0; count < 300; count++) {
      const result = await request(
        "GET",
        `file-transfers/${id}`,
        undefined,
        credential,
      );
      expect(result.statusCode).toBe(200);
      const job = result.json<Job>();
      if (!["processing", "waiting-upload"].includes(job.status)) return job;
      await Bun.sleep(10);
    }
    throw Error("任务处理超时");
  };
  const exportFiles = async (
    mode: "complete" | "markdown",
    ids = [folder],
    single = false,
  ) => {
    const started = await request("POST", `spaces/${source}/file-exports`, {
      ids,
      mode,
      single,
    });
    expect(started.statusCode).toBe(200);
    const id = started.json<Job>().id;
    const job = await wait(id);
    expect(job.error).toBeNull();
    expect(job.status).toBe("ready");
    const download = await request("GET", `file-transfers/${id}/download`);
    expect(download.statusCode).toBe(200);
    return { id, bytes: download.rawPayload, job };
  };
  const upload = async (bytes: Buffer, extra: Record<string, unknown> = {}) => {
    const batchId = crypto.randomUUID();
    const started = await request(
      "POST",
      `spaces/${destination}/file-imports`,
      { batchId, parentId: null, replaceFileId: null, ...extra },
    );
    expect(started.statusCode).toBe(200);
    const result = await request(
      "PUT",
      `file-transfers/${batchId}/package`,
      bytes,
      token,
      true,
    );
    expect(result.statusCode).toBe(200);
    return { id: batchId, job: result.json<Job>() };
  };
  const commit = async (id: string) => {
    const result = await request("POST", `file-transfers/${id}/commit`, {});
    expect(result.statusCode).toBe(200);
    return wait(id);
  };
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "minmd-transfers-integration-"));
    process.env.ASSET_STORAGE_DIR = directory;
    const passwordHash = await hashPassword(password);
    const users = await database.db
      .insert(appUsers)
      .values(
        ["owner", "other"].map((account) => ({
          account: `${prefix}_${account}`,
          passwordHash,
        })),
      )
      .returning();
    owner = users[0]!.id;
    other = users[1]!.id;
    app = await buildApp(
      loadConfig({
        DATABASE_URL: url!,
        APP_ENV: "staging",
        AUTH_TRANSPORT: "bearer",
        WEB_CMS_DIST: "tests/fixtures/web-cms",
        WEB_DIST: "tests/fixtures/web",
        LOG_LEVEL: "silent",
      }),
      { logger: false },
    );
    await app.ready();
    const login = async (account: string) =>
      (
        await app.inject({
          method: "POST",
          url: "/api/app/auth/login",
          payload: { account: `${prefix}_${account}`, password },
        })
      ).json().token as string;
    token = await login("owner");
    otherToken = await login("other");
    source = (
      await request("POST", "spaces", { name: `${prefix}-源空间` })
    ).json().id;
    destination = (
      await request("POST", "spaces", { name: `${prefix}-目标空间` })
    ).json().id;
    folder = await createFile("资料", "folder");
    doc = await createFile("带样式的文档", "doc", folder);
    sheet = await createFile("预算", "sheet", folder);
    const asset = await storeAsset(
      database,
      directory,
      owner,
      source,
      "图片.png",
      "image/png",
      png,
    );
    assetId = asset.id;
    const projection = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "彩色文字",
              marks: [
                {
                  type: "textStyle",
                  attrs: {
                    color: "#ff0000",
                    backgroundColor: "#ffee00",
                    fontSize: "24px",
                  },
                },
              ],
            },
            { type: "documentReference", attrs: { id: sheet, name: "预算" } },
          ],
        },
        {
          type: "image",
          attrs: {
            src: asset.url,
            assetId: asset.id,
            width: 320,
            height: 200,
            align: "right",
          },
        },
        {
          type: "codeBlock",
          attrs: { language: "mermaid" },
          content: [{ type: "text", text: "graph TD; A-->B" }],
        },
      ],
    };
    expect(
      (
        await request("POST", `files/${doc}/content-import`, {
          expectedRevision: 1,
          expectedEpoch: 1,
          projection,
        })
      ).statusCode,
    ).toBe(200);
    const workbook = {
      sheets: [
        {
          id: "sheet1",
          name: "预算",
          order: 0,
          status: 1,
          row: 100,
          column: 26,
          celldata: [
            {
              r: 0,
              c: 0,
              v: { v: 12, ct: { fa: "0.00", t: "n" }, bg: "#ffff00" },
            },
            { r: 0, c: 1, v: { f: "=A1*2", v: 24 } },
          ],
        },
        {
          id: "sheet2",
          name: "清单",
          order: 1,
          status: 0,
          row: 50,
          column: 26,
          celldata: [],
        },
      ],
    };
    expect(
      (
        await request("POST", `files/${sheet}/content-import`, {
          expectedRevision: 1,
          expectedEpoch: 1,
          projection: workbook,
        })
      ).statusCode,
    ).toBe(200);
    const boundary = "transfer-media";
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="photo.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      png,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const media = await app.inject({
      method: "POST",
      url: `/api/app/spaces/${source}/media?parentId=${folder}`,
      headers: {
        ...headers(),
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });
    expect(media.statusCode).toBe(200);
    image = media.json().id;
  });
  afterAll(async () => {
    await app?.close();
    const spaceIds = [source, destination, recipientSpace].filter(Boolean);
    if (spaceIds.length) {
      await database.db
        .update(files)
        .set({ parentId: null })
        .where(inArray(files.spaceId, spaceIds));
      await database.db
        .delete(fileTransferImports)
        .where(inArray(fileTransferImports.spaceId, spaceIds));
      await database.db.delete(files).where(inArray(files.spaceId, spaceIds));
      await database.db.delete(assets).where(inArray(assets.spaceId, spaceIds));
      await database.db.delete(spaces).where(inArray(spaces.id, spaceIds));
    }
    if (owner && other)
      await database.db
        .delete(appUsers)
        .where(inArray(appUsers.id, [owner, other]));
    await database.close();
    if (oldDirectory === undefined) delete process.env.ASSET_STORAGE_DIR;
    else process.env.ASSET_STORAGE_DIR = oldDirectory;
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  test("完整包递归去重、身份隔离、样式与附件及表格完整往返，重试不重复创建", async () => {
    const result = await exportFiles("complete", [folder, doc]);
    fullBytes = result.bytes;
    expect(result.job.fileCount).toBe(4);
    expect(
      (
        await request(
          "GET",
          `file-transfers/${result.id}`,
          undefined,
          otherToken,
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await request(
          "GET",
          `file-transfers/${result.id}/download`,
          undefined,
          otherToken,
        )
      ).statusCode,
    ).toBe(404);
    const imported = await upload(fullBytes);
    expect(imported.job.status).toBe("ready");
    const completed = await commit(imported.id);
    expect(completed.error).toBeNull();
    expect(completed.status).toBe("completed");
    expect(completed.fileIds).toHaveLength(4);
    const created = await database.db
      .select()
      .from(files)
      .where(inArray(files.id, completed.fileIds));
    expect(
      created.every(
        (file) => file.createdBy === owner && file.visibility === "private",
      ),
    ).toBe(true);
    const importedDoc = created.find((file) => file.kind === "doc")!;
    const importedSheet = created.find((file) => file.kind === "sheet")!;
    const body = (
      await request("GET", `files/${importedDoc.id}/content`)
    ).json().projection;
    expect(body.content[0].content[0].marks[0].attrs).toMatchObject({
      color: "#ff0000",
      backgroundColor: "#ffee00",
      fontSize: "24px",
    });
    expect(body.content[0].content[1].attrs.id).toBe(importedSheet.id);
    expect(body.content[1].attrs).toMatchObject({
      width: 320,
      height: 200,
      align: "right",
    });
    expect(body.content[1].attrs.assetId).not.toBe(assetId);
    const imageReply = await request(
      "GET",
      `assets/${body.content[1].attrs.assetId}`,
    );
    expect(imageReply.statusCode).toBe(200);
    expect(imageReply.rawPayload).toEqual(png);
    const book = (
      await request("GET", `files/${importedSheet.id}/content`)
    ).json().projection;
    expect(book.sheets).toHaveLength(2);
    expect(book.sheets[0].data[0][1].f).toBe("=A1*2");
    const again = await commit(imported.id);
    expect(again.fileIds).toEqual(completed.fileIds);
    const rows = await database.db
      .select()
      .from(fileTransferImports)
      .where(eq(fileTransferImports.id, imported.id));
    expect(rows).toHaveLength(1);
  }, 20000);
  test("离线包可跨账号导入，创建与上传归当前账号，不转移源空间成员资格", async () => {
    const space = await request(
      "POST",
      "spaces",
      { name: `${prefix}-接收账号` },
      otherToken,
    );
    expect(space.statusCode).toBe(200);
    recipientSpace = space.json().id;
    const id = crypto.randomUUID();
    expect(
      (
        await request(
          "POST",
          `spaces/${recipientSpace}/file-imports`,
          { batchId: id, parentId: null, replaceFileId: null },
          otherToken,
        )
      ).statusCode,
    ).toBe(200);
    const uploaded = await request(
      "PUT",
      `file-transfers/${id}/package`,
      fullBytes,
      otherToken,
      true,
    );
    expect(uploaded.json().status).toBe("ready");
    expect(
      (await request("POST", `file-transfers/${id}/commit`, {}, otherToken))
        .statusCode,
    ).toBe(200);
    const done = await wait(id, otherToken);
    expect(done.status).toBe("completed");
    const created = await database.db
      .select()
      .from(files)
      .where(inArray(files.id, done.fileIds));
    expect(
      created.every(
        (file) => file.createdBy === other && file.visibility === "private",
      ),
    ).toBe(true);
    const uploadedAssets = await database.db
      .select()
      .from(assets)
      .where(eq(assets.spaceId, recipientSpace));
    expect(uploadedAssets.length).toBeGreaterThan(0);
    expect(uploadedAssets.every((asset) => asset.uploadedBy === other)).toBe(
      true,
    );
    expect(
      (
        await database.db
          .select()
          .from(spaceMembers)
          .where(eq(spaceMembers.spaceId, recipientSpace))
      ).map((member) => member.userId),
    ).toEqual([other]);
    const importedDoc = created.find((file) => file.kind === "doc")!;
    expect(
      (await request("GET", `files/${importedDoc.id}/content`)).statusCode,
    ).toBe(403);
    const content = (
      await request(
        "GET",
        `files/${importedDoc.id}/content`,
        undefined,
        otherToken,
      )
    ).json().projection;
    expect(
      (
        await request(
          "GET",
          `assets/${content.content[1].attrs.assetId}`,
          undefined,
          otherToken,
        )
      ).rawPayload,
    ).toEqual(png);
  }, 20000);
  test("Markdown/XLSX 包可独立读取并重建图片、目录和工作表，同名不会覆盖", async () => {
    const exported = await exportFiles("markdown");
    portableBytes = exported.bytes;
    const zip = await JSZip.loadAsync(portableBytes);
    const text = await zip.file("files/资料/带样式的文档.md")!.async("string");
    expect(text).toContain("彩色文字");
    expect(text).not.toContain("#ff0000");
    expect(text).toContain("../../assets/");
    expect(zip.file("files/资料/预算.xlsx")).not.toBeNull();
    const batch = await upload(portableBytes);
    expect(batch.job.error).toBeNull();
    const result = await commit(batch.id);
    expect(result.error).toBeNull();
    expect(result.status).toBe("completed");
    const created = await database.db
      .select()
      .from(files)
      .where(inArray(files.id, result.fileIds));
    expect(created.find((file) => file.kind === "folder")!.name).toBe(
      "资料 (1)",
    );
    const importedSheet = created.find((file) => file.kind === "sheet")!;
    const workbook = (
      await request("GET", `files/${importedSheet.id}/content`)
    ).json().projection;
    expect(workbook.sheets).toHaveLength(2);
    expect(workbook.sheets[0].data[0][1].f).toBe("=A1*2");
    expect(workbook.sheets[0].data[0][0].ct.fa).toBe("0.00");
    expect(workbook.sheets[0].data[0][0].bg.toLowerCase()).toBe("#ffff00");
    const body = (
      await request(
        "GET",
        `files/${created.find((file) => file.kind === "doc")!.id}/content`,
      )
    ).json().projection;
    const imageNode =
      body.content.find((node: { type: string }) => node.type === "image") ??
      body.content
        .flatMap((node: { content?: unknown[] }) => node.content ?? [])
        .find((node: { type: string }) => node.type === "image");
    expect(imageNode.attrs.assetId).toBeString();
    expect(
      (await request("GET", `assets/${imageNode.attrs.assetId}`)).rawPayload,
    ).toEqual(png);
  }, 20000);
  test("损坏或未知字段的包不创建文件；取消暂存和未授权目标不能写入", async () => {
    const before = await database.db
      .select()
      .from(files)
      .where(eq(files.spaceId, destination));
    const zip = await JSZip.loadAsync(fullBytes);
    const contentPath = Object.keys(zip.files).find(
      (path) =>
        path.startsWith("contents/") &&
        path.endsWith(".json") &&
        zip.file(path),
    )!;
    const data = JSON.parse(await zip.file(contentPath)!.async("string"));
    if (data.type === "doc")
      data.content[0].attrs = { ...data.content[0].attrs, futureStyle: true };
    else data.invalid = true;
    zip.file(contentPath, JSON.stringify(data));
    // 版本不匹配必须在正式数据写入前失败。
    const manifest = JSON.parse(
      await zip.file("manifest.json")!.async("string"),
    );
    manifest.appVersion = "unsupported";
    zip.file("manifest.json", JSON.stringify(manifest));
    const batch = await upload(await zip.generateAsync({ type: "nodebuffer" }));
    expect(batch.job.status).toBe("failed");
    expect(
      (
        await database.db
          .select()
          .from(files)
          .where(eq(files.spaceId, destination))
      ).length,
    ).toBe(before.length);
    const denied = await request(
      "POST",
      `spaces/${destination}/file-imports`,
      { batchId: crypto.randomUUID(), parentId: null, replaceFileId: null },
      otherToken,
    );
    expect(denied.statusCode).toBe(403);
    const waiting = await upload(fullBytes);
    expect(waiting.job.status).toBe("ready");
    expect(
      (await request("DELETE", `file-transfers/${waiting.id}`)).statusCode,
    ).toBe(200);
    expect(
      (await request("GET", `file-transfers/${waiting.id}`)).statusCode,
    ).toBe(404);
    expect(
      (
        await database.db
          .select()
          .from(files)
          .where(eq(files.spaceId, destination))
      ).length,
    ).toBe(before.length);
  }, 20000);
  test("单文档替换保留标题目录及创建人，推进 epoch、创建恢复版本且保留旧图片", async () => {
    const exported = await exportFiles("complete", [doc], true);
    const targets = await database.db
      .select()
      .from(files)
      .where(and(eq(files.spaceId, destination), eq(files.kind, "doc")));
    const target = targets[0]!;
    const old = (await request("GET", `files/${target.id}/content`)).json();
    const previousImage = old.projection.content[1].attrs.assetId;
    const batch = await upload(exported.bytes, {
      replaceFileId: target.id,
      expectedRevision: old.revision,
      expectedEpoch: old.epoch,
    });
    expect(batch.job.status).toBe("ready");
    const done = await commit(batch.id);
    expect(done.error).toBeNull();
    const current = (await request("GET", `files/${target.id}/content`)).json();
    expect(current.epoch).toBe(old.epoch + 1);
    expect(current.revision).toBe(old.revision + 1);
    const [metadata] = await database.db
      .select()
      .from(files)
      .where(eq(files.id, target.id));
    expect(metadata!.name).toBe(target.name);
    expect(metadata!.parentId).toBe(target.parentId);
    expect(metadata!.createdBy).toBe(target.createdBy);
    expect((await request("GET", `assets/${previousImage}`)).statusCode).toBe(
      200,
    );
    const history = await database.db
      .select()
      .from(fileVersions)
      .where(eq(fileVersions.fileId, target.id));
    expect(history.length).toBeGreaterThan(1);
    const stale = await request("POST", `files/${target.id}/content-import`, {
      expectedRevision: old.revision,
      expectedEpoch: old.epoch,
      projection: old.projection,
    });
    expect(stale.statusCode).toBe(409);
    const rejection = await upload(fullBytes, {
      replaceFileId: target.id,
      expectedRevision: current.revision,
      expectedEpoch: current.epoch,
    });
    expect(rejection.job.status).toBe("failed");
  }, 20000);
  test("替换冲突和事务中数据库失败不留附件或半个目录", async () => {
    const [target] = await database.db
      .select()
      .from(files)
      .where(and(eq(files.spaceId, destination), eq(files.kind, "doc")));
    const beforeContent = (
      await request("GET", `files/${target!.id}/content`)
    ).json();
    const [assetBefore, treeBefore, diskBefore] = await Promise.all([
      database.db.select().from(assets).where(eq(assets.spaceId, destination)),
      database.db.select().from(files).where(eq(files.spaceId, destination)),
      readdir(directory, { withFileTypes: true }).then((rows) =>
        rows
          .filter((row) => row.isFile())
          .map((row) => row.name)
          .sort(),
      ),
    ]);
    const single = await exportFiles("complete", [doc], true);
    const batch = await upload(single.bytes, {
      replaceFileId: target!.id,
      expectedRevision: 1,
      expectedEpoch: 1,
    });
    const failed = await commit(batch.id);
    expect(failed.status).toBe("failed");
    expect(failed.error!.code).toBe("CONTENT_CONFLICT");
    const zip = await JSZip.loadAsync(fullBytes);
    const manifest = JSON.parse(
      await zip.file("manifest.json")!.async("string"),
    );
    // JSON 合法的 ISO 年份 0000 不被 PostgreSQL 接受，制造正式树已开始写入后的事务错误。
    manifest.entries[0].createdAt = "0000-01-01T00:00:00.000Z";
    zip.file("manifest.json", JSON.stringify(manifest));
    const transaction = await upload(
      await zip.generateAsync({ type: "nodebuffer" }),
    );
    expect(transaction.job.status).toBe("ready");
    const rolledBack = await commit(transaction.id);
    expect(rolledBack.status).toBe("failed");
    expect(
      (
        await database.db
          .select()
          .from(files)
          .where(eq(files.spaceId, destination))
      ).length,
    ).toBe(treeBefore.length);
    expect(
      (
        await database.db
          .select()
          .from(assets)
          .where(eq(assets.spaceId, destination))
      ).length,
    ).toBe(assetBefore.length);
    expect(
      (await readdir(directory, { withFileTypes: true }))
        .filter((row) => row.isFile())
        .map((row) => row.name)
        .sort(),
    ).toEqual(diskBefore);
    expect(
      (await request("GET", `files/${target!.id}/content`)).json().projection,
    ).toEqual(beforeContent.projection);
  }, 20000);
  test("服务重启保留成功结果与正式图片，清理崩溃暂存；过期任务不占用新任务名额", async () => {
    const [receipt] = await database.db
      .select()
      .from(fileTransferImports)
      .where(eq(fileTransferImports.spaceId, destination));
    const [retained] = await database.db
      .select()
      .from(assets)
      .where(eq(assets.spaceId, destination));
    const orphan = crypto.randomUUID(),
      fakeJob = crypto.randomUUID();
    const interrupted = join(directory, ".file-transfers", fakeJob);
    await mkdir(interrupted, { recursive: true });
    await Bun.write(join(directory, orphan), png);
    await Bun.write(
      join(interrupted, "pending-assets.json"),
      JSON.stringify([orphan, retained!.id]),
    );
    await app.close();
    const oldTtl = process.env.FILE_TRANSFER_TTL_MS;
    process.env.FILE_TRANSFER_TTL_MS = "1000";
    try {
      app = await buildApp(
        loadConfig({
          DATABASE_URL: url!,
          APP_ENV: "staging",
          AUTH_TRANSPORT: "bearer",
          WEB_CMS_DIST: "tests/fixtures/web-cms",
          WEB_DIST: "tests/fixtures/web",
          LOG_LEVEL: "silent",
        }),
        { logger: false },
      );
      await app.ready();
    } finally {
      if (oldTtl === undefined) delete process.env.FILE_TRANSFER_TTL_MS;
      else process.env.FILE_TRANSFER_TTL_MS = oldTtl;
    }
    expect(await Bun.file(join(directory, orphan)).exists()).toBe(false);
    expect(await Bun.file(join(directory, retained!.storageKey)).exists()).toBe(
      true,
    );
    const replay = await request("GET", `file-transfers/${receipt!.id}`);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().fileIds).toEqual(receipt!.fileIds);
    expect(
      (await request("POST", `file-transfers/${receipt!.id}/commit`, {})).json()
        .status,
    ).toBe("completed");
    const batchId = crypto.randomUUID();
    expect(
      (
        await request("POST", `spaces/${destination}/file-imports`, {
          batchId,
          parentId: null,
          replaceFileId: null,
        })
      ).statusCode,
    ).toBe(200);
    await Bun.sleep(1100);
    expect((await request("GET", `file-transfers/${batchId}`)).statusCode).toBe(
      404,
    );
    const next = await request("POST", `spaces/${destination}/file-imports`, {
      batchId: crypto.randomUUID(),
      parentId: null,
      replaceFileId: null,
    });
    expect(next.statusCode).toBe(200);
    expect(
      (await request("DELETE", `file-transfers/${next.json().id}`)).statusCode,
    ).toBe(200);
  }, 20000);
  test("关闭服务先中止未完成上传，不等待处理超时且释放监听端口", async () => {
    const id = crypto.randomUUID();
    const created = await request(
      "POST",
      `spaces/${destination}/file-imports`,
      { batchId: id, parentId: null, replaceFileId: null },
    );
    expect(created.statusCode).toBe(200);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string")
      throw Error("缺少测试监听地址");
    let outgoing!: ClientRequest;
    const uploading = new Promise<void>((resolve) => {
      outgoing = httpRequest(
        `http://127.0.0.1:${address.port}/api/app/file-transfers/${id}/package`,
        {
          method: "PUT",
          headers: { ...headers(), "content-type": "application/zip" },
        },
        (response) => {
          response.resume();
          response.on("end", resolve);
        },
      );
      outgoing.on("error", () => resolve());
      outgoing.on("close", () => resolve());
      outgoing.flushHeaders();
      outgoing.write(Buffer.from([80, 75, 3, 4]));
    });
    let inProgress = false;
    for (let count = 0; count < 100; count++) {
      const result = await request("GET", `file-transfers/${id}`);
      if (result.json().status === "processing") {
        inProgress = true;
        break;
      }
      await Bun.sleep(5);
    }
    expect(inProgress).toBe(true);
    await Promise.race([
      app.close(),
      Bun.sleep(2000).then(() => {
        throw Error("慢上传阻止了服务停机");
      }),
    ]);
    outgoing.destroy();
    await uploading;
    const probe = Bun.serve({
      hostname: "127.0.0.1",
      port: address.port,
      fetch: () => new Response("probe"),
    });
    await probe.stop(true);
  }, 10000);
});
