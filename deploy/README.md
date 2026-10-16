# 部署与维护

[项目介绍与使用](../README.md) · [本地开发与测试](../docs/DEVELOPMENT.md)

MinMD 前台、后台 `/admin/`、API、MCP 和文档 / 表格协作均由同一个后端提供。运行一个 app 实例和 PostgreSQL；自动 HTTPS 模式额外运行 Caddy。应用房间在进程内管理，不能通过增加 app 副本扩容。

## 三种安装模式

| 模式                  | 适合谁                                       | 宿主端口                                                        |
| --------------------- | -------------------------------------------- | --------------------------------------------------------------- |
| `proxy`：已有反向代理 | 已有 Nginx、Caddy、1Panel、宝塔等 HTTPS 入口 | 默认 `127.0.0.1:9811`，可选择其他端口；MinMD 不占用 80/443      |
| `direct`：IP 直连     | 没有域名、内网或临时体验                     | 默认 `0.0.0.0:9811`，只开放应用端口，无需 Nginx / Caddy         |
| `https`：自动 HTTPS   | 已有域名和全新服务器                         | Caddy 使用 TCP 80/443；app 的 9811 和 PostgreSQL 均不映射到宿主 |

`PUBLIC_ORIGIN` 必须填写浏览器最终访问的来源，不带路径或末尾斜杠。`proxy` / `https` 使用 HTTPS 和 Secure Cookie，例如 `https://docs.example.com`。`direct` 是显式的 HTTP IPv4 直连模式，例如 `http://192.168.1.10:9811`；仅此模式允许生产 HTTP Cookie 登录，仍保留 HttpOnly、SameSite、来源和 CSRF 校验。

自动 HTTPS 前先将域名解析到服务器，并允许公网访问 80/443。80/443 已被占用时选择已有反代模式，不停止或修改服务器上的其他服务。Caddy 自动申请及续期证书，证书存放在独立数据卷中；健康检查通过不代表公网域名及证书已经就绪，安装后运行 `doctor` 验证真实 HTTPS 入口。

## 安装

需要本机 Docker Engine / Docker Desktop、Docker Compose v2.20+、POSIX Shell、tar / gzip，以及 `sha256sum` 或 `shasum`。`doctor` 检查公网入口还需要 curl。普通部署无需 Bun、Node.js、Git、编译工具或自行安装数据库。部署脚本在 Linux、macOS 的 Docker 上执行；Windows 使用 WSL2。

### 方式一：一行命令安装

国内镜像：

```sh
curl -fsSL https://gitee.com/tingxi8087/minmd/raw/main/install.sh | sh -s -- --image-source china
```

下载当前源码的通用入口后，也可用 `sh install.sh --image-source china` 选择国内包；显式指定版本使用 `--version v0.1.0`。Gitee 源码入口通过 `--image-source china` 选择国内链路；Release 附件 `install-china.sh` 已默认选择 china，官方入口默认选择 official。国内安装的最新版本查询、部署包和校验文件均访问 Gitee，不回退 GitHub。已有部署目录不允许用重复安装跨源改写配置。

官方镜像：

```sh
curl -fsSL https://github.com/tingxi8087/minmd/releases/latest/download/install.sh | sh
# 或使用 wget
wget -qO- https://github.com/tingxi8087/minmd/releases/latest/download/install.sh | sh
```

默认下载最新稳定版（不自动选择测试版本），校验部署包后保存到当前目录下的 `minmd/`，启动原有安装向导。入口只做环境检查和部署包下载，不安装系统软件。`curl | sh` 的交互向导从控制终端读取输入；无终端的 CI / 自动化须明确传入模式、地址和 `--yes`。

指定部署文件目录和版本，入口选项在 `--` 之前，安装向导参数在其后：

