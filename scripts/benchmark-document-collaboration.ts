import Fastify from "fastify";
import WebSocket from "ws";
import * as Y from "yjs";
import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
} from "@hocuspocus/provider";
import { randomUUID, createHash } from "node:crypto";
import { cpus, totalmem, platform, arch, release, tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { eq, inArray } from "drizzle-orm";
import { createDatabase } from "../system/server/src/database/client";
import { loadConfig } from "../system/server/src/config/env";
import {
  hashPassword,
  hashToken,
} from "../system/server/src/modules/auth/password";
import {
  appUsers,
  appUserSessions,
} from "../apps/app_server/src/database/schema/users";
import {
  spaces,
  spaceMembers,
} from "../apps/app_server/src/database/schema/spaces";
import { files } from "../apps/app_server/src/database/schema/files";
import {
  fileContents,
  fileVersions,
} from "../apps/app_server/src/database/schema/contents";
import { assets } from "../apps/app_server/src/database/schema/assets";
import {
  syncContentAssets,
  storeAsset,
} from "../apps/app_server/src/modules/assets/service";
import {
  registerDocumentRooms,
  snapshotContains,
} from "../apps/app_server/src/modules/collaboration/document-room";
import {
  createDocumentState,
  documentProjection,
} from "../apps/app_server/src/modules/collaboration/document-schema";
import type { JSONContent } from "@tiptap/core";

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw Error("性能验收必须显式指定独立 _test 数据库");
const check = (value: unknown, label: string) => {
  if (!value) throw Error(`验收失败：${label}`);
};
const mib = (value: number) => Math.round((value / 1024 / 1024) * 100) / 100;
const canonical = (input: unknown): unknown =>
  Array.isArray(input)
    ? input.map(canonical)
    : input && typeof input === "object"
      ? Object.fromEntries(
          Object.entries(input)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => [key, canonical(value)]),
        )
      : input;
const digest = (input: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(input)))
    .digest("hex");
const wait = async (test: () => boolean, label: string, timeout = 60_000) => {
  const began = performance.now();
  while (!test()) {
    if (performance.now() - began > timeout) throw Error(`等待超时：${label}`);
    await Bun.sleep(5);
  }
};
const percentile = (samples: number[], p: number) =>
  Math.round(
    [...samples].sort((a, b) => a - b)[
      Math.min(samples.length - 1, Math.floor(samples.length * p))
    ]!,
  );

async function server() {
  const database = createDatabase(url!);
  const app = Fastify({ logger: false, forceCloseConnections: true });
  const manager = await registerDocumentRooms(
    app,
    database,
    loadConfig({
      DATABASE_URL: url!,
      APP_ENV: "staging",
      AUTH_TRANSPORT: "bearer",
      LOG_LEVEL: "silent",
    }),
  );
  const identities = JSON.parse(
    process.env.MINMD_DOCUMENT_BENCH_IDENTITIES!,
  ) as { userId: string; sessionId: string }[];
  const fileId = process.env.MINMD_DOCUMENT_BENCH_FILE!;
  let peakRss = 0,
    peakHeap = 0;
  const sample = () => {
    const memory = process.memoryUsage();
    peakRss = Math.max(peakRss, memory.rss);
    peakHeap = Math.max(peakHeap, memory.heapUsed);
    return {
      rssMiB: mib(memory.rss),
      heapMiB: mib(memory.heapUsed),
      peakRssMiB: mib(peakRss),
      peakHeapMiB: mib(peakHeap),
    };
  };
  const timer = setInterval(sample, 25);
  // 仅绑定本机随机端口的独立验收进程，正式应用不注册这些端点。
  app.get<{ Params: { slot: string } }>(
    "/bench/ticket/:slot",
    async (request) => {
      const identity = identities[Number(request.params.slot)];
      if (!identity) throw Error("无效验收会话");
      return manager.issueTicket(
        identity.userId,
        identity.sessionId,
        fileId,
        1,
      );
    },
  );
  app.get("/bench/stats", async () => ({
    ...sample(),
    cpu: process.cpuUsage(),
  }));
  app.post("/bench/barrier", async () => manager.persistBarrier(fileId));
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  if (!address || typeof address === "string") throw Error("监听失败");
  console.log(JSON.stringify({ port: address.port, pid: process.pid }));
  process.on("SIGTERM", () => {
    clearInterval(timer);
    void app
      .close()
      .then(() => database.close())
      .then(() => process.exit(0));
  });
}

