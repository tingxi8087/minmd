#!/bin/sh
# 公开安装入口：只检查环境、下载并校验 Release，再调用同一套 minmd.sh 安装向导。
set -eu
umask 077
# 先完整解析入口函数，防止管道下载中断时执行半份脚本。
main() {
MINMD_DEFAULT_REPOSITORY=tingxi8087/minmd
MINMD_DEFAULT_IMAGE_SOURCE=official
MINMD_REPOSITORY=$MINMD_DEFAULT_REPOSITORY
MINMD_IMAGE_SOURCE=$MINMD_DEFAULT_IMAGE_SOURCE
MINMD_VERSION=latest
MINMD_INSTALL_DIR="$PWD/minmd"
MINMD_STAGE= MINMD_LOCK=
fail() { printf '错误：%s\n' "$*" >&2; exit 1; }
usage() {
  cat <<'HELP'
用法：sh install.sh [入口选项] [-- 安装向导选项]
  --repo <用户/仓库>       当前下载平台的仓库，默认当前发布仓库
  --version <版本>         默认 latest（最新稳定版），也可指定 v0.1.0
  --image-source <源>      official：官方镜像；china：腾讯云国内镜像及国内部署包
  --install-dir <目录>     部署文件目录，默认当前目录下的 minmd
  --help                  显示帮助，不检查或安装环境
安装向导选项放在 -- 后，例如：
  sh install.sh --install-dir /opt/minmd -- --mode direct --origin http://192.168.1.10:9811 --yes
缺少 Docker / Compose / 下载 / 解压 / 校验工具时只提示并退出，不自动安装系统软件。
HELP
}
while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo|--version|--install-dir|--image-source)
      [ "$#" -ge 2 ] && [ -n "$2" ] || fail "$1 缺少参数"
      case "$2" in *'
'*) fail '参数不能包含换行' ;; esac
      case "$1" in --repo) MINMD_REPOSITORY=$2 ;; --version) MINMD_VERSION=$2 ;; --install-dir) MINMD_INSTALL_DIR=$2 ;; --image-source) MINMD_IMAGE_SOURCE=$2 ;; esac
      shift 2 ;;
    --help|-h) usage; exit 0 ;;
    --) shift; break ;;
    *) fail "未知入口选项：$1；安装向导选项请放在 -- 后" ;;
  esac
done
case "$MINMD_IMAGE_SOURCE" in official) MINMD_SUFFIX=; MINMD_META=release.env ;; china) MINMD_SUFFIX=-china; MINMD_META=release-china.env ;; *) fail '--image-source 只能是 official 或 china' ;; esac
valid_version() {
  case "$1" in *'
'*) return 1 ;; esac
  printf '%s\n' "$1" | LC_ALL=C grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+([.-][A-Za-z0-9.-]+)?$'
}
# POSIX 工具也显式检查，避免下载或创建文件后才因缺工具失败。
for minmd_tool in sh cat uname awk grep sed tr tar gzip mktemp mkdir mv rm rmdir chmod df dirname; do
  command -v "$minmd_tool" >/dev/null 2>&1 || fail "缺少工具 ${minmd_tool}，请安装后重新执行；Linux 通常由系统基础工具包提供，Windows 请使用 WSL2"
