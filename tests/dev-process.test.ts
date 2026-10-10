import { expect, test } from "bun:test";

const databaseUrl = process.env.DEV_PROCESS_DATABASE_URL;
const runtimeTest =
  process.env.RUNTIME_PROCESS_TEST === "true" && databaseUrl ? test : test.skip;

runtimeTest(
  "统一开发命令启动三个服务，退出时释放全部端口",
  async () => {
    if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith("_test")) {
      throw new Error("DEV_PROCESS_DATABASE_URL 必须指向独立 _test 数据库");
    }
    const reservations = [];
    for (let i = 0; i < 3; i++) {
      const reservation = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch: () => new Response(),
      });
      reservations.push(reservation);
    }
    const ports = reservations.map((reservation) => reservation.port!);
    await Promise.all(
      reservations.map((reservation) => reservation.stop(true)),
    );
    const child = Bun.spawn([process.execPath, "scripts/dev.ts"], {
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        PORT: String(ports[0]),
        WEB_PORT: String(ports[1]),
        WEB_CMS_PORT: String(ports[2]),
        API_PROXY_TARGET: `http://127.0.0.1:${ports[0]}`,
        LOG_LEVEL: "silent",
      },
      stdout: "inherit",
      stderr: "inherit",
    });
    try {
      const deadline = Date.now() + 20000;
      for (const port of ports) {
        let ready = false;
        while (Date.now() < deadline && child.exitCode === null) {
          try {
            const response = await fetch(
              `http://127.0.0.1:${port}/api/health`,
              { signal: AbortSignal.timeout(1000) },
            );
            ready =
              response.ok && (await response.json()).database === "connected";
          } catch {}
          if (ready) break;
          await Bun.sleep(100);
        }
        expect(ready).toBe(true);
      }
      child.kill("SIGTERM");
      await Promise.race([
        child.exited,
        Bun.sleep(5000).then(() => {
          throw new Error("开发进程未退出");
        }),
      ]);
      for (const port of ports) {
        const probe = Bun.serve({
          hostname: "127.0.0.1",
          port,
          fetch: () => new Response(),
        });
        expect(probe.port).toBe(port);
        await probe.stop(true);
      }
    } finally {
      if (child.exitCode === null) child.kill("SIGTERM");
      await child.exited;
    }
  },
  30000,
);