```sh
curl -fsSL https://github.com/tingxi8087/minmd/releases/latest/download/install.sh \
  | sh -s -- --version v0.1.0 --install-dir /opt/minmd

# 无人值守示例，替换 IP；没有终端时必须提供完整安装参数
curl -fsSL https://github.com/tingxi8087/minmd/releases/latest/download/install.sh \
  | sh -s -- --install-dir /opt/minmd -- \
    --mode direct --origin http://192.168.1.10:9811 --yes
```

`--install-dir` 是部署脚本目录，须为尚不存在的目录或已有的 Release 部署目录；安装器的高级 `--dir` 是凭证与部署状态目录，两者用途不同。目录可含空格和中文，不能使用 dotenv 插值 / 转义字符、符号链接或根目录。fork 发布的入口绑定实际发布仓库，official 对应 GitHub、china 对应 Gitee，也可在入口参数中指定 `--repo 用户/仓库`。

重复执行时保留已下载部署文件及凭证，继续原版本安装，不自动覆盖或升级；指定了其他版本则拒绝并提示使用 `./minmd.sh upgrade <版本>`。下载 / 校验失败不会生成目标部署目录；向导失败会保留已经校验的部署包，以便重新执行。安装结束后进入该目录维护，例如 `cd /opt/minmd`。

### 环境检查与失败提示

| 检查           | 缺失或异常时                                                                             |
| -------------- | ---------------------------------------------------------------------------------------- |
| Docker         | 未安装时提示官方安装文档；已安装但不可用时提示启动服务或检查权限，不自动提权或修改用户组 |
| Compose        | 缺失或低于 v2.20 时提示安装 / 更新 Compose 插件                                          |
| 下载工具       | 优先 curl，没有时使用 wget；两者都没有则退出。执行管道命令本身也需要对应工具             |
| 解压与校验     | tar / gzip 必须存在；SHA-256 使用 sha256sum 或 shasum，没有校验工具不会跳过校验          |
| 磁盘及目录     | 空间不足、目录不可写、已有无关目录或并发安装时退出，不覆盖数据                           |
| 网络及版本     | 下载失败、版本不存在、元数据异常或校验不匹配时退出，清理临时文件和下载锁                 |
| 端口及已有资源 | 下载后由现有安装器检查实际端口、容器、网络和数据卷归属，提示调整端口或部署模式           |

以上工具由用户自行安装，补齐后重新执行同一命令即可；不会停止其他服务或自动清库。运行环境支持 Linux / macOS，Windows 使用 WSL2。

### 方式二：Release 部署包安装

