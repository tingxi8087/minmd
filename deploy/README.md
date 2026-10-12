# Docker 部署

开发数据库继续使用 [compose.yaml](compose.yaml)。完整应用使用 [compose.production.yaml](compose.production.yaml)，镜像由 [Dockerfile](Dockerfile) 构建。要求 Docker Engine、Compose v2（支持 `--wait`）和足够的构建内存。

## 拓扑和限制

- `web` 提供前台 `/`、后台 `/admin/`，反向代理 `/api/` 与 `/mcp`。
- `app` 同时运行 HTTP、文档 Hocuspocus 房间和表格权威房间。**只能运行一个 app 实例**，不能使用 `--scale app=2`；房间在内存中串行处理，持久状态、更新日志、历史版本在 PostgreSQL 中。
- `postgres_data` 保存整个数据库，`asset_data` 保存私有图片和 PPTX。Nginx 不挂载附件卷，公开分享图片也通过分享授权接口读取。
- `migrate` 是显式的一次性任务，不在应用启动时自动迁移。
- web HTTP 端口只绑定宿主 `127.0.0.1`；app 和 PostgreSQL 不发布宿主端口。宿主机 HTTPS 代理负责证书和对外入口。
- app 仅信任固定 web 内网 IP；代理网络、web IP 和宿主代理网关可配置；web 只信任指定网关传入的 X-Forwarded-For，向 app 传已解析的客户端地址。不同部署、恢复演练项目必须选择不同且不冲突的子网。
- 文档 / 表格每文件默认最多 10 个编辑会话，同账号多页面分别计数。退出或升级会断开房间，客户端需要重新连接。

文档连接通过 `DOC_COLLAB_MESSAGES_PER_SECOND` 限制每秒入队消息（默认100，范围1–1000）。

AI业务执行使用 `AI_EXECUTION_TIMEOUT_MS`（默认15000毫秒，范围1000–60000），不包含附件传输。超时按原 `requestId` 查询或重试，避免重复操作。

## 首次部署

从仓库根目录执行；保留已有配置，不覆盖：

```sh
cp deploy/.env.production.example deploy/.env.production
chmod 600 deploy/.env.production
openssl rand -hex 32
```

将随机值填入 `POSTGRES_PASSWORD`，另设独立的 `ADMIN_PASSWORD`。数据库密码使用随机十六进制，避免数据库连接 URL 中需要转义的字符。配置实际 `PUBLIC_ORIGIN=https://你的域名`，不含路径或末尾斜杠；前后台同源。首次管理员密码在新库初始化时使用，已有超管不会被覆盖。首次登录后修改密码，并由后台创建前台账号；公开注册默认关闭。

填写镜像标签 `MINMD_IMAGE_TAG`、Compose 项目名和不冲突的网络。文件中 JSON 上限默认 16 MiB；Nginx 请求上限 51 MiB，PPTX 后端 multipart 上限 50 MiB，图片 1 MiB。Nginx 协作和 MCP 响应等待上限 3600 秒，保持 WebSocket Upgrade 和 MCP 流式响应，应用身份与会话校验继续生效。

```sh
docker compose --env-file deploy/.env.production -f deploy/compose.production.yaml config --quiet
docker compose --env-file deploy/.env.production -f deploy/compose.production.yaml --profile tools build
docker compose --env-file deploy/.env.production -f deploy/compose.production.yaml up -d --wait --wait-timeout 60 postgres
docker compose --env-file deploy/.env.production -f deploy/compose.production.yaml run --rm migrate
docker compose --env-file deploy/.env.production -f deploy/compose.production.yaml up -d --wait --wait-timeout 120 app web
```

迁移失败时不要启动 app，不清库、不删除已应用迁移。保留日志，核查目标库、版本和失败 SQL，修复后重试迁移。后端必须找到 `/app/dist/web-cms/index.html`，即使后台静态文件实际由 Nginx 提供。

用已有的 Caddy 或 Nginx 为该域名配置 HTTPS，转发至 `127.0.0.1:8080`（或 `WEB_BIND_PORT`）。外层 Nginx 的转发需保留原 Host、WebSocket Upgrade，关闭响应缓冲并允许至少 51 MiB 请求，例如在已经配置证书的 HTTPS server 内：

```nginx
location / {
  proxy_pass http://127.0.0.1:8080;
  proxy_http_version 1.1;
  proxy_set_header Host $http_host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header Upgrade $http_upgrade;
  # 简化为保持连接；有map配置时可按Upgrade使用upgrade/close。
  proxy_set_header Connection "upgrade";
  proxy_read_timeout 3600s;
  proxy_buffering off;
  client_max_body_size 51m;
}
```