done
case "$(uname -s)" in Linux|Darwin) ;; *) fail '此安装入口支持 Linux / macOS；Windows 请在 WSL2 内执行' ;; esac
printf '%s\n' "$MINMD_REPOSITORY" | LC_ALL=C grep -Eq '^[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*$' || fail '--repo 格式应为用户/仓库'
[ "$MINMD_VERSION" = latest ] || valid_version "$MINMD_VERSION" || fail '--version 应为 latest 或固定版本，例如 v0.1.0'
if command -v curl >/dev/null 2>&1; then MINMD_DOWNLOADER=curl
elif command -v wget >/dev/null 2>&1; then MINMD_DOWNLOADER=wget
else fail '缺少 curl 或 wget，请安装其中一个后重新执行（例如 Ubuntu/Debian：sudo apt install curl）'; fi
if command -v sha256sum >/dev/null 2>&1; then MINMD_CHECKSUM=sha256sum
elif command -v shasum >/dev/null 2>&1; then MINMD_CHECKSUM=shasum
else fail '缺少 sha256sum 或 shasum，请安装校验工具后重新执行（Linux：coreutils；macOS：shasum）'; fi
command -v docker >/dev/null 2>&1 || fail '未安装 Docker，请先安装 Docker Engine（Linux）或 Docker Desktop（macOS），完成后重试；不会自动修改系统环境。官方指南：https://docs.docker.com/get-started/get-docker/'
docker info >/dev/null 2>&1 || fail 'Docker 不可用：请启动 Docker，并检查当前用户是否有访问 Docker 的权限；不会自动提权或修改用户组'
minmd_compose_version=$(docker compose version --short 2>/dev/null) || fail '缺少 Docker Compose v2，请安装 Docker Compose 插件 v2.20+ 后重试'
printf '%s\n' "$minmd_compose_version" | awk -F. '{gsub(/^v/,"",$1);exit !(($1+0)>2 || (($1+0)==2 && ($2+0)>=20))}' || fail 'Docker Compose 版本过旧，需要 v2.20 或更新版本'
# curl | sh 的标准输入承载脚本；交互时重新连接控制终端，不能把脚本内容当作回答。
MINMD_USE_TTY=false
if [ -t 0 ]; then MINMD_USE_TTY=stdin
elif ( : < /dev/tty ) 2>/dev/null; then MINMD_USE_TTY=device
else
  minmd_yes=false
  for minmd_argument in "$@"; do [ "$minmd_argument" != --yes ] || minmd_yes=true; done
  [ "$minmd_yes" = true ] || fail '没有交互终端：请在 -- 后提供 --mode、--origin 和 --yes；例如 -- --mode direct --origin http://192.168.1.10:9811 --yes'
fi
MINMD_INSTALL_DIR=$(printf '%s' "$MINMD_INSTALL_DIR" | sed 's,/*$,,')
[ -n "$MINMD_INSTALL_DIR" ] || fail '安装目录不能是根目录'
case "$MINMD_INSTALL_DIR" in /*) ;; *) MINMD_INSTALL_DIR="$PWD/$MINMD_INSTALL_DIR" ;; esac
case "$MINMD_INSTALL_DIR" in *'
'*|*'$'*|*'#'*|*'\'*|*'`'*|*'"'*|*"'"*) fail '安装目录不能包含换行或 dotenv 插值 / 转义字符' ;; esac
[ ! -L "$MINMD_INSTALL_DIR" ] || fail '安装目录不能是符号链接'
minmd_parent=$(dirname "$MINMD_INSTALL_DIR")
mkdir -p "$minmd_parent" || fail '安装目录不可创建，请选择有写入权限的 --install-dir'
minmd_parent=$(CDPATH= cd -- "$minmd_parent" && pwd -P)
minmd_name=${MINMD_INSTALL_DIR##*/}
case "$minmd_name" in ''|.|..) fail '请指定独立的安装目录，不能使用根目录、. 或 ..' ;; esac
MINMD_INSTALL_DIR="$minmd_parent/$minmd_name"
[ -w "$minmd_parent" ] || fail '安装目录上级不可写，请选择有写入权限的 --install-dir'
minmd_free=$(df -Pk "$minmd_parent" | awk 'END{print $4}')
case "$minmd_free" in ''|*[!0-9]*) fail '无法检查可用磁盘空间' ;; esac
[ "$minmd_free" -ge 102400 ] || fail '可用磁盘空间不足 100 MiB；请释放空间后重试'
cleanup() {
  minmd_status=$?
  trap - 0
  [ -z "$MINMD_STAGE" ] || rm -rf "$MINMD_STAGE"
  [ -z "$MINMD_LOCK" ] || rmdir "$MINMD_LOCK" 2>/dev/null || :
  exit "$minmd_status"
}
trap cleanup 0
trap 'exit 130' INT
trap 'exit 143' TERM
MINMD_LOCK="$MINMD_INSTALL_DIR.bootstrap-lock"
if ! mkdir "$MINMD_LOCK" 2>/dev/null; then MINMD_LOCK=; fail '此目录有下载 / 安装任务正在执行；如上次任务被强制终止，确认无任务后再清理对应 .bootstrap-lock 目录'; fi
run_installer() {
  printf '部署目录：%s\n' "$MINMD_INSTALL_DIR"
  if [ "$MINMD_USE_TTY" = device ]; then
    sh "$MINMD_INSTALL_DIR/minmd.sh" install "$@" < /dev/tty
  else
    sh "$MINMD_INSTALL_DIR/minmd.sh" install "$@"
  fi
}
if [ -e "$MINMD_INSTALL_DIR" ]; then
  [ -d "$MINMD_INSTALL_DIR" ] && [ ! -L "$MINMD_INSTALL_DIR/minmd.sh" ] && [ -f "$MINMD_INSTALL_DIR/minmd.sh" ] && [ -f "$MINMD_INSTALL_DIR/deploy/release.env" ] || fail '目标目录已存在且不是 Release 部署目录；不会覆盖，请选择空闲的 --install-dir'
  minmd_installed=$(awk 'index($0,"MINMD_IMAGE_TAG=")==1 {print substr($0,17);exit}' "$MINMD_INSTALL_DIR/deploy/release.env")
  minmd_installed_source=$(awk 'index($0,"MINMD_IMAGE_SOURCE=")==1 {print substr($0,20);exit}' "$MINMD_INSTALL_DIR/deploy/release.env")
  [ "${minmd_installed_source:-official}" = "$MINMD_IMAGE_SOURCE" ] || fail '目标目录已有另一镜像源的部署；不会通过重复安装改写配置，请使用原安装入口或选择新的 --install-dir'
  valid_version "$minmd_installed" || fail '已有部署的版本信息损坏，不会覆盖；请检查原部署文件'
  [ "$MINMD_VERSION" = latest ] || [ "$MINMD_VERSION" = "$minmd_installed" ] || fail '目标目录已是其他版本；一行安装不会自动升级，请使用目录中的 ./minmd.sh upgrade <版本>'
  printf '沿用已有部署文件及凭证（%s），不重新下载或自动升级。\n' "$minmd_installed"
  run_installer "$@"
  exit 0