从 [GitHub Releases](https://github.com/tingxi8087/minmd/releases) 下载同一版本的部署包和校验文件。以下文件名是示例，使用时替换为实际发布版本；首次发布包含安装资源的 Release 之前，一行命令下载地址也不可用。

国内源从 [Gitee Releases](https://gitee.com/tingxi8087/minmd/releases) 下载带 `-china` 后缀的部署包及校验文件，其他操作相同。官方包与国内包分开发布，不会覆盖对方附件。基础镜像由包内元数据写入部署配置的 `POSTGRES_IMAGE`、`CADDY_IMAGE`；旧配置未填写时，仍使用 `postgres:18`、`caddy:2.11.4-alpine`。这两个字段接受带固定标签的镜像地址，不接受 `latest`；Compose、端口检查、数据库连接检查和附件备份恢复都沿用配置中的镜像，不受 Shell 导出同名变量覆盖。

国内包另外写入 `POSTGRES_IMAGE_FALLBACK=ccr.ccs.tencentyun.com/tingxi8087/minmd-postgres:18` 和 `CADDY_IMAGE_FALLBACK=ccr.ccs.tencentyun.com/tingxi8087/minmd-caddy:2.11.4-alpine`。安装器启动或升级准备镜像时，优先使用主源；主源拉取失败再尝试备用源。成功后将实际地址写回对应 `*_IMAGE`，后续启动、升级、诊断和备份恢复沿用所选源，避免反复切换。`--offline` 不联网，仅在主源缓存缺失时选择已缓存的备用镜像；两者均不可用则退出。备用值留空可禁用，备用标签必须与主源一致，不允许自动跨 PostgreSQL 大版本。

已有安装不会因更新安装包而改写镜像地址；原腾讯云配置仍可继续使用。使用新版维护脚本后，需要切换的实例可在维护前编辑原 `.minmd/.env` 的上述四个字段，然后执行 `./minmd.sh restart`；不要修改数据库密码、安装标识或数据卷。底层 `docker compose` 和备份恢复脚本沿用已选地址，不自行选源。DaoCloud 的服务规则及支持镜像见 [官方项目](https://github.com/DaoCloud/public-image-mirror)。

先校验再解压，SHA 文件使用对应归档的真实名称：

```sh
sha256sum -c minmd-v0.1.0.tar.gz.sha256
# macOS 可以使用 shasum -a 256 -c minmd-v0.1.0.tar.gz.sha256

tar xzf minmd-v0.1.0.tar.gz
cd minmd
./minmd.sh install
```

安装器提供「已有反代 / 自动 HTTPS / IP 直连」三个选项，并询问最终访问地址；已有反代模式另询问应用端口，IP 直连自动从地址中读取端口（不写端口表示 HTTP 默认 80）。镜像仓库和固定版本由部署包自动填写。数据库密码、后台管理员初始密码及 API 密钥加密配置分别随机生成，保存在默认 `.minmd/.env`，文件权限为 600。首次成功安装会输出后台初始账号和密码；中断后继续安装可以在此文件的 `ADMIN_PASSWORD` 字段查找原初始密码。后台修改密码后，此初始化配置不再覆盖现有密码。

前台沿用现有网页初始化：创建前台账号、默认空间和引导文档，不需要部署者初始化码。后台管理员与前台账号是两套独立身份。

非交互安装示例：

```sh
./minmd.sh install --mode proxy --origin https://docs.example.com --port 9811 --yes
# 或者
./minmd.sh install --mode https --origin https://docs.example.com --yes
```

源码构建与本地自测见 [开发指南](../docs/DEVELOPMENT.md#源码构建部署)。正式安装建议使用上述两种方式。

### 无域名：IP 直连

选择第三项，填写 `http://服务器IPv4:9811`。安装器默认绑定所有 IPv4 网卡，必须在服务器防火墙及云安全组放行相同 TCP 端口。数据库不对外开放，不会启动 Caddy，也不会默认占用 80/443。来源中的端口与 `--port` 必须一致；需要其他端口时直接修改地址，例如 `http://192.168.1.10:19811`。

```sh
# 正式部署包（普通部署不需要 --build）
./minmd.sh install --mode direct --origin http://192.168.1.10:9811 --yes
```

当前仅支持完整 IPv4 地址，不接受域名、IPv6、监听通配地址 `0.0.0.0` 作为访问地址。`--bind-host` 可限定监听网卡；访问地址需要使用用户实际可达的服务器 IP。IP 直连不能设置 `--trust-proxy`，也不信任伪造的转发头。首次选择后沿用原安装配置，不能用重复 `install` 静默切换模式或地址。

直连 Compose 为应用和迁移服务设置 `HTTP_IP_DIRECT=true`，应用仍运行在 `APP_ENV=production`，不会开启开发调试功能。此模式关闭 Secure Cookie、HSTS 和 HTTPS 自动升级；其余认证、文件权限及 CSRF 校验照常执行。HTTP 下复制使用浏览器兼容路径，正文菜单自动读取剪贴板不可用时请按 Command / Ctrl + V。

HTTP 不加密账号密码、文档和密钥的传输，适合内网或临时体验，公网长期使用建议 HTTPS。日常 `status`、`doctor`、`backup`、`upgrade`、`restore` 与其他模式相同；恢复备份保留目标实例的访问模式与地址。

### 安装目录与预检

`--dir` 指定凭证、部署状态和备份的保存目录；所有后续命令使用同一个目录。数据库、附件、Caddy 证书保存在 Docker 卷中，而不是该目录。每个安装目录默认生成一个稳定且独立的 Compose 项目名，也可在首次安装用 `--project` 指定。

安装器检查 Docker 可用性及 Compose 版本、目录可写性和可用空间、实际端口绑定、同名容器 / 网络 / 数据卷归属，以及已有数据库的真实 TCP 密码认证。网络由 Docker 自动分配；可信代理地址根据本项目网关或 Caddy 的实际地址生成。存在固定网段的旧手动部署不会被安装器接管。

同一安装重复运行 `install` 沿用配置及凭证，可继续之前中断的步骤；传入不一致的安装参数会被拒绝。同名外部实例或旧数据卷、错误数据库密码、加密密钥改动都不会触发清库或重新初始化。脚本使用目录锁和本机项目锁避免并发维护；进程被强制终止后，确认无维护进程再清理提示中的锁目录。

不直接编辑生成的实例名、数据库名、镜像版本、安装标识和加密密钥；版本切换使用 `upgrade`，跨机器恢复先新建独立实例再 `restore`。配置目录支持空格和中文，但不能含 dotenv 插值 / 转义字符。配置及凭证不可提交 Git。重复安装不会覆盖 `.env`。

`proxy` 模式下，反代运行在另一容器中时，不能直接使用该容器内的 `127.0.0.1:9811`。需要自行配置可达的宿主地址或共享网络。高级参数 `--bind-host` 可设置宿主绑定 IPv4 地址，`--trust-proxy` 只填写实际代理 IP/CIDR；开放绑定地址前需通过服务器网络规则限制来源，不能信任任意 IP。

### 已有反代配置示例

应用端口可自行修改，以下示例使用 9811。放入已经配置 TLS 证书的 Nginx server：

```nginx
location / {
  proxy_pass http://127.0.0.1:9811;
  proxy_http_version 1.1;
  proxy_set_header Host $http_host;
  proxy_set_header X-Forwarded-For $remote_addr;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_read_timeout 3600s;
  proxy_buffering off;
  proxy_request_buffering off;
  access_log off;
  client_max_body_size 201m;
}
```

前后台必须保持同源。独立文件上传上限 200 MiB，代理允许至少 201 MiB；文档内图片仍为 1 MiB。协作需要 WebSocket，MCP 使用流式 HTTP，代理不能缓存流式响应。不要在代理日志中记录完整查询字符串、分享令牌、Authorization、Cookie 或正文。

## 统一维护命令

在部署包或源码目录执行。使用自定义 `--dir` 时，在每条命令后加同一参数：

| 命令                            | 行为                                                        |
| ------------------------------- | ----------------------------------------------------------- |
| `./minmd.sh start`              | 检查配置，启动数据库 / 可选 Caddy，执行幂等迁移，再启动 app |
| `./minmd.sh stop`               | 正常停止服务，保留所有数据卷                                |
| `./minmd.sh restart`            | 正常停止并重启 app，数据库和证书保留                        |
| `./minmd.sh status`             | 显示模式、版本、访问地址、配置位置和容器状态，不显示凭证    |
| `./minmd.sh logs`               | 最近 100 条应用日志                                         |
| `./minmd.sh logs postgres`      | 数据库日志；自动 HTTPS 模式也可选择 `caddy`                 |
| `./minmd.sh logs --follow`      | 持续跟踪日志，Ctrl+C 退出                                   |
| `./minmd.sh doctor`             | 检查配置、实例归属、数据库认证、应用健康及实际访问入口      |
| `./minmd.sh backup`             | 停止 app 后一致备份数据库、附件和部署配置，完成后恢复 app   |
| `./minmd.sh upgrade v0.2.0`     | 拉取固定版本、备份、停止写入、迁移并启动                    |
| `./minmd.sh restore /路径/备份` | 确认后恢复数据库 / 附件及匹配的应用版本，保持 app 停止      |

`--offline` 使用已加载的镜像，不访问镜像仓库。离线升级前需同时加载指定版本的 `前缀-app:版本` 和 `前缀-migrate:版本`，以及 PostgreSQL / 可选 Caddy 镜像。发布使用固定版本，不使用 `latest`。

### 升级与失败恢复

升级前通知编辑者保存并等待服务器确认。拉取目标版本失败不会停止旧应用；拉取成功后执行一致备份，备份完成后 app 不重新开放写入，直接进入迁移。

迁移或启动失败时，应用保持停止，`.maintenance` 保存目标版本和升级前备份位置。普通 `start` / `restart` / `install` 会拒绝跳过此状态；修复原因后重试相同的 `upgrade <版本>`，复用已有备份。也可以执行 `restore <升级前备份>`。不要通过删除状态文件、清库或换回旧镜像来跳过迁移失败。

应用 SIGTERM 会关闭协作房间并等待持久化；异常退出不能视为一致备份成功。停止期间协作连接会断开，重新启动后客户端需要重连。本版只有一个 app 实例，不支持滚动升级或 `--scale app=2`。

### 备份和恢复

```sh
./minmd.sh backup /安全位置/minmd-backup-001
./minmd.sh restore /安全位置/minmd-backup-001
# 自动化显式同意替换数据：restore 后追加 --yes
./minmd.sh start
```

目标备份目录必须不存在。备份含数据库、私有附件、SHA-256 清单和权限 600 的 `deployment.env`。**备份包含密码、API 密钥加密配置、正文、用户资料和会话数据，应加密保存并复制到独立存储。** 配置目录默认权限由 umask 077 限制，不把备份放进公开静态目录。

恢复先校验清单及所需镜像，再停止应用和替换数据。它保留目标安装的项目名、网络、访问地址及数据库连接密码，从备份恢复应用版本和原 API 密钥加密配置。完成后 app 保持停止；手动 `start` 后核对当前文档与表格、历史版本、图片和原文件下载，再开放访问。部分恢复失败同样保留维护状态，不直接启动。

每文件最多保留 100 个历史版本，当前内容单独保存。当前内容和保留版本引用的附件保留，未引用附件经过宽限期清理。数据库和附件必须来自同一次备份。

旧脚本产生的备份没有 `deployment.env` 时，需要用相匹配版本的代码、镜像、原加密密钥和人工核实的目标配置，执行底层 `deploy/scripts/restore.sh <环境文件> <备份目录> --replace-data`；不要伪造新版部署元数据。

## 已有手动部署

安装器不会覆盖或自动接管旧部署。先使用原版本备份脚本和 Compose 完成备份，并单独保留原部署配置及加密密钥，再调整部署文件。

当前手动 Compose 需要明确组合基础文件和模式文件：

```sh
docker compose --env-file deploy/.env.production \
  -f deploy/compose.production.yaml -f deploy/compose.proxy.yaml config --quiet
# 自动 HTTPS 则改用 compose.https.yaml；IP 直连用 compose.direct.yaml，并填写 HTTP IPv4 来源及外部绑定地址
```

手动部署使用 `.env.production.example`，自行配置可信代理；安装器配置中的 `MINMD_MANAGED`、安装标识和状态文件由安装器维护，不应手工编造。底层备份恢复脚本会按环境文件的 `MINMD_DEPLOY_MODE` 选择相应文件，省略时为 proxy。

从旧 `web/app` 拓扑切换时，先正常停止旧 app 并确认退出，再用旧 Compose 执行 `down --remove-orphans`，不加 `-v`；保留项目名及数据库、附件数据卷。新配置移除 `web` 和固定代理网段，`WEB_BIND_PORT` 改为 `APP_BIND_PORT`，外层反代直接连 app。不要用新安装器生成的随机凭证套用已有数据卷。

## 维护者发布

Docker 的运行镜像显式使用 Bun 的 hoisted 依赖布局，并在构建阶段从根目录和系统工作区检查数据库依赖；检查保留软链接路径，避免打包产物依赖宿主内核的软链接解析行为。前端构建依赖保持 workspace 隔离，避免前后台不同版本的构建工具互相影响。

默认使用[本机一键发布](../docs/RELEASING.md)：`bun run release v版本`。前后台和后端只构建一次，Linux amd64、arm64 共用静态产物，应用及迁移镜像从本机直接推送 GHCR 和腾讯云；验收通过、附件齐全且匿名双架构清单可访问后才正式发布 Release。`bun run release --verify-only` 可执行相同构建和容器验收而不发布。

发布相关 Actions 均为手动备用，不再随标签自动构建或自动国内同步。手动 Release 工作流调用同一本机入口；China images 用于按需从 GHCR 修复国内副本；Published installation 用于公开发布后的真实安装验收。登录、权限、失败重试和产物说明见[发布指南](../docs/RELEASING.md)。演示 Pages 的自动更新保持独立。

国内源仍只需两个公有仓库：`minmd-app`、`minmd-migrate`。现有 `minmd-postgres`、`minmd-caddy` 公有副本保留用于备用，不随每次应用发布同步。

基础镜像备用副本仅在明确更新基础镜像版本时手动维护。fork 或更换命名空间时，若需要备用能力，需先创建对应公有仓库并完成以下同步；未准备备用仓库时应将包内备用地址留空。修改基础镜像版本后，包元数据、Compose 缺省值及测试应保持一致。

```sh
# 先登录目标腾讯云镜像仓库；需安装 skopeo 和 Docker Buildx
sh deploy/scripts/mirror-images.sh tingxi8087/minmd v0.1.0 tingxi8087 postgres
sh deploy/scripts/mirror-images.sh tingxi8087/minmd v0.1.0 tingxi8087 caddy
```

个人版采用共享服务，首次从海外同步镜像可能较慢，按仓库串行复制以降低推拉并发。每个应用版本含合并清单和两个架构标签，会占用三个版本名；配额以腾讯云控制台为准。腾讯云不兼容的 OCI 附加证明不会进入国内副本，国内副本的清单摘要可与 GHCR 不同，镜像层内容由复制工具校验。

发布资源包括 `minmd-v版本.tar.gz`、对应 `.sha256`、`install.sh` 和 `release.env`。入口通过最新稳定 Release 的 `release.env` 读取版本后，使用固定版本地址下载部署包；不执行网络下载的环境文件。带后缀的版本发布为 prerelease，不占用 latest。发布包脚本会将实际仓库写入入口，fork 不会默认下载上游。

本地可检查打包（输出到 `dist/` 或其他独立目录，不能覆盖源码入口）：

```sh
sh deploy/scripts/package-release.sh ghcr.io/owner/minmd v0.1.0 dist/minmd-v0.1.0.tar.gz owner/minmd
```

依赖 Caddy 的自动 HTTPS 和流式反代行为见 [自动 HTTPS](https://caddyserver.com/docs/automatic-https)、[reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)。实际公网证书签发需在目标域名环境验收。

本地完整部署验收需 Bun、Node.js 22 和 Docker，并提前构建 app / migrate 测试镜像：

```sh
DEPLOY_RUNTIME_TEST=true \
DEPLOY_APP_IMAGE=minmd-app:local DEPLOY_MIGRATE_IMAGE=minmd-migrate:local \
bun test tests/deploy-runtime.test.ts
```

测试创建专用实例并清理自己的容器、数据卷和别名镜像；自动 HTTPS 验收使用测试 CA，正常验证证书和域名，不安装系统根证书、不关闭 TLS 校验。需要本机 80/443 空闲；不会停止占用端口的其他服务。验证基础镜像缓存回退可额外设置 `DEPLOY_RUNTIME_IMAGE_FALLBACK=true`，三种模式会用独立镜像别名模拟主源缺失并实际使用备用镜像。排查 TLS 时可额外设置 `DEPLOY_RUNTIME_TLS_ONLY=true` 只运行该部分，不能将其视为完整部署验收。
