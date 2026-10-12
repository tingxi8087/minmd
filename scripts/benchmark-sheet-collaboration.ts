import Fastify from "fastify";
import WebSocket from "ws";
import { randomUUID, createHash } from "node:crypto";
import { cpus, totalmem, platform, arch, release } from "node:os";
import { eq, inArray } from "drizzle-orm";
import { createDatabase } from "../system/server/src/database/client";
import { loadConfig } from "../system/server/src/config/env";
import { hashToken } from "../system/server/src/modules/auth/password";
import {
  appUsers,
  appUserSessions,
} from "../apps/app_server/src/database/schema/users";
import {
  spaces,
  spaceMembers,
} from "../apps/app_server/src/database/schema/spaces";
import { files } from "../apps/app_server/src/database/schema/files";
import { fileContents } from "../apps/app_server/src/database/schema/contents";
import {
  registerSheetRooms,
  prepareSheet,
} from "../apps/app_server/src/modules/collaboration/sheet-room";

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw Error("性能验收必须显式指定独立 _test 数据库");
type Packet = Record<string, unknown>;
const mib = (bytes: number) => Math.round((bytes / 1024 / 1024) * 100) / 100;
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
const check = (value: unknown, label: string) => {
  if (!value) throw Error(`验收失败：${label}`);
};

async function server() {
  const database = createDatabase(url!);
  const app = Fastify({ logger: false, forceCloseConnections: true });
  const manager = await registerSheetRooms(
    app,
    database,
    loadConfig({
      DATABASE_URL: url!,
      APP_ENV: "staging",
      AUTH_TRANSPORT: "bearer",
      LOG_LEVEL: "silent",
    }),
  );
  const identities = JSON.parse(process.env.MINMD_BENCH_IDENTITIES!) as {
    userId: string;
    sessionId: string;
  }[];
  const fileId = process.env.MINMD_BENCH_FILE!;
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
  // 仅此独立验收进程的本地票据端点；不会注册到正式应用。
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
        `benchmark-editor-${request.params.slot}`,
      );
    },
  );
  app.get("/bench/stats", async () => ({
    ...sample(),
    cpu: process.cpuUsage(),
  }));
  app.post("/bench/shutdown", async () => {
    // 本机 Bun/macOS 的信号退出行为不同；独立验收入口明确等待房间与数据库关闭。
    setTimeout(() => {
      clearInterval(timer);
      void app
        .close()
        .then(() => database.close())
        .then(() => process.exit(0));
    }, 20);
    return { accepted: true };
  });
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