fi
MINMD_STAGE=$(mktemp -d "$minmd_parent/.minmd-download.XXXXXX") || fail '无法创建临时下载目录'
download() {
  if [ "$MINMD_DOWNLOADER" = curl ]; then
    curl --fail --location --silent --show-error --retry 2 --connect-timeout 15 --max-time 300 --proto '=https' --proto-redir '=https' --output "$2" "$1" || fail '下载失败：请检查网络、下载源访问、仓库及版本是否已正式发布；安装目录未写入'
  else
    wget --https-only --timeout=30 --tries=3 --max-redirect=10 -q -O "$2" "$1" || fail '下载失败：请检查网络、下载源访问、仓库及版本是否已正式发布；安装目录未写入'
  fi
  [ -s "$2" ] || fail '下载结果为空，未继续安装'
}
MINMD_RELEASE_URL="https://github.com/$MINMD_REPOSITORY/releases"
if [ "$MINMD_IMAGE_SOURCE" = china ]; then MINMD_RELEASE_URL="https://gitee.com/$MINMD_REPOSITORY/releases"; fi
if [ "$MINMD_VERSION" = latest ]; then
  if [ "$MINMD_IMAGE_SOURCE" = china ]; then
    # Gitee 没有 GitHub 的 latest/download 路由；公开 API 只用于解析固定版本。
    download "https://gitee.com/api/v5/repos/$MINMD_REPOSITORY/releases/latest" "$MINMD_STAGE/latest.json"
    tr ',' '\n' < "$MINMD_STAGE/latest.json" > "$MINMD_STAGE/latest.fields"
    MINMD_VERSION=$(sed -n 's/^[[:space:]{]*"tag_name"[[:space:]]*:[[:space:]]*"\(v[0-9][A-Za-z0-9.-]*\)"[[:space:]}]*$/\1/p' "$MINMD_STAGE/latest.fields" | awk 'NF{count++;value=$0} END{if(count!=1)exit 1;print value}') || fail 'Gitee Release 版本元数据无效或重复'
    minmd_preview=$(sed -n 's/^[[:space:]{]*"prerelease"[[:space:]]*:[[:space:]]*\([a-z][a-z]*\)[[:space:]}]*$/\1/p' "$MINMD_STAGE/latest.fields" | awk 'NF{count++;value=$0} END{if(count!=1)exit 1;print value}') || fail 'Gitee Release 发布状态无效'
    [ "$minmd_preview" = false ] || fail 'Gitee 最新版本尚未完成正式发布，请稍后重试或指定已发布版本'
  else
    download "$MINMD_RELEASE_URL/latest/download/$MINMD_META" "$MINMD_STAGE/release.env"
    # 不 source 网络文件，也不依赖 jq、Node、Bun 或 Git。
    MINMD_VERSION=$(awk 'index($0,"MINMD_IMAGE_TAG=")==1 {count++;value=substr($0,17)} END{if(count!=1)exit 1;print value}' "$MINMD_STAGE/release.env") || fail 'Release 版本元数据无效或重复'
  fi
  valid_version "$MINMD_VERSION" || fail 'Release 没有有效的固定版本信息'
  printf '%s\n' "$MINMD_VERSION" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$' || fail 'latest 必须指向稳定版；测试版请显式指定 --version'