interface Client {
  doc: Y.Doc;
  provider: HocuspocusProvider;
  ws: HocuspocusProviderWebsocket;
  synced: boolean;
  failure: string;
  count: number;
  pending?: {
    snapshot: Y.Snapshot;
    began: number;
    resolve: (time: number) => void;
  };
}
async function benchmark() {
  const database = createDatabase(url!);
  const prefix = `docperf_${Date.now()}`;
  const users: string[] = [],
    clients: Client[] = [],
    latencies: number[] = [],
    waves: Record<string, unknown>[] = [];
  const identities: { userId: string; sessionId: string }[] = [];
  let spaceId = "",
    fileId = "",
    directory = "",
    child: ReturnType<typeof Bun.spawn> | undefined;
  let ready: { port: number; pid: number } = { port: 0, pid: 0 },
    origin = "";
  const stopClient = (client: Client) => {
    client.provider.destroy();
    client.ws.destroy();
    client.doc.destroy();
  };
  const stopServer = async () => {
    if (!child) return;
    child.kill("SIGTERM");
    const code = await Promise.race([
      child.exited,
      Bun.sleep(8000).then(() => undefined),
    ]);
    if (code === undefined) {
      child.kill("SIGKILL");
      await child.exited;
    }
    child = undefined;
  };
  const startServer = async () => {
    child = Bun.spawn(["bun", import.meta.path, "--server"], {
      env: {
        ...process.env,
        MINMD_DOCUMENT_BENCH_FILE: fileId,
        MINMD_DOCUMENT_BENCH_IDENTITIES: JSON.stringify(identities),
      },
      stdout: "pipe",
      stderr: "inherit",
    });
    if (!(child.stdout instanceof ReadableStream))
      throw Error("验收服务输出不可读");
    const reader = child.stdout.getReader();
    let line = "";
    while (!line.includes("\n")) {
      const next = await reader.read();
      if (next.done) throw Error("验收服务启动失败");
      line += new TextDecoder().decode(next.value);
    }
    reader.releaseLock();
    ready = JSON.parse(line.split("\n")[0]!) as typeof ready;
    origin = `http://127.0.0.1:${ready.port}`;
  };
  const stats = async () =>
    (await (await fetch(`${origin}/bench/stats`)).json()) as Record<
      string,
      number
    >;
  const connect = async (slot: number) => {
    const ticket = (await (
      await fetch(`${origin}/bench/ticket/${slot}`)
    ).json()) as { ticket: string };
    const doc = new Y.Doc(),
      ws = new HocuspocusProviderWebsocket({
        url: `ws://127.0.0.1:${ready.port}/api/app/collaboration/documents/${fileId}`,
        WebSocketPolyfill: WebSocket,
        autoConnect: false,
      });
    const client = { doc, ws, synced: false, failure: "", count: 0 } as Client;
    const provider = new HocuspocusProvider({
      name: fileId,
      document: doc,
      websocketProvider: ws,
      token: ticket.ticket,
      onSynced: ({ state }) => {
        client.synced = state;
        if (state) provider.sendStateless("ready");
      },
      onAuthenticationFailed: ({ reason }) => {
        client.failure = reason;
        ws.disconnect();
      },
      onStateless: ({ payload }) => {
        const packet = JSON.parse(payload) as Record<string, unknown>;
        if (packet.type === "members") client.count = Number(packet.count);
        if (packet.type === "error") client.failure = String(packet.message);
        if (
          packet.type === "saved" &&
          client.pending &&
          Array.isArray(packet.snapshot) &&
          snapshotContains(
            client.pending.snapshot,
            Y.decodeSnapshot(Uint8Array.from(packet.snapshot as number[])),
          )
        ) {
          const pending = client.pending;
          client.pending = undefined;
          pending.resolve(performance.now() - pending.began);
        }
      },
    });
    client.provider = provider;
    clients.push(client);
    provider.attach();
    void ws.connect();
    await wait(() => client.synced || !!client.failure, "协作初始快照");
    check(!client.failure, client.failure);
    return client;
  };
  try {
    directory = await mkdtemp(join(tmpdir(), "minmd-document-bench-"));
    const passwordHash = await hashPassword("Document-performance-test-2026!");
    for (let slot = 0; slot < 10; slot++) {
      const [user] = await database.db
        .insert(appUsers)
        .values({ account: `${prefix}_${slot}`, passwordHash })
        .returning({ id: appUsers.id });
      users.push(user!.id);
      const [session] = await database.db
        .insert(appUserSessions)
        .values({
          userId: user!.id,
          tokenHash: hashToken(randomUUID()),
          transport: "bearer",
          expiresAt: new Date(Date.now() + 20 * 60_000),
        })
        .returning({ id: appUserSessions.id });
      identities.push({ userId: user!.id, sessionId: session!.id });
    }
    const [space] = await database.db
      .insert(spaces)
      .values({ name: prefix, ownerId: users[0]! })
      .returning({ id: spaces.id });
    spaceId = space!.id;
    await database.db
      .insert(spaceMembers)
      .values(users.map((userId) => ({ spaceId, userId })));
    const [file] = await database.db
      .insert(files)
      .values({
        spaceId,
        name: "1000段120k文字混合内容性能验收",
        kind: "doc",
        createdBy: users[0]!,
      })
      .returning({ id: files.id });
    fileId = file!.id;
    const asset = await storeAsset(
      database,
      directory,
      users[0]!,
      spaceId,
      "fixture.png",
      "image/png",
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
        "base64",
      ),
    );
    const text = "协作文档性能验收，保留每一个人的修改并确认内容已经持久保存。"
      .repeat(5)
      .slice(0, 120);
    const paragraphs: JSONContent[] = Array.from(
      { length: 1000 },
      (_, index) => ({
        type: "paragraph",
        attrs: { blockId: randomUUID() },
        content: [{ type: "text", text: `段落${index}：${text}` }],
      }),
    );
    const p = (value: string): JSONContent => ({
      type: "paragraph",
      content: [{ type: "text", text: value }],
    });
    const content: JSONContent = {
      type: "doc",
      content: [
        ...paragraphs,
        {
          type: "callout",
          attrs: { emoji: "💡", tone: "amber" },
          content: [p("高亮块的并发内容")],
        },
        {
          type: "fold",
          attrs: { title: "折叠块", open: true },
          content: [p("折叠块的并发内容")],
        },
        {
          type: "codeBlock",
          attrs: { language: "typescript" },
          content: [{ type: "text", text: "const durable: boolean = true;" }],
        },
        {
          type: "table",
          content: Array.from({ length: 10 }, () => ({
            type: "tableRow",
            content: Array.from({ length: 4 }, () => ({
              type: "tableCell",
              content: [p("表格单元格")],
            })),
          })),
        },
        {
          type: "image",
          attrs: {
            assetId: asset.id,
            src: asset.url,
            width: 200,
            align: "center",
          },
        },
      ],
    };
    const seed = createDocumentState(content),
      projection = documentProjection(seed),
      state = Buffer.from(Y.encodeStateAsUpdate(seed));
    seed.destroy();
    const initialIds = (projection.content as JSONContent[])
      .slice(0, 1000)
      .map((node) => node.attrs!.blockId as string);
    const specialIds = (projection.content as JSONContent[])
      .slice(1000, 1004)
      .map((node) => node.attrs!.blockId as string);
    await database.db.transaction(async (tx) => {
      await tx
        .insert(fileContents)
        .values({ fileId, engine: "yjs", projection, documentState: state });
      await syncContentAssets(tx, fileId, projection);
      const [version] = await tx
        .insert(fileVersions)
        .values({
          fileId,
          revision: 1,
          epoch: 1,
          source: "initial",
          actorId: users[0]!,
          projection,
          documentState: state,
        })
        .returning({ id: fileVersions.id });
      await syncContentAssets(tx, fileId, projection, version!.id);
    });
    await startServer();
    const cold = await stats();
    const connectBegan = performance.now();
    for (let slot = 0; slot < 10; slot++) await connect(slot);
    await wait(
      () => clients.every((client) => client.count === 10),
      "10个已认证编辑会话",
    );
    const connectElapsedMs = Math.round(performance.now() - connectBegan),
      connected = await stats();
    const node = (client: Client, id: string) => {
      const found = client.doc
        .getXmlFragment("default")
        .toArray()
        .find(
          (item) =>
            item instanceof Y.XmlElement && item.getAttribute("blockId") === id,
        );
      if (!(found instanceof Y.XmlElement)) throw Error("块ID丢失");
      return found;
    };
    const firstText = (parent: Y.XmlElement): Y.XmlText => {
      for (const item of parent.toArray()) {
        if (item instanceof Y.XmlText) return item;
        if (item instanceof Y.XmlElement) return firstText(item);
      }
      throw Error("文本块缺失");
    };
    const send = (slot: number, operation: (client: Client) => void) =>
      new Promise<number>((resolve, reject) => {
        const client = clients[slot]!;
        const began = performance.now();
        try {
          client.doc.transact(() => operation(client));
          const snapshot = Y.snapshot(client.doc);
          client.pending = { snapshot, began, resolve };
          void wait(
            () => !client.pending || !!client.failure,
            `编辑${slot}持久ACK`,
          ).then(() => {
            if (client.failure) reject(Error(client.failure));
          }, reject);
        } catch (error) {
          reject(error);
        }
      });
    const wave = async (
      name: string,
      operation: (client: Client, slot: number) => void,
    ) => {
      const began = performance.now();
      const times = await Promise.all(
        clients.map((_, slot) =>
          send(slot, (client) => operation(client, slot)),
        ),
      );
      latencies.push(...times);
      waves.push({
        name,
        durableAcks: times.length,
        elapsedMs: Math.round(performance.now() - began),
        p50Ms: percentile(times, 0.5),
        p95Ms: percentile(times, 0.95),
        memory: await stats(),
      });
    };
    for (let round = 0; round < 5; round++)
      await wave(`独立段落并发文字-${round + 1}`, (client, slot) =>
        firstText(node(client, initialIds[100 + slot]!)).insert(
          0,
          `[编辑${slot}-${round}]`,
        ),
      );
    await wave("同位置并发文字", (client, slot) =>
      firstText(node(client, initialIds[0]!)).insert(0, `[同位${slot}]`),
    );
    for (let round = 0; round < 3; round++)
      await wave(`同段落并发marks-${round + 1}`, (client, slot) =>
        firstText(node(client, initialIds[0]!)).format(
          20 + slot * 3,
          2,
          round === 0
            ? { bold: {} }
            : round === 1
              ? { italic: {} }
              : { underline: {} },
        ),
      );
    const added = Array.from({ length: 10 }, () => randomUUID());
    await wave("同锚点并发插块", (client, slot) => {
      const block = new Y.XmlElement("paragraph");
      block.setAttribute("blockId", added[slot]!);
      block.insert(0, [new Y.XmlText(`新增块${slot}`)]);
      client.doc.getXmlFragment("default").insert(10, [block]);
    });
    await wave("嵌套callout-fold-code-table并发文字", (client, slot) =>
      firstText(node(client, specialIds[slot % 4]!)).insert(0, `[嵌套${slot}]`),
    );
    await wave("分别删除刚新增的块", (client, slot) => {
      const root = client.doc.getXmlFragment("default"),
        block = node(client, added[slot]!);
      root.delete(root.toArray().indexOf(block), 1);
    });
    const barrier = await fetch(`${origin}/bench/barrier`, { method: "POST" });
    check(barrier.ok, "持久化屏障成功");
    const [stored] = await database.db
      .select()
      .from(fileContents)
      .where(eq(fileContents.fileId, fileId));
    const expected = digest(stored!.projection);
    await wait(
      () =>
        clients.every(
          (client) => digest(documentProjection(client.doc)) === expected,
        ),
      "10客户端和PG投影收敛",
    );
    const mainText = JSON.stringify(stored!.projection);
    // Marks会把同一段文字拆成多个JSON text节点，按可见文字检查不能搜索JSON原串。
    const plainText = (node: JSONContent): string =>
      node.text ?? (node.content ?? []).map(plainText).join("");
    const visibleText = plainText(stored!.projection as JSONContent);
    for (let slot = 0; slot < 10; slot++)
      check(visibleText.includes(`[同位${slot}]`), "同锚点每位作者文字保留");
    check(
      (stored!.projection.content as JSONContent[]).length === 1005,
      "插入和删除后块数量正确",
    );
    check(
      mainText.includes('"bold"') &&
        mainText.includes('"italic"') &&
        mainText.includes('"underline"'),
      "并发marks持久化",
    );
    const final = await stats(),
      finalPid = ready.pid,
      clientDigests = clients.map((client) =>
        digest(documentProjection(client.doc)),
      );
    clients.splice(0).forEach(stopClient);
    await Bun.sleep(100);
    await stopServer();
    await startServer();
    const restarted = await connect(0);
    check(
      digest(documentProjection(restarted.doc)) === expected,
      "重启后从PG恢复完全相同正文",
    );
    console.log(
      JSON.stringify(
        {
          measuredAt: new Date().toISOString(),
          hardware: {
            cpu: cpus()[0]?.model,
            logicalCpus: cpus().length,
            totalMemoryGiB: Math.round(totalmem() / 1024 ** 3),
            platform: platform(),
            arch: arch(),
            osRelease: release(),
            bun: Bun.version,
          },
          process: {
            serverPid: finalPid,
            restartPid: ready.pid,
            isolatedServer: true,
            localhost: true,
          },
          scale: {
            editorSessions: 10,
            userAccounts: 10,
            initialParagraphs: 1000,
            initialTextCharacters: paragraphs.reduce(
              (sum, paragraph) =>
                sum + (paragraph.content?.[0]?.text?.length ?? 0),
              0,
            ),
            mixedBlocks: ["callout", "fold", "codeBlock", "table", "image"],
            tableCells: 40,
            connectElapsedMs,
            durableAcks: latencies.length,
            finalRevision: stored!.revision,
            projectedBytes: Buffer.byteLength(
              JSON.stringify(stored!.projection),
            ),
            yjsStateBytes: stored!.documentState!.byteLength,
          },
          ackLatency: {
            p50Ms: percentile(latencies, 0.5),
            p95Ms: percentile(latencies, 0.95),
            maxMs: Math.round(Math.max(...latencies)),
          },
          memory: {
            cold,
            connected,
            final,
            rssGrowthAfterConnectedMiB:
              Math.round((final.rssMiB! - connected.rssMiB!) * 100) / 100,
            heapGrowthAfterConnectedMiB:
              Math.round((final.heapMiB! - connected.heapMiB!) * 100) / 100,
          },
          waves,
          convergence: {
            databaseAndAllClients: true,
            sha256: expected,
            clientDigests,
            restartRecovered: true,
          },
          limits: {
            latencyPassThresholdDefined: false,
            description: "记录单机本地性能基线；不替代编辑器渲染或广域网验收",
          },
        },
        null,
        2,
      ),
    );
  } finally {
    clients.forEach(stopClient);
    await Bun.sleep(100);
    await stopServer();
    if (fileId) await database.db.delete(files).where(eq(files.id, fileId));
    if (spaceId) {
      await database.db.delete(assets).where(eq(assets.spaceId, spaceId));
      await database.db.delete(spaces).where(eq(spaces.id, spaceId));
    }
    if (users.length)
      await database.db.delete(appUsers).where(inArray(appUsers.id, users));
    await database.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
if (process.argv.includes("--server")) await server();
else await benchmark();
