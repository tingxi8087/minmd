# 本机一键发布

维护者在本机编译一次前台、后台和后端，随后构建 Linux amd64、arm64 两种架构的应用与迁移镜像。同一份本地镜像直接推送 GHCR 和腾讯云，不从 GHCR 再下载转传。用户安装方式保持不变。

## 首次准备

需要 Git、Bun 1.3.13、Node.js 22 或更新版本、Docker（包含 Compose 和 Buildx）及 GitHub CLI `gh`。macOS 使用 Docker Desktop；Linux 构建非本机架构需要预先配置 QEMU/binfmt。命令会检查当前 builder 同时支持 `linux/amd64` 和 `linux/arm64`。

完整验收需要本机 80、443 端口空闲，并能拉取 `postgres:18`、`caddy:2.11.4-alpine`、`registry:2`。不会停止占用端口的已有服务。首次构建需要下载依赖，后续复用本地 BuildKit 缓存；不要在每次发布前清空构建缓存。

先完成登录，密码或 token 只交给登录命令，不写入项目文件：

```sh
gh auth login
docker login ghcr.io -u tingxi8087
docker login ccr.ccs.tencentyun.com -u 你的腾讯云账号ID
```

GHCR 登录使用具有 `write:packages` 权限的 token；`gh` 账号需有仓库及 Release 写权限。首次发布还需将 GHCR 的 `minmd-app`、`minmd-migrate` 两个包，以及腾讯云 `tingxi8087/minmd-app`、`tingxi8087/minmd-migrate` 两个仓库设为公开。脚本在正式发布前使用空 Docker 配置检查匿名访问。

当前入口绑定 `tingxi8087/minmd` 与腾讯云命名空间 `tingxi8087`；fork 维护者需调整 `scripts/release.ts` 中的仓库、镜像前缀和镜像 source 标签。`postgres`、`caddy` 备用副本不随应用发布重复推送，国内包继续优先使用 DaoCloud。

## 发布新版本

先更新根目录 `package.json` 的版本，提交所有待发布修改并推送 GitHub。版本必须匹配，工作区必须干净，不能覆盖已正式发布的版本。示例中的版本号请换成下一个版本：

```sh
bun run release v0.1.4
```

不传版本时使用根 `package.json` 的版本。命令依次执行：

1. 检查工具、双架构 builder、干净工作区、GHCR 与腾讯云的 Docker 登录记录、GitHub 上的源码提交、同名标签与既有 Release。登录记录检查不代表 token 尚未过期或具有推送权限，最终由仓库验证。
2. 从当前源码创建排除开发 `.env`、运行数据和被忽略文件的临时快照，隔离项目环境配置；安装锁定依赖，运行 `bun run check`；仅执行一次 `bun run build`，生成前台、后台、后端和许可文件。
3. 用预构建产物生成两种架构的 app、migrate 镜像并加载到本机 Docker。Linux 依赖由本机 Bun 使用 `--os linux --cpu x64/arm64 --linker hoisted --ignore-scripts` 分架构准备，再放入镜像；不执行外部架构安装脚本，仍在 Linux 内检查数据库依赖和实际运行；网页不会在模拟器里重复编译。保留 hoisted 运行依赖与数据库依赖检查。
4. 自动创建隔离测试数据库，执行集成、表格协作、进程生命周期测试；分别验证两种架构迁移两次、后端健康检查、前后台页面与本机产物一致；通过本地临时 Registry 验证四个镜像直接推送、Docker v2 格式和双架构合并；再用本机原生架构运行三种部署模式、TLS、协作、升级、迁移失败和备份恢复的真实部署测试。
5. 生成官方和国内共 8 个附件，创建或复用绑定同一提交的 Release 草稿；将本机四个镜像分别推到 GHCR、腾讯云，再各自合并双架构清单。
6. 匿名检查两个仓库的 app、migrate 双架构清单，上传全部附件，推送指向本次提交的版本标签，最后将草稿正式发布。稳定版本更新 Latest，预发布版本标记为 prerelease。

腾讯云使用 Docker v2 镜像格式；通过 Docker 的单架构加载/推送流程及无证明附件的合并清单兼容个人版仓库。两个仓库接收相同本地镜像，不重复编译。

产物在 `dist/release/v版本/`，包括官方包和国内包、两个 `.sha256`、`install.sh`、`install-china.sh`、`release.env`、`release-china.env`。测试创建的容器、网络和数据库在结束时清理；镜像和构建缓存保留以供复查与下次复用，不操作开发数据库。

## 只验收、不发布

```sh
bun run release --verify-only
```

同样执行一次构建、双架构镜像生成、完整验收和部署包生成。允许未提交的修改；不检查远端发布权限，不推送镜像、Git 标签或创建 Release。适合提交发布脚本之前验证，也适合首次配置工具链。

验收属于本机构建和真实容器运行验证；公开 Release 的下载和全新安装可在发布后手动运行 `Published installation` 工作流，分别选择 official、china。匿名清单检查不能代替完整的公开安装验收。

## 失败与重试

- 测试或构建失败立即停止，尚未执行远端发布。
- 镜像推送、清单合并、公开检查和附件上传最多重试 3 次，单次网络命令有超时；持续失败时退出，正式 Release 和 Latest 不更新。
- 失败可能留下草稿及部分同版本镜像。修复网络、登录或可见性后，**保持同一源码提交**重跑同一命令；已有本地构建缓存可复用。源码改变后使用新版本，或先人工核实并清理旧草稿。
- 已正式发布的版本禁止覆盖。脚本不执行清空缓存、删除远端镜像或撤回 Release。
- 本地 `.cache/release.lock` 防止同时发布和验收。正常退出会释放；强制结束或断电后，先确认没有发布进程，再删除该目录。

## GitHub Actions 手动备用

发布相关 Actions 不再跟随标签或其他工作流自动启动；演示网站的 Pages 自动更新继续独立运行。

- **Release**：手动选择包含待发布代码的分支、填写匹配版本。执行与本机完全相同的命令，同时推送两个仓库。需要 `TCR_USERNAME`、`TCR_PASSWORD` Secrets；`GITHUB_TOKEN` 需有 contents、packages 写权限。
- **China images**：修复已发布版本的国内副本时手动使用。需要变量 `TCR_NAMESPACE` 与上述 Secrets；从 GHCR 固定摘要复制双架构镜像并追加国内附件。这是备用修复流程，本机正常发布不经过它。
- **Published installation**：手动从公开 Release 下载并真实安装，验证首次初始化。也可由手动国内修复流程调用。

备用基础镜像仍可按需执行 `deploy/scripts/mirror-images.sh`；具体操作见 [部署与维护](../deploy/README.md#维护者发布)。