fi
MINMD_ARCHIVE="minmd-$MINMD_VERSION$MINMD_SUFFIX.tar.gz"
printf '下载 %s（%s）…\n' "$MINMD_REPOSITORY" "$MINMD_VERSION"
download "$MINMD_RELEASE_URL/download/$MINMD_VERSION/$MINMD_ARCHIVE" "$MINMD_STAGE/$MINMD_ARCHIVE"
download "$MINMD_RELEASE_URL/download/$MINMD_VERSION/$MINMD_ARCHIVE.sha256" "$MINMD_STAGE/$MINMD_ARCHIVE.sha256"
awk -v expected="$MINMD_ARCHIVE" 'NR!=1 || NF!=2 || length($1)!=64 || $1!~/^[a-fA-F0-9]+$/ || $2!=expected {bad=1} END{exit bad||NR!=1}' "$MINMD_STAGE/$MINMD_ARCHIVE.sha256" || fail '校验文件格式或目标文件名无效'
(cd "$MINMD_STAGE" && if [ "$MINMD_CHECKSUM" = sha256sum ]; then sha256sum -c "$MINMD_ARCHIVE.sha256"; else shasum -a 256 -c "$MINMD_ARCHIVE.sha256"; fi) || fail '部署包 SHA-256 校验失败，未写入安装目录，请重新下载'
# 校验归档边界后才解压，拒绝路径穿越、符号链接和特殊文件。
tar -tzf "$MINMD_STAGE/$MINMD_ARCHIVE" > "$MINMD_STAGE/entries" || fail '部署包不是有效的 tar.gz'
awk '
  !/^minmd(\/[A-Za-z0-9_.-]+)*\/?$/ {bad=1}
  {n=split($0,parts,"/");for(i=1;i<=n;i++)if(parts[i]=="."||parts[i]=="..")bad=1}
  END{exit bad||NR==0}
' "$MINMD_STAGE/entries" || fail '部署包包含不安全路径，未解压'
tar -tvzf "$MINMD_STAGE/$MINMD_ARCHIVE" | awk 'substr($0,1,1)!="-" && substr($0,1,1)!="d" {bad=1} END{exit bad}' || fail '部署包包含链接或特殊文件，未解压'
mkdir "$MINMD_STAGE/extracted"
tar -xzf "$MINMD_STAGE/$MINMD_ARCHIVE" -C "$MINMD_STAGE/extracted" --no-same-owner --no-same-permissions || fail '部署包解压失败，未写入安装目录'
minmd_bundle="$MINMD_STAGE/extracted/minmd"
[ -f "$minmd_bundle/minmd.sh" ] && [ -f "$minmd_bundle/deploy/scripts/manage.sh" ] && [ -f "$minmd_bundle/deploy/release.env" ] || fail '部署包缺少必要文件'
minmd_bundle_version=$(awk 'index($0,"MINMD_IMAGE_TAG=")==1 {print substr($0,17);exit}' "$minmd_bundle/deploy/release.env")
[ "$minmd_bundle_version" = "$MINMD_VERSION" ] || fail '部署包内部版本与请求版本不符，未安装'
minmd_bundle_source=$(awk 'index($0,"MINMD_IMAGE_SOURCE=")==1 {print substr($0,20);exit}' "$minmd_bundle/deploy/release.env")
[ "${minmd_bundle_source:-official}" = "$MINMD_IMAGE_SOURCE" ] || fail '部署包内部镜像源与请求不符，未安装'
chmod +x "$minmd_bundle/minmd.sh"
[ ! -e "$MINMD_INSTALL_DIR" ] && [ ! -L "$MINMD_INSTALL_DIR" ] || fail '安装目录在下载期间被其他程序创建，不会覆盖'
mv "$minmd_bundle" "$MINMD_INSTALL_DIR"
printf '部署包已校验并保存。后续维护请进入该目录执行 ./minmd.sh。\n'
run_installer "$@"
}
main "$@"
