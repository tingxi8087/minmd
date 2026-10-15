// 部署验收客户端：在 Node 中使用真实 ws，避免 Bun 的 ws / HTTPS 兼容层影响自定义 CA 和 101 升级事件。
const { readFileSync, writeFileSync } = require("node:fs");
const { createRequire } = require("node:module");
const dependency = createRequire(
  require("node:path").join(process.env.MINMD_SOURCE_ROOT, "package.json"),
);
const { HocuspocusProvider, HocuspocusProviderWebsocket } = dependency(
  "@hocuspocus/provider",
);
const WebSocket = dependency("ws");
const Y = dependency("yjs");
const config = JSON.parse(
  readFileSync(process.env.MINMD_TLS_PROBE_FILE, "utf8"),
);
const clients = [];
const origin = config.origin ?? `https://${config.domain}`;
const marker = config.origin ? "HTTP双端同步" : "TLS双端同步";
const wait = async (predicate, label) => {
  const end = Date.now() + 15000;
  while (!predicate()) {
    if (Date.now() > end) throw Error(`等待超时：${label}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};
class TrustedSocket extends WebSocket {
  constructor(address, protocols) {
    super(String(address).replace(config.domain, "127.0.0.1"), protocols, {
      ca: config.ca,
      servername: config.domain,
      rejectUnauthorized: true,
      headers: { Origin: origin, Host: new URL(origin).host },
    });
  }
}
(async () => {
  try {
    for (const ticket of config.tickets) {
      const doc = new Y.Doc();
      let synced = false,
        failure = "";
      const ws = new HocuspocusProviderWebsocket({
        url: `${origin.replace(/^http/, "ws")}/api/app/collaboration/documents/${config.fileId}`,
        WebSocketPolyfill: TrustedSocket,
        autoConnect: false,
      });
      const provider = new HocuspocusProvider({
        name: config.fileId,
        document: doc,
        websocketProvider: ws,
        token: ticket,
        onSynced: ({ state }) => {
          synced = state;
        },
        onAuthenticationFailed: ({ reason }) => {
          failure = reason;
        },
        onClose: ({ event }) => {
          if (!synced) failure = `连接关闭 ${event.code}`;
        },
      });
      clients.push({ doc, ws, provider });
      provider.attach();
      void ws.connect().catch((error) => {
        failure = error.message;
      });
      await wait(() => synced || failure, "WSS 协作认证与同步");
      if (failure) throw Error(failure);
    }
    const first = clients[0].doc.getXmlFragment("default").get(0);
    if (!(first instanceof Y.XmlElement)) throw Error("正文段落未加载");
    const text = first.get(0);
    if (!(text instanceof Y.XmlText)) throw Error("正文文字未加载");
    text.insert(0, marker);
    await wait(
      () =>
        clients[1].doc.getXmlFragment("default").toString().includes(marker),
      "TLS 双端编辑广播",
    );
    writeFileSync(
      config.snapshotPath,
      JSON.stringify(Array.from(Y.encodeSnapshot(Y.snapshot(clients[0].doc)))),
      { mode: 0o600 },
    );
    console.log(
      `${config.origin ? "HTTP IP 直连" : "TLS 证书校验"}、双端协作认证及编辑广播通过`,
    );
  } finally {
    for (const client of clients) {
      client.provider.destroy();
      client.ws.destroy();
      client.doc.destroy();
    }
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