浏览器只访问 HTTPS 域名。生产 Cookie 为 Secure，直接打开 HTTP loopback 端口不能完成登录；健康检查 HTTP 可用不代表浏览器登录可用。不得把后台和前台改成不同来源来绕过 CSRF 校验。

```sh
curl --fail https://你的域名/api/health
docker compose --env-file deploy/.env.production -f deploy/compose.production.yaml ps
```

健康检查分别验证 PostgreSQL 就绪、app 的数据库健康接口和 Nginx 响应；它们不能替代协作、上传和权限验收。API 和 MCP 的 Nginx 访问日志关闭，避免分享路径中的令牌落日志；不要另加记录 Authorization、Cookie、正文或完整查询字符串的代理日志。

## 升级

1. 通知编辑者保存并等待服务器确认，安排停止写入窗口。
2. 执行下面的一致备份，妥善保存部署配置、对应 Git 提交 / 镜像标签。配置含凭证，单独加密保管，不写入 Git 或普通备份日志。
3. 使用新的 `MINMD_IMAGE_TAG` 构建目标版本，停止 `web app`，显式执行新版本迁移；成功后启动并验收。
4. 不进行滚动发布或并行 app 副本升级。文档、表格房间必须一起停止并等待落盘。

应用 SIGTERM 会关闭房间并等待数据库写入，当前进程超时为 10 秒，Compose 给出 30 秒停止宽限。非零退出表示不能确认正常收尾。不要使用 `docker kill`、直接清卷或 `down -v` 作为升级步骤。

数据库迁移通常不能自动向下回滚。新版本迁移成功后，旧代码未必兼容新 schema；需要回退时，恢复升级前整套数据库与附件，并使用匹配版本镜像。仅换回旧镜像不能视为安全回滚。

## 一致备份

备份脚本停止 web 和 app，包括所有协作 WebSocket，然后核查 app 正常退出。应用已停止或异常退出时，脚本拒绝假定落盘已经完成。之后保存整个数据库（含当前内容、Yjs 状态、表格快照 / 更新日志、版本、账号权限和迁移记录）与同一时点私有附件卷，并生成 SHA-256 校验清单。

```sh
deploy/scripts/backup.sh deploy/.env.production backups/2026-10-12-001
```

目标必须为新目录，不覆盖旧备份。成功后脚本恢复此前运行的 app 和 web。失败时可能保持停止状态，先核查错误和退出状态，补齐有效备份后手动启动；缺少数据库或附件的目录不是完整备份。

备份含私有正文、账号哈希和分享授权信息，应加密并限制访问，复制到独立存储。脚本不包含环境文件和 TLS 私钥，它们需通过独立加密渠道保管。API 密钥原文使用 `AI_KEY_ENCRYPTION_KEY` 加密，备份恢复必须保留相同配置，否则旧原文无法解密（哈希认证仍可使用）。历史版本默认不自动删除，备份和附件容量会增长。

## 恢复及演练

优先在独立 Compose 项目恢复。复制配置为新环境文件，修改 `COMPOSE_PROJECT_NAME`、`WEB_BIND_PORT`、代理子网 / 固定 IP / 网关、域名及数据库名，确保使用新的卷和不同端口。恢复过程中数据库和附件都会被替换，确认目标后才传 `--replace-data`。

使用与备份匹配的代码和镜像标签构建目标项目，然后执行：

```sh
deploy/scripts/restore.sh deploy/.env.restore backups/2026-10-12-001 --replace-data
docker compose --env-file deploy/.env.restore -f deploy/compose.production.yaml up -d --wait --wait-timeout 120 app web
```

恢复脚本先校验文件完整性，停止 app/web，等待 PostgreSQL 就绪，单事务恢复数据库，再替换附件卷。不会主动清库、删除整个 Docker 卷或启动应用；任何恢复失败都先保持写入停止。数据库备份包含原迁移记录，恢复后直接用对应版本启动，不先向空库运行不相关的新迁移。

在隔离目标登录，验证：

- 当前文档与表格内容、两个页面协作、关闭 / 重开后的持久化。
- 历史版本只读预览与恢复；恢复后其他页面重新进入新 epoch。
- 私有图片、PPTX 预览和原文件下载，公开分享密码与有效期。
- 成员权限、API 密钥和空间 AI 策略；若发生泄漏，按实际情况撤销相关密钥和分享链接。

恢复成功后记录实际核验结果，再决定是否切换访问入口。不要把镜像构建成功、Compose 启动或健康检查通过称为完成恢复演练。
