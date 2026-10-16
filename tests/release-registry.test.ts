import { expect, test } from "bun:test";
import { checkManifest, architectures, targets } from "../scripts/release";

const registryTest =
  process.env.RELEASE_REGISTRY_TEST === "true" ? test : test.skip;
registryTest(
  "本机镜像直接推送、双架构合并与 Docker v2 清单兼容",
  async () => {
    const version = process.env.RELEASE_REGISTRY_VERSION;
    if (!version || !/^v\d+\.\d+\.\d+(?:[.-][A-Za-z0-9.-]+)?$/.test(version))
      throw new Error("需要 RELEASE_REGISTRY_VERSION 固定版本");
    const name = `minmd-registry-test-${crypto.randomUUID().slice(0, 8)}`;
    const aliases: string[] = [];
    async function command(args: string[]) {
      const process = Bun.spawn(args, {
        stdout: "pipe",
        stderr: "pipe",
        timeout: 300000,
      });
      const [code, out, err] = await Promise.all([
        process.exited,
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
      ]);
      if (code) throw new Error(`${args[0]} ${args[1]}：${err}\n${out}`);
      return out.trim();
    }
    try {
      const reservation = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch: () => new Response(),
      });
      const port = reservation.port!;
      await reservation.stop(true);
      // daemon 的回环位于 Linux VM；host 网络使推送与 Registry 在同一命名空间。
      await command([
        "docker",
        "run",
        "-d",
        "--name",
        name,
        "--network",
        "host",
        "-e",
        `REGISTRY_HTTP_ADDR=0.0.0.0:${port}`,
        "registry:2",
      ]);
      let clientPort = String(port);
      let base = `http://127.0.0.1:${clientPort}`;
      await Bun.sleep(500);
      let reachable = false;
      try {
        reachable = (
          await fetch(`${base}/v2/`, { signal: AbortSignal.timeout(1000) })
        ).ok;
      } catch {
        /* Docker Desktop 默认不共享 Mac 回环。 */
      }
      if (!reachable) {
        const engine = await command([
          "docker",
          "info",
          "--format",
          "{{.Architecture}}",
        ]);
        const arch = ["aarch64", "arm64"].includes(engine) ? "arm64" : "amd64";
        const gateway = await command([
          "docker",
          "network",
          "inspect",
          "bridge",
          "--format",
          "{{(index .IPAM.Config 0).Gateway}}",
        ]);
        // 宿主客户端使用独立端口桥接 VM，daemon 直接访问 Registry；不改全局网络配置。
        await command([
          "docker",
          "run",
          "-d",
          "--name",
          `${name}-forward`,
          "-p",
          "127.0.0.1::5000",
          "--entrypoint",
          "bun",
          `minmd-release-app:${version}-${arch}`,
          "-e",
          `import net from "node:net";net.createServer(c=>{const u=net.connect(${port},${JSON.stringify(gateway)});c.pipe(u).pipe(c);u.on("error",()=>c.destroy());c.on("error",()=>u.destroy())}).listen(5000,"0.0.0.0");`,
        ]);
        clientPort = (
          await command(["docker", "port", `${name}-forward`, "5000/tcp"])
        )
          .split(":")
          .at(-1)!;
        base = `http://127.0.0.1:${clientPort}`;
      }
      const deadline = Date.now() + 20000;
      while (true) {
        try {
          if (
            (await fetch(`${base}/v2/`, { signal: AbortSignal.timeout(1000) }))
              .ok
          )
            break;
        } catch {
          /* 容器尚在启动。 */
        }
        if (Date.now() > deadline) throw new Error("测试 Registry 未启动");
        await Bun.sleep(200);
      }
      for (const target of targets) {
        const prefix = `127.0.0.1:${clientPort}/minmd-${target}`;
        const pushPrefix = `127.0.0.1:${port}/minmd-${target}`;
        for (const arch of architectures) {
          const local = `minmd-release-${target}:${version}-${arch}`;
          const destination = `${pushPrefix}:${version}-${arch}`;
          await command(["docker", "tag", local, destination]);
          aliases.push(destination);
          await command(["docker", "push", destination]);
          const response = await fetch(
            `${base}/v2/minmd-${target}/manifests/${version}-${arch}`,
            {
              headers: {
                accept: "application/vnd.docker.distribution.manifest.v2+json",
              },
            },
          );
          expect(response.ok).toBe(true);
          const manifest = (await response.json()) as {
            mediaType: string;
            config: { digest: string };
          };
          expect(manifest.mediaType).toBe(
            "application/vnd.docker.distribution.manifest.v2+json",
          );
          const config = await command([
            "docker",
            "image",
            "inspect",
            local,
            "--format",
            "{{.Id}}",
          ]);
          expect(manifest.config.digest).toBe(config);
        }
        await command([
          "docker",
          "buildx",
          "imagetools",
          "create",
          "--tag",
          `${prefix}:${version}`,
          ...architectures.map((arch) => `${prefix}:${version}-${arch}`),
        ]);
        const response = await fetch(
          `${base}/v2/minmd-${target}/manifests/${version}`,
          {
            headers: {
              accept:
                "application/vnd.docker.distribution.manifest.list.v2+json",
            },
          },
        );
        expect(response.ok).toBe(true);
        const raw = await response.text();
        checkManifest(raw);
        expect((JSON.parse(raw) as { mediaType: string }).mediaType).toBe(
          "application/vnd.docker.distribution.manifest.list.v2+json",
        );
      }
    } finally {
      for (const alias of aliases) {
        try {
          await command(["docker", "image", "rm", alias]);
        } catch {
          /* 继续清理自己的其他标签。 */
        }
      }
      try {
        await command(["docker", "rm", "-f", "-v", `${name}-forward`]);
      } catch {
        /* Linux 无需桥接容器。 */
      }
      await command(["docker", "rm", "-f", "-v", name]);
    }
  },
  600000,
);
