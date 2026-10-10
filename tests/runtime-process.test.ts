import { expect, test } from "bun:test";
const processTest =
  process.env.RUNTIME_PROCESS_TEST === "true" ? test : test.skip;
const entry = `
  import { mock } from 'bun:test';
  mock.module('./system/server/src/modules/auth/bootstrap', () => ({initializeSuperAdmin: async () => {}}));
  import Fastify from 'fastify';
  import { startApp } from './system/server/src/index';
  await startApp(async () => {
    const app = Fastify({logger:false});
    app.addHook('onListen',async()=>{console.log('READY');});
    app.addHook('onClose',async()=>{await new Promise(r=>setTimeout(r,50));console.log('CLOSED');});
    return app;
  });
  console.log('HANDLERS', process.listenerCount('SIGINT'), process.listenerCount('SIGTERM'));
`;
const spawn = (port: number) =>
  Bun.spawn([process.execPath, "-e", entry], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      DATABASE_URL: "postgresql://localhost/unused_test",
      LOG_LEVEL: "silent",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
processTest(
  "SIGINT and SIGTERM wait for app close and exit successfully",
  async () => {
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      const reservation = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch: () => new Response("occupied"),
      });
      const port = reservation.port!;
      await reservation.stop(true);
      const child = spawn(port);
      try {
        const reader = child.stdout.getReader();
        let output = "";
        try {
          await Promise.race([
            (async () => {
              while (!output.includes("READY")) {
                const chunk = await reader.read();
                if (chunk.done)
                  throw new Error("Child exited before listening");
                output += new TextDecoder().decode(chunk.value);
              }
            })(),
            Bun.sleep(5000).then(() => {
              throw new Error("Child listen timed out");
            }),
          ]);
        } finally {
          reader.releaseLock();
        }
        child.kill(signal);
        expect(await child.exited).toBe(0);
        const tail = child.stdout.getReader();
        while (true) {
          const chunk = await tail.read();
          if (chunk.done) break;
          output += new TextDecoder().decode(chunk.value);
        }
        tail.releaseLock();
        expect(output).toContain("CLOSED");
      } finally {
        if (child.exitCode === null) child.kill("SIGKILL");
        await child.exited;
      }
    }
  },
  15000,
);
processTest(
  "listen failure closes the app, removes signal handlers and prints a safe hint",
  async () => {
    const occupied = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => new Response("occupied"),
    });
    const child = spawn(occupied.port!);
    try {
      expect(await child.exited).toBe(1);
      const output = await new Response(child.stdout).text();
      expect(output).toContain("CLOSED");
      expect(output).toContain("HANDLERS 0 0");
      expect(await new Response(child.stderr).text()).toContain("EADDRINUSE");
    } finally {
      if (child.exitCode === null) child.kill("SIGKILL");
      await child.exited;
      await occupied.stop(true);
    }
  },
  10000,
);