async function benchmark() {
  const database = createDatabase(url!);
  const prefix = `sheetperf_${Date.now()}`;
  const users: string[] = [],
    clients: WebSocket[] = [];
  let spaceId = "",
    fileId = "",
    child: ReturnType<typeof Bun.spawn> | undefined;
  const latencies: number[] = [],
    waveReports: Record<string, unknown>[] = [];
  const latest: Packet[] = [];
  const ackWaiters = new Map<
    string,
    { resolve: (value: Packet) => void; reject: (error: Error) => void }
  >();
  try {
    const identities: { userId: string; sessionId: string }[] = [];
    for (let slot = 0; slot < 10; slot++) {
      const [user] = await database.db
        .insert(appUsers)
        .values({
          account: `${prefix}_${slot}`,
          passwordHash: "performance-fixture-no-login",
        })
        .returning({ id: appUsers.id });
      users.push(user!.id);
      const [session] = await database.db
        .insert(appUserSessions)
        .values({
          userId: user!.id,
          tokenHash: hashToken(randomUUID()),
          transport: "bearer",
          expiresAt: new Date(Date.now() + 10 * 60_000),
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
      .values(users.map((userId) => ({ userId, spaceId })));
    const [file] = await database.db
      .insert(files)
      .values({
        spaceId,
        name: "10000单元格与1000公式性能验收",
        kind: "sheet",
        createdBy: users[0]!,
      })
      .returning({ id: files.id });
    fileId = file!.id;
    const cells = Array.from({ length: 1000 }, (_, row) =>
      Array.from({ length: 10 }, (_, column) => ({
        r: row,
        c: column,
        v:
          column === 9
            ? { f: `=A${row + 1}*2`, fc: "#168b78" }
            : { v: row * 10 + column + 1 },
      })),
    ).flat();
    const initial = prepareSheet({
      sheets: [
        { id: "bench", name: "数据", row: 1000, column: 10, celldata: cells },
      ],
    });
    await database.db.insert(fileContents).values({
      fileId,
      engine: "fortune",
      revision: 1,
      epoch: 1,
      projectionRevision: 1,
      ...initial,
    });
    const startServer = async () => {
      child = Bun.spawn(["bun", import.meta.path, "--server"], {
        env: {
          ...process.env,
          MINMD_BENCH_FILE: fileId,
          MINMD_BENCH_IDENTITIES: JSON.stringify(identities),
        },
        stdout: "pipe",
        stderr: "inherit",
      });
      if (!(child.stdout instanceof ReadableStream))
        throw Error("验收进程输出不可读");
      const reader = child.stdout.getReader();
      let line = "";
      while (!line.includes("\n")) {
        const next = await reader.read();
        if (next.done) throw Error("验收服务启动失败");
        line += new TextDecoder().decode(next.value);
      }
      reader.releaseLock();
      return JSON.parse(line.split("\n")[0]!) as {
        port: number;
        pid: number;
      };
    };
    const stopServer = async () => {
      if (!child) return;
      const shutdown = await fetch(`${origin}/bench/shutdown`, {
        method: "POST",
      });
      check(shutdown.ok, "独立验收服务接受关闭请求");
      const exited = await Promise.race([
        child.exited,
        Bun.sleep(5000).then(() => undefined),
      ]);
      if (exited === undefined) {
        child.kill("SIGKILL");
        await child.exited;
        throw Error("代表性工作簿服务未正常关闭，不能验证一致重启恢复");
      }
      check(exited === 0, "代表性工作簿服务正常退出");
      child = undefined;
    };
    let ready = await startServer();
    let origin = `http://127.0.0.1:${ready.port}`;
    const stats = async () =>
      (await (await fetch(`${origin}/bench/stats`)).json()) as Record<
        string,
        number
      >;
    const cold = await stats();
    const connectAll = async () => {
      for (let slot = 0; slot < 10; slot++) {
        const ticket = (await (
          await fetch(`${origin}/bench/ticket/${slot}`)
        ).json()) as { ticket: string };
        const socket = new WebSocket(
          `ws://127.0.0.1:${ready.port}/api/app/collaboration/sheets/${fileId}`,
        );
        clients.push(socket);
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(Error("初始快照超时")),
            60_000,
          );
          socket.on("open", () =>
            socket.send(
              JSON.stringify({
                type: "auth",
                ticket: ticket.ticket,
                schemaVersion: 1,
                protocolVersion: 1,
              }),
            ),
          );
          socket.on("error", reject);
          socket.on("message", (raw) => {
            const packet = JSON.parse(raw.toString()) as Packet;
            if (packet.type === "snapshot") {
              latest[slot] = packet;
              clearTimeout(timeout);
              resolve();
            } else if (packet.type === "ack") {
              ackWaiters.get(String(packet.operationId))?.resolve(packet);
            } else if (packet.type === "error") {
              const error = Error(
                `${String(packet.code)}: ${String(packet.message)}`,
              );
              ackWaiters.get(String(packet.operationId))?.reject(error);
            }
          });
        });
      }
    };
    await connectAll();
    const connected = await stats();
    const send = async (
      slot: number,
      operations: Record<string, unknown>[],
      baseRevision: number,
      undo = false,
    ) => {
      const operationId = randomUUID(),
        began = performance.now();
      const ack = await new Promise<Packet>((resolve, reject) => {
        const timer = setTimeout(() => {
          ackWaiters.delete(operationId);
          reject(Error("持久化ACK超过60秒"));
        }, 60_000);
        ackWaiters.set(operationId, {
          resolve: (packet) => {
            clearTimeout(timer);
            ackWaiters.delete(operationId);
            resolve(packet);
          },
          reject: (error) => {
            clearTimeout(timer);
            ackWaiters.delete(operationId);
            reject(error);
          },
        });
        clients[slot]!.send(
          JSON.stringify(
            undo
              ? { type: "undo", baseRevision, operationId, epoch: 1 }
              : {
                  type: "operations",
                  operationId,
                  epoch: 1,
                  baseRevision,
                  operations,
                },
          ),
        );
      });
      latencies.push(performance.now() - began);
      return Number(ack.revision);
    };
    const wave = async (
      name: string,
      operations: (slot: number) => Record<string, unknown>[],
      undo = false,
    ) => {
      const base = Number(latest[0]!.revision),
        began = performance.now(),
        before = latencies.length;
      await Promise.all(
        clients.map((_, slot) => send(slot, operations(slot), base, undo)),
      );
      const times = latencies.slice(before).sort((a, b) => a - b);
      waveReports.push({
        name,
        durableAcks: times.length,
        elapsedMs: Math.round(performance.now() - began),
        p50Ms: Math.round(times[Math.floor(times.length * 0.5)]!),
        p95Ms: Math.round(
          times[Math.min(times.length - 1, Math.floor(times.length * 0.95))]!,
        ),
        memory: await stats(),
      });
    };
    for (let round = 0; round < 3; round++)
      await wave(`不同单元格并发-${round + 1}`, (slot) => [
        {
          type: "setCellContent",
          sheetId: "bench",
          row: 300 + slot,
          column: 0,
          value: 1000 + round * 10 + slot,
        },
      ]);
    await wave("同格LWW", (slot) => [
      {
        type: "setCellContent",
        sheetId: "bench",
        row: 500,
        column: 0,
        value: slot + 100,
      },
    ]);
    await wave("同锚点并发插行", () => [
      { type: "insertRows", sheetId: "bench", index: 10, count: 1 },
    ]);
    await wave("插行与旧坐标写入同时并发", (slot) =>
      slot < 5
        ? [{ type: "insertRows", sheetId: "bench", index: 10, count: 1 }]
        : [
            {
              type: "setCellContent",
              sheetId: "bench",
              row: 920 + slot - 5,
              column: 0,
              value: 3000 + slot,
            },
          ],
    );
    await wave("插行后并发修改依赖输入", (slot) => [
      {
        type: "setCellContent",
        sheetId: "bench",
        row: 915 + slot,
        column: 0,
        value: 2000 + slot,
      },
    ]);
    await wave("个人撤销依赖输入", () => [], true);
    const final = await stats();
    const [stored] = await database.db
      .select()
      .from(fileContents)
      .where(eq(fileContents.fileId, fileId));
    const authoritative = stored!.projection.sheets as {
      row: number;
      data: (Record<string, unknown> | null)[][];
    }[];
    const expected = digest(authoritative);
    const convergenceDeadline = Date.now() + 30_000;
    while (
      latest.some((packet) => Number(packet.revision) !== stored!.revision) &&
      Date.now() < convergenceDeadline
    )
      await Bun.sleep(5);
    check(stored!.revision === 81, "80个原子命令持久化修订");
    check(authoritative[0]!.row === 1015, "15个并发插行均保留");
    check(
      authoritative[0]!.data[915]![9]!.f === "=A916*2",
      "旧行公式引用随插行重定位",
    );
    check(
      authoritative[0]!.data[915]![9]!.v === 18002,
      "个人撤销后恢复依赖输入与公式结果",
    );
    check(
      authoritative[0]!.data[925]![0]!.v === 3005,
      "并发结构操作期间旧坐标写入保留在原行",
    );
    const converged = latest.every(
      (packet) =>
        Number(packet.revision) === stored!.revision &&
        digest(packet.workbook) === expected,
    );
    check(converged, "10客户端与数据库工作簿一致");
    const beforeRestartHashes = latest.map((packet) => digest(packet.workbook));
    const beforeRestartPid = ready.pid;
    clients.forEach((client) => client.terminate());
    clients.length = 0;
    await stopServer();
    const restartBegan = performance.now();
    ready = await startServer();
    check(ready.pid !== beforeRestartPid, "代表性工作簿在新进程恢复");
    origin = `http://127.0.0.1:${ready.port}`;
    await connectAll();
    const restartElapsedMs = Math.round(performance.now() - restartBegan);
    const recovered = latest.every(
      (packet) =>
        Number(packet.revision) === stored!.revision &&
        digest(packet.workbook) === expected,
    );
    check(recovered, "实际进程重启后10客户端恢复相同修订与工作簿哈希");
    const sorted = [...latencies].sort((a, b) => a - b);
    console.log(
      JSON.stringify(
        {
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
            serverPid: ready.pid,
            isolatedServer: true,
            localhost: true,
          },
          scale: {
            editorSessions: 10,
            userAccounts: 10,
            initialNonemptyCells: cells.length,
            formulaCells: 1000,
            finalRows: authoritative[0]!.row,
            durableAcks: latencies.length,
            finalRevision: stored!.revision,
            projectedBytes: Buffer.byteLength(
              JSON.stringify(stored!.projection),
            ),
            engineStateBytes: Buffer.byteLength(
              JSON.stringify(stored!.engineState),
            ),
          },
          ackLatency: {
            p50Ms: Math.round(sorted[Math.floor(sorted.length * 0.5)]!),
            p95Ms: Math.round(
              sorted[
                Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))
              ]!,
            ),
            maxMs: Math.round(sorted.at(-1)!),
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
          waves: waveReports,
          convergence: {
            databaseAndAllClients: converged,
            sha256: expected,
            beforeRestartHashes,
            restartRecovered: recovered,
            restartElapsedMs,
            restartShutdown: "等待app.close与database.close的本机验收入口",
            clients: latest.map((packet) => ({
              revision: packet.revision,
              sha256: digest(packet.workbook),
            })),
          },
        },
        null,
        2,
      ),
    );
    check(converged, "10客户端与数据库工作簿一致");
  } finally {
    clients.forEach((client) => client.terminate());
    if (child) {
      child.kill("SIGTERM");
      const exited = await Promise.race([
        child.exited,
        Bun.sleep(5000).then(() => undefined),
      ]);
      if (exited === undefined) {
        child.kill("SIGKILL");
        await child.exited;
      }
    }
    if (fileId) await database.db.delete(files).where(eq(files.id, fileId));
    if (spaceId) await database.db.delete(spaces).where(eq(spaces.id, spaceId));
    if (users.length)
      await database.db.delete(appUsers).where(inArray(appUsers.id, users));
    await database.close();
  }
}
if (process.argv.includes("--server")) await server();
else await benchmark();
