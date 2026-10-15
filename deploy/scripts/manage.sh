#!/bin/sh
set -eu
umask 077
MINMD_DEPLOY_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
MINMD_ROOT=$(dirname "$MINMD_DEPLOY_ROOT")
. "$MINMD_DEPLOY_ROOT/scripts/compose.sh"
fail() { echo "错误：$*" >&2; exit 1; }
note() { printf '%s\n' "$*"; }
usage() {
  cat <<'HELP'
用法：./minmd.sh <命令> [选项]
  install                  首次安装或继续未完成的安装
  start / stop / restart   启动 / 停止 / 重启（保留数据）
  status / doctor          查看状态 / 检查部署
  logs [app|postgres|caddy] [--follow]
  backup [新备份目录]      一致备份数据库、附件及恢复所需配置
  upgrade <版本>           先备份，再迁移并启动；失败可重试同一版本
  restore <备份目录>       确认后恢复匹配版本，应用保持停止

通用选项：
  --dir <目录>             配置和备份目录，默认仓库/部署包内 .minmd
  --offline                使用已加载的本地镜像，不拉取
  --yes                    确认安装摘要 / 恢复替换数据，适合自动化
首次安装选项：
  --mode proxy|https|direct 已有反向代理 / 自动 HTTPS / IP 直连
  --origin <访问地址>      HTTPS 域名；direct 使用 http://IPv4:端口
  --port <1-65535>         proxy 默认 9811；direct 自动读取访问地址端口
  --bind-host <IPv4>       绑定 IPv4；proxy 默认 127.0.0.1，direct 默认 0.0.0.0
  --trust-proxy <IP/CIDR>  高级：可信外部代理地址，逗号分隔
  --project <名称>         高级：独立实例名，默认按配置目录生成
  --image-prefix <仓库>    镜像名前缀，例如 ghcr.io/owner/minmd
  --version <版本>         镜像版本，正式发布包自动填写
  --build                  源码开发者构建镜像，普通部署无需使用
HELP
}
[ "$#" -gt 0 ] || { usage; exit 0; }
COMMAND=$1; shift
case "$COMMAND" in help|-h|--help) usage; exit 0 ;; esac
case "$COMMAND" in install|start|stop|restart|status|doctor|logs|backup|upgrade|restore) ;; *) fail '未知命令，使用 ./minmd.sh help 查看用法' ;; esac
MINMD_DIR="$MINMD_ROOT/.minmd"
MODE_ARG= ORIGIN_ARG= PORT_ARG= BIND_ARG= TRUST_ARG= PROJECT_ARG= PREFIX_ARG= VERSION_ARG= OPERAND=
OFFLINE=false BUILD=false YES=false FOLLOW=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dir|--mode|--origin|--port|--bind-host|--trust-proxy|--project|--image-prefix|--version)
      [ "$#" -ge 2 ] || fail "$1 缺少参数"
      case "$1" in
        --dir) MINMD_DIR=$2 ;; --mode) MODE_ARG=$2 ;; --origin) ORIGIN_ARG=$2 ;;
        --port) PORT_ARG=$2 ;; --bind-host) BIND_ARG=$2 ;; --trust-proxy) TRUST_ARG=$2 ;;
        --project) PROJECT_ARG=$2 ;; --image-prefix) PREFIX_ARG=$2 ;; --version) VERSION_ARG=$2 ;;
      esac; shift 2 ;;
    --offline) OFFLINE=true; shift ;; --build) BUILD=true; shift ;;
    --yes) YES=true; shift ;; --follow|-f) FOLLOW=true; shift ;;
    --help|-h) usage; exit 0 ;;
    --*) fail "未知选项：$1" ;;
    *) [ -z "$OPERAND" ] || fail '只能传入一个命令参数'; OPERAND=$1; shift ;;
  esac
done
[ -n "$MINMD_DIR" ] || fail '配置目录不能为空'
case "$MINMD_DIR" in *'
'*) fail '目录不能包含换行' ;; esac
if [ "$COMMAND" != install ]; then
  [ -z "$MODE_ARG$ORIGIN_ARG$PORT_ARG$BIND_ARG$TRUST_ARG$PROJECT_ARG$PREFIX_ARG$VERSION_ARG" ] || fail '修改安装参数仅适用于首次 install；升级请使用 upgrade <版本>'
  [ "$BUILD" = false ] || fail '--build 仅用于首次 install'
fi
[ "$COMMAND" = logs ] || [ "$FOLLOW" = false ] || fail '--follow 仅适用于 logs'
case "$COMMAND" in
  upgrade|restore) [ -n "$OPERAND" ] || fail "$COMMAND 缺少版本或备份目录" ;;
  backup|logs) ;;
  *) [ -z "$OPERAND" ] || fail "$COMMAND 不接受位置参数" ;;
esac
if [ "$COMMAND" = install ]; then mkdir -p "$MINMD_DIR"; fi
[ -d "$MINMD_DIR" ] || fail '尚未安装，请先执行 install'
MINMD_DIR=$(CDPATH= cd -- "$MINMD_DIR" && pwd -P)
case "$MINMD_DIR" in *'$'*|*'#'*|*'\'*|*'`'*|*'"'*|*"'"*) fail '配置目录不能包含 dotenv 插值或转义字符（美元符、井号、引号和反斜杠）' ;; esac
MINMD_ENV="$MINMD_DIR/.env"
STATE="$MINMD_DIR/.installed"
PENDING="$MINMD_DIR/.maintenance"
DIR_LOCK= PROJECT_LOCK=
cleanup() {
  minmd_exit_status=$?
  trap - 0
  if [ "$minmd_exit_status" -ne 0 ] && [ -n "$DIR_LOCK" ] && [ -f "$PENDING" ]; then
    compose stop app >/dev/null 2>&1 || :
    echo '维护未完成，应用保持停止。请查看日志，重试原操作或恢复备份。' >&2
  fi
  if [ -n "$DIR_LOCK" ]; then rm -f "$MINMD_DIR/.env.candidate" "$MINMD_DIR/.env.candidate.new" "$MINMD_DIR/.env.upgrade" "$MINMD_DIR/.env.upgrade.new"; fi
  [ -z "$PROJECT_LOCK" ] || { rm -f "$PROJECT_LOCK/pid"; rmdir "$PROJECT_LOCK" 2>/dev/null || :; }
  [ -z "$DIR_LOCK" ] || { rm -f "$DIR_LOCK/pid"; rmdir "$DIR_LOCK" 2>/dev/null || :; }
  exit "$minmd_exit_status"
}
trap cleanup 0
trap 'exit 130' INT
trap 'exit 143' TERM
lock_dir() {
  if ! mkdir "$MINMD_DIR/.lock" 2>/dev/null; then fail "此安装目录有维护任务正在执行；如上次进程被强制终止，确认无任务后删除 $MINMD_DIR/.lock"; fi
  DIR_LOCK="$MINMD_DIR/.lock"; printf '%s\n' "$$" > "$DIR_LOCK/pid"
}
lock_project() {
  minmd_lock="${TMPDIR:-/tmp}/minmd-maintenance-$PROJECT.lock"
  if ! mkdir "$minmd_lock" 2>/dev/null; then fail '同名项目有维护任务正在执行，请等待；确认无任务后再清理对应临时锁目录'; fi
  PROJECT_LOCK=$minmd_lock; printf '%s\n' "$$" > "$PROJECT_LOCK/pid"
}
for minmd_reserved in .env.candidate .env.new .env.upgrade .env.upgrade.new .installed .installed.new .maintenance; do
  [ ! -L "$MINMD_DIR/$minmd_reserved" ] || fail '部署状态或临时配置不能是符号链接'
done
case "$COMMAND" in status|doctor|logs) ;; *) lock_dir ;; esac
prerequisites() {
  command -v docker >/dev/null 2>&1 || fail '请先安装 Docker Engine / Docker Desktop 和 Compose v2'
  docker info >/dev/null 2>&1 || fail '无法连接 Docker；请启动 Docker 并检查当前用户权限'
  minmd_compose_version=$(docker compose version --short 2>/dev/null) || fail '请安装 Docker Compose v2.20 或更新版本'
  printf '%s\n' "$minmd_compose_version" | awk -F. '{gsub(/^v/,"",$1);exit !(($1+0)>2 || (($1+0)==2 && ($2+0)>=20))}' || fail '需要 Docker Compose v2.20 或更新版本'
  command -v sha256sum >/dev/null 2>&1 || command -v shasum >/dev/null 2>&1 || fail '需要 sha256sum 或 shasum 校验备份'
  [ -w "$MINMD_DIR" ] || fail '配置目录不可写'
  minmd_free=$(df -Pk "$MINMD_DIR" | awk 'END{print $4}')
  case "$minmd_free" in ''|*[!0-9]*) fail '无法检查安装目录磁盘空间' ;; esac
  [ "$minmd_free" -ge 102400 ] || fail '配置目录可用空间不足 100 MiB；请先释放空间'
}
value() { minmd_value "$1" "$MINMD_ENV"; }
hash_text() {
  if command -v sha256sum >/dev/null 2>&1; then printf '%s' "$1" | sha256sum | awk '{print $1}'; else printf '%s' "$1" | shasum -a 256 | awk '{print $1}'; fi
}
random_hex() { od -An -N32 -tx1 /dev/urandom | tr -d ' \n'; }
valid_tag() { printf '%s\n' "$1" | LC_ALL=C grep -Eq '^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$' && [ "$1" != latest ]; }
valid_prefix() { printf '%s\n' "$1" | LC_ALL=C grep -Eq '^[a-z0-9][a-z0-9./:_-]*[a-z0-9]$|^[a-z0-9]$'; }
valid_image() { printf '%s\n' "$1" | LC_ALL=C grep -Eq '^[a-z0-9][a-z0-9./:_-]*:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$' && [ "${1##*:}" != latest ]; }
valid_port() { case "$1" in ''|*[!0-9]*|0*) return 1 ;; esac; [ "$1" -ge 1 ] && [ "$1" -le 65535 ]; }
valid_ipv4() { printf '%s\n' "$1" | awk -F. 'NF!=4 {exit 1} {for(i=1;i<=4;i++)if($i!~/^[0-9]+$/||length($i)>3||$i+0>255||(length($i)>1&&substr($i,1,1)=="0"))exit 1}'; }
normalize_origin() {
  printf '%s\n' "$1" | LC_ALL=C grep -Eq '^https?://([A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?|\[[0-9a-fA-F:]+\])(:[0-9]+)?/?$' || return 1
  printf '%s' "$1" | tr 'A-Z' 'a-z' | sed 's,/$,,; /^https:/s,:443$,,; /^http:/s,:80$,,'
}
validate_config() {
  [ -f "$MINMD_ENV" ] && [ ! -L "$MINMD_ENV" ] || fail '配置文件缺失或为符号链接，请使用原始安装配置'
  awk '
    /^[[:space:]]*$/ || /^#/ {next}
    !/^[A-Z][A-Z0-9_]*=/ {exit 1}
    {key=substr($0,1,index($0,"=")-1);if(seen[key]++)exit 1;if($0~/[\r]/)exit 1}
  ' "$MINMD_ENV" || fail '配置格式错误：请使用不带引号的 KEY=VALUE，不能有重复键或 CRLF'
  [ "$(value MINMD_MANAGED)" = 1 ] || fail '此文件不是安装器配置；已有手动部署请继续使用原部署流程，不会自动接管或覆盖'
  MODE=$(value MINMD_DEPLOY_MODE); ORIGIN=$(value PUBLIC_ORIGIN); PROJECT=$(value COMPOSE_PROJECT_NAME)
  PREFIX=$(value MINMD_IMAGE_PREFIX); VERSION=$(value MINMD_IMAGE_TAG); INSTALLATION=$(value MINMD_INSTALLATION_ID)
  POSTGRES_IMAGE=$(minmd_postgres_image); CADDY_IMAGE=$(minmd_caddy_image)
  valid_image "$POSTGRES_IMAGE" && valid_image "$CADDY_IMAGE" || fail '基础镜像必须是带固定标签的有效镜像地址，不能使用 latest'
  POSTGRES_IMAGE_FALLBACK=$(value POSTGRES_IMAGE_FALLBACK); CADDY_IMAGE_FALLBACK=$(value CADDY_IMAGE_FALLBACK)
  for minmd_pair in "$POSTGRES_IMAGE|$POSTGRES_IMAGE_FALLBACK" "$CADDY_IMAGE|$CADDY_IMAGE_FALLBACK"; do
    minmd_primary=${minmd_pair%%|*}; minmd_fallback=${minmd_pair#*|}
    [ -z "$minmd_fallback" ] || { valid_image "$minmd_fallback" && [ "${minmd_primary##*:}" = "${minmd_fallback##*:}" ]; } || fail '备用基础镜像必须是有效固定标签，且与主镜像标签一致'
  done
  PORT=$(value APP_BIND_PORT); BIND=$(value APP_BIND_HOST); TRUST=$(value TRUST_PROXY_ADDRESSES)
  case "$(value MINMD_TRUST_AUTOMATIC)" in true|false) ;; *) fail 'MINMD_TRUST_AUTOMATIC 必须为 true 或 false' ;; esac
  case "$TRUST" in *0.0.0.0/0*|*::/0*) fail '不能信任任意来源代理地址' ;; esac
  case "$MODE" in proxy|https|direct) ;; *) fail '部署模式只能是 proxy、https 或 direct' ;; esac
  minmd_normalized=$(normalize_origin "$ORIGIN") || fail '访问地址必须是完整 HTTP/HTTPS 来源，不能带路径、查询或账号'
  [ "$minmd_normalized" = "$ORIGIN" ] || fail '访问地址须使用小写域名、不带末尾斜杠，省略默认 HTTP 80 / HTTPS 443 端口'
  minmd_origin_port=$(printf '%s' "$ORIGIN" | sed -n 's/.*:\([0-9][0-9]*\)$/\1/p')
  [ -z "$minmd_origin_port" ] || valid_port "$minmd_origin_port" || fail '访问地址端口无效'
  printf '%s\n' "$PROJECT" | LC_ALL=C grep -Eq '^[a-z0-9][a-z0-9_-]{1,62}$' || fail '实例名须为 2–63 位小写字母、数字、下划线或连字符'
  printf '%s\n' "$INSTALLATION" | LC_ALL=C grep -Eq '^[a-f0-9]{64}$' || fail '安装标识损坏，请恢复原配置'
  valid_prefix "$PREFIX" || fail '镜像仓库前缀无效'
  valid_tag "$VERSION" || fail '版本无效；请使用固定版本，不能使用 latest'
  valid_port "$PORT" || fail '应用端口必须是 1–65535 的整数'
  valid_ipv4 "$BIND" || fail '绑定地址必须是 IPv4 地址'
  printf '%s\n' "$TRUST" | LC_ALL=C grep -Eq '^[a-fA-F0-9.:/,]*$' || fail '可信代理只接受明确的 IP/CIDR 列表，不能填写主机名或通配符'
  printf '%s\n' "$(value POSTGRES_DB)" | LC_ALL=C grep -Eq '^[a-z][a-z0-9_]{0,62}$' || fail '数据库名称无效'
  for minmd_secret_key in POSTGRES_PASSWORD ADMIN_PASSWORD AI_KEY_ENCRYPTION_KEY; do
    printf '%s\n' "$(value "$minmd_secret_key")" | LC_ALL=C grep -Eq '^[a-f0-9]{64}$' || fail "$minmd_secret_key 必须保留安装器生成的 64 位十六进制值"
  done
  [ "$(value ADMIN_ACCOUNT)" = admin ] || fail '初始后台账号配置应保留 admin；已有账号资料请在后台修改'
  [ "$(value MINMD_INSTALL_DIR)" = "$MINMD_DIR" ] || fail '配置目录与原安装记录不同，请使用原 --dir；跨机器恢复请先新建独立实例再 restore'
  if [ "$MODE" = direct ]; then
    case "$ORIGIN" in http://*) ;; *) fail 'IP 直连需要 http://IPv4:端口' ;; esac
    minmd_direct_ip=${ORIGIN#http://}; minmd_direct_ip=${minmd_direct_ip%%:*}
    valid_ipv4 "$minmd_direct_ip" || fail 'IP 直连仅接受完整 IPv4 地址'
    case "$minmd_direct_ip" in 0.0.0.0|255.255.255.255) fail '访问地址不能使用监听通配或广播地址' ;; esac
    [ "${minmd_origin_port:-80}" = "$PORT" ] || fail 'IP 直连访问地址端口必须与应用端口一致'
    [ -z "$TRUST" ] && [ "$(value MINMD_TRUST_AUTOMATIC)" = false ] || fail 'IP 直连不使用可信代理'
  else
    case "$ORIGIN" in https://*) ;; *) fail '已有反代和自动 HTTPS 模式需要 HTTPS 来源' ;; esac
  fi
  if [ "$MODE" = https ]; then
    printf '%s\n' "$ORIGIN" | LC_ALL=C grep -Eq '^https://[a-z0-9][a-z0-9.-]*\.[a-z][a-z0-9.-]*$' || fail '自动 HTTPS 需要不带端口的域名，并提前解析到服务器'
  fi
}
write_value() {
  # 调用前均已校验；以原子替换避免断电留下半个配置文件。
  awk -v key="$1" -v val="$2" 'index($0,key "=")==1 {print key "=" val;found=1;next} {print} END{if(!found)print key "=" val}' "$MINMD_ENV" > "$MINMD_ENV.new"
  chmod 600 "$MINMD_ENV.new"; mv "$MINMD_ENV.new" "$MINMD_ENV"
}
check_ownership() {
  minmd_ids=$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT")
  for minmd_id in $minmd_ids; do
    [ "$(docker inspect --format '{{index .Config.Labels "io.minmd.installation"}}' "$minmd_id")" = "$INSTALLATION" ] || fail '同名实例已被其他安装占用；请选择新的 --project，不能接管已有容器'
  done
  minmd_volumes=$(docker volume ls -q --filter "label=com.docker.compose.project=$PROJECT")
  for minmd_volume in $minmd_volumes; do
    [ "$(docker volume inspect --format '{{index .Labels "io.minmd.installation"}}' "$minmd_volume")" = "$INSTALLATION" ] || fail '发现同名旧数据卷；请恢复原配置或选择新实例名，不能重新初始化旧数据'
  done
  for minmd_suffix in postgres_data asset_data caddy_data caddy_config; do
    if docker volume inspect "${PROJECT}_$minmd_suffix" >/dev/null 2>&1; then
      [ "$(docker volume inspect --format '{{index .Labels "io.minmd.installation"}}' "${PROJECT}_$minmd_suffix")" = "$INSTALLATION" ] || fail '默认卷名已被其他数据占用；请选择新的 --project'
    fi
  done
  if docker network inspect "${PROJECT}_default" >/dev/null 2>&1; then
    [ "$(docker network inspect --format '{{index .Labels "io.minmd.installation"}}' "${PROJECT}_default")" = "$INSTALLATION" ] || fail '默认网络名已被其他安装占用；请选择新的 --project'
  fi
  if [ -f "$STATE" ] && [ "$COMMAND" != restore ]; then
    for minmd_required_volume in postgres_data asset_data; do
      if ! docker volume inspect "${PROJECT}_$minmd_required_volume" >/dev/null 2>&1; then
        if [ "$minmd_required_volume" = postgres_data ]; then
          fail '原数据库卷缺失，或 Docker 上下文已改变；不会新建空库冒充原安装。请检查原 Docker 环境，或明确恢复备份'
        else
          fail '原附件卷缺失，不会新建空卷替代原图片和文件。请检查原 Docker 环境，或明确恢复备份'
        fi
      fi
    done
  fi
}
image_ready() { docker image inspect "$1" >/dev/null 2>&1; }
ensure_image() {
  minmd_image_key=$1; minmd_primary=$2; minmd_fallback=$3; minmd_refresh=${4:-false}
  if image_ready "$minmd_primary" && { [ "$OFFLINE" = true ] || [ "$minmd_refresh" = false ]; }; then return; fi
  if [ "$OFFLINE" = false ] && docker pull "$minmd_primary"; then return; fi
  if [ -n "$minmd_fallback" ] && [ "$minmd_fallback" != "$minmd_primary" ]; then
    note "主镜像不可用，尝试备用镜像：$minmd_fallback"
    if image_ready "$minmd_fallback" || { [ "$OFFLINE" = false ] && docker pull "$minmd_fallback"; }; then
      # 成功后才记住所选源，后续 Compose、数据库检查和附件备份恢复使用同一地址。
      write_value "$minmd_image_key" "$minmd_fallback"
      case "$minmd_image_key" in POSTGRES_IMAGE) POSTGRES_IMAGE=$minmd_fallback ;; CADDY_IMAGE) CADDY_IMAGE=$minmd_fallback ;; esac
      return
    fi
  fi
  fail "基础镜像不可用：${minmd_primary}；请检查网络，离线模式需提前导入镜像"
}
ensure_base_image() { ensure_image POSTGRES_IMAGE "$POSTGRES_IMAGE" "$POSTGRES_IMAGE_FALLBACK"; }
prepare_images() {
  if [ "$BUILD" = true ]; then
    [ -f "$MINMD_DEPLOY_ROOT/Dockerfile" ] && [ -f "$MINMD_ROOT/package.json" ] || fail '发布包不包含源码，不能使用 --build'
    compose --profile tools build app migrate
  elif [ "$OFFLINE" = false ]; then
    for minmd_image in "$PREFIX-app:$VERSION" "$PREFIX-migrate:$VERSION"; do
      if [ "$COMMAND" = upgrade ] || ! image_ready "$minmd_image"; then docker pull "$minmd_image"; fi
    done
  else
    for minmd_image in "$PREFIX-app:$VERSION" "$PREFIX-migrate:$VERSION"; do image_ready "$minmd_image" || fail "缺少离线镜像：$minmd_image"; done
  fi
  ensure_image POSTGRES_IMAGE "$POSTGRES_IMAGE" "$POSTGRES_IMAGE_FALLBACK" "$([ "$COMMAND" = upgrade ] && echo true || echo false)"
  if [ "$MODE" = https ]; then ensure_image CADDY_IMAGE "$CADDY_IMAGE" "$CADDY_IMAGE_FALLBACK"; fi
}
own_port() {
  minmd_port=$1; minmd_host=$2
  minmd_running=$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT")
  for minmd_id in $minmd_running; do
    docker inspect --format '{{range $port, $bindings := .NetworkSettings.Ports}}{{range $bindings}}{{println .HostIp .HostPort}}{{end}}{{end}}' "$minmd_id"
  done | awk -v port="$minmd_port" -v host="$minmd_host" '$2==port && ($1==host || $1=="0.0.0.0" || $1=="::") {found=1} END{exit !found}'
}
check_port() {
  if own_port "$1" "$2"; then return; fi
  # 由实际 Docker 引擎尝试绑定，兼容 Linux / Docker Desktop，也能发现非 Docker 进程占用。
  if ! docker run --rm --label "io.minmd.port-probe=$INSTALLATION" -p "$2:$1:5432" --entrypoint sh "$POSTGRES_IMAGE" -c ':' >/dev/null 2>&1; then
    fail "端口 $2:$1 无法绑定，可能已被占用或当前 Docker 不允许绑定；请选择其他应用端口 / 已有反代模式"
  fi
}
check_ports() {
  ensure_base_image
  if [ "$MODE" != https ]; then check_port "$PORT" "$BIND"; else check_port 80 0.0.0.0; check_port 443 0.0.0.0; fi
}
verify_state() {
  [ -f "$STATE" ] || return 0
  [ "$(minmd_value KEY_HASH "$STATE")" = "$(hash_text "$(value AI_KEY_ENCRYPTION_KEY)")" ] || fail '加密密钥与原安装不同；请恢复原值，不能重新生成以免旧密钥无法解密'
  [ "$(minmd_value DATABASE "$STATE")" = "$(value POSTGRES_DB)" ] || fail '数据库名已变化，请恢复原配置；新实例使用新的 --dir / --project'
  [ "$(minmd_value VERSION "$STATE")" = "$VERSION" ] || fail '镜像版本与已安装版本不同；请恢复原配置后使用 upgrade <版本>'
}
save_state() {
  { printf 'VERSION=%s\n' "$VERSION"; printf 'DATABASE=%s\n' "$(value POSTGRES_DB)"; printf 'KEY_HASH=%s\n' "$(hash_text "$(value AI_KEY_ENCRYPTION_KEY)")"; } > "$STATE.new"
  mv "$STATE.new" "$STATE"
}
stop_app() {
  minmd_app=$(compose ps -q app)
  [ -n "$minmd_app" ] || return 0
  compose stop app
  [ "$(docker inspect --format '{{.State.ExitCode}}' "$minmd_app")" = 0 ] || fail '应用未正常退出，已保持停止；请先检查日志和持久化状态'
}
check_database() {
  # 密码通过标准输入传入，不进入进程参数或日志；显式 TCP 验证实际数据库密码。
  if ! printf '%s\n' "$(value POSTGRES_PASSWORD)" | docker run --rm -i --network "${PROJECT}_default" --entrypoint sh "$POSTGRES_IMAGE" -c 'IFS= read -r PGPASSWORD; export PGPASSWORD; exec psql -h postgres -U minmd -d "$1" --no-password -Atqc "select 1"' sh "$(value POSTGRES_DB)" >/dev/null 2>&1; then
    fail '数据库认证失败：请检查原数据库名和密码，不会覆盖或重新初始化已有数据'
  fi
}
start_infrastructure() {
  # 已有数据库优先按旧容器启动并验密，避免错误的新密码导致无意义的重建。
  minmd_pg=$(compose ps -aq postgres)
  if [ -n "$minmd_pg" ]; then
    docker start "$minmd_pg" >/dev/null
    minmd_attempt=0
    until [ "$(docker inspect --format '{{.State.Health.Status}}' "$minmd_pg")" = healthy ]; do
      minmd_attempt=$((minmd_attempt + 1)); [ "$minmd_attempt" -lt 60 ] || fail '数据库未就绪，请查看 logs postgres'
      sleep 1
    done
    check_database
  else
    compose up -d --wait --wait-timeout 120 postgres
    check_database
  fi
  if [ "$MODE" = https ]; then
    compose up -d --no-deps --wait --wait-timeout 90 caddy
    minmd_proxy_id=$(compose ps -q caddy)
    minmd_actual_trust=$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$minmd_proxy_id")
  elif [ "$MODE" = proxy ]; then
    minmd_actual_trust=$(docker network inspect --format '{{(index .IPAM.Config 0).Gateway}}' "${PROJECT}_default")
  fi
  if [ "$(value MINMD_TRUST_AUTOMATIC)" = true ]; then
    [ -n "$minmd_actual_trust" ] || fail '无法识别代理地址，请运行 doctor 检查 Docker 网络'
    write_value TRUST_PROXY_ADDRESSES "$minmd_actual_trust"
    TRUST=$minmd_actual_trust
  fi
}
start_application() {
  # 先创建停止状态的容器和附件卷，再记录归属；应用开始接受写入前状态已落盘。
  compose create app
  save_state
  compose up -d --no-deps --wait --wait-timeout 120 app
}
summary() {
  note "实例：${PROJECT}；模式：${MODE}；版本：$VERSION"
  note "前台：$ORIGIN/"
  note "后台：$ORIGIN/admin/"
  note "配置：$MINMD_DIR/.env"
  if [ "$MODE" = direct ]; then
    note "IP 直连：监听 ${BIND}:${PORT}；请在防火墙 / 云安全组放行 TCP ${PORT}。"
    note '此模式使用 HTTP，账号、文档和密钥传输不加密；不占用 80/443（除非手动选择该应用端口）。'
  elif [ "$MODE" = proxy ]; then
    note "反代目标：http://$BIND:${PORT}；请保留 Host、WebSocket、上传上限 201 MiB 和长连接。"
  else
    note 'Caddy 使用 80/443；应用 9811 不映射到宿主。请确保域名已解析且 80/443 可从公网访问。'
  fi
}
confirm() {
  [ "$YES" = true ] && return 0
  [ -t 0 ] || fail '非交互执行需要 --yes；请先核对配置摘要'
  printf '%s' "$1 [y/N] "
  IFS= read -r minmd_reply || return 1
  case "$minmd_reply" in y|Y|yes|YES) return 0 ;; *) fail '已取消，未继续操作' ;; esac
}
new_install() {
  [ -z "$MODE_ARG" ] || case "$MODE_ARG" in proxy|https|direct) ;; *) fail '--mode 只能是 proxy、https 或 direct' ;; esac
  if [ -z "$MODE_ARG" ]; then
    [ -t 0 ] || fail '非交互安装请指定 --mode proxy|https|direct 和 --origin'
    printf '部署方式：1 已有反向代理（默认）；2 自动 HTTPS；3 IP 直连（HTTP）：'; IFS= read -r minmd_choice
    case "$minmd_choice" in ''|1) MODE_ARG=proxy ;; 2) MODE_ARG=https ;; 3) MODE_ARG=direct ;; *) fail '请选择 1、2 或 3' ;; esac
  fi
  if [ -z "$ORIGIN_ARG" ]; then
    [ -t 0 ] || fail '请指定 --origin；direct 填 http://IPv4:端口，其余填 HTTPS 域名'
    if [ "$MODE_ARG" = direct ]; then printf '最终访问地址（例如 http://192.168.1.10:9811）：'; else printf '最终访问地址（例如 https://docs.example.com）：'; fi
    IFS= read -r ORIGIN_ARG
  fi
  ORIGIN_ARG=$(normalize_origin "$ORIGIN_ARG") || fail '访问地址格式错误，请填写完整 HTTP/HTTPS 来源'
  if [ "$MODE_ARG" = https ]; then [ -z "$PORT_ARG$BIND_ARG$TRUST_ARG" ] || fail '自动 HTTPS 不映射应用端口，不能设置 --port / --bind-host / --trust-proxy'; fi
  if [ -z "$PORT_ARG" ] && [ "$MODE_ARG" = proxy ] && [ -t 0 ]; then
    printf '应用端口 [9811]：'; IFS= read -r PORT_ARG
  fi
  if [ "$MODE_ARG" = direct ]; then
    [ -z "$TRUST_ARG" ] || fail 'IP 直连不能设置 --trust-proxy'
    minmd_direct_port=$(printf '%s' "$ORIGIN_ARG" | sed -n 's/.*:\([0-9][0-9]*\)$/\1/p')
    PORT=${PORT_ARG:-${minmd_direct_port:-80}}; BIND=${BIND_ARG:-0.0.0.0}
  else
    PORT=${PORT_ARG:-9811}; BIND=${BIND_ARG:-127.0.0.1}
  fi
  minmd_default_prefix= minmd_default_version=
  if [ -f "$MINMD_DEPLOY_ROOT/release.env" ]; then
    minmd_default_prefix=$(minmd_value MINMD_IMAGE_PREFIX "$MINMD_DEPLOY_ROOT/release.env")
    minmd_default_version=$(minmd_value MINMD_IMAGE_TAG "$MINMD_DEPLOY_ROOT/release.env")
  fi
  if [ "$BUILD" = true ]; then minmd_default_prefix=minmd; minmd_default_version=local; fi
  PREFIX=${PREFIX_ARG:-$minmd_default_prefix}; VERSION=${VERSION_ARG:-$minmd_default_version}
  POSTGRES_IMAGE=postgres:18; CADDY_IMAGE=caddy:2.11.4-alpine
  POSTGRES_IMAGE_FALLBACK=; CADDY_IMAGE_FALLBACK=
  if [ -f "$MINMD_DEPLOY_ROOT/release.env" ]; then
    POSTGRES_IMAGE_FALLBACK=$(minmd_value POSTGRES_IMAGE_FALLBACK "$MINMD_DEPLOY_ROOT/release.env")
    CADDY_IMAGE_FALLBACK=$(minmd_value CADDY_IMAGE_FALLBACK "$MINMD_DEPLOY_ROOT/release.env")
    minmd_release_postgres=$(minmd_value POSTGRES_IMAGE "$MINMD_DEPLOY_ROOT/release.env")
    minmd_release_caddy=$(minmd_value CADDY_IMAGE "$MINMD_DEPLOY_ROOT/release.env")
    POSTGRES_IMAGE=${minmd_release_postgres:-$POSTGRES_IMAGE}; CADDY_IMAGE=${minmd_release_caddy:-$CADDY_IMAGE}
  fi
  [ -n "$PREFIX" ] && [ -n "$VERSION" ] || fail '源码目录请使用 --build；预构建部署请提供 --image-prefix 和 --version，或下载正式部署包'
  PROJECT=${PROJECT_ARG:-minmd-$(printf '%s' "$MINMD_DIR" | cksum | awk '{print $1}')}
  INSTALLATION=$(random_hex)
  MODE=$MODE_ARG; ORIGIN=$ORIGIN_ARG
  minmd_db_secret=$(random_hex); minmd_admin_secret=$(random_hex); minmd_key_secret=$(random_hex)
  MINMD_ENV="$MINMD_DIR/.env.candidate"
  {
    printf 'MINMD_MANAGED=1\nMINMD_INSTALL_DIR=%s\n' "$MINMD_DIR"
    printf 'MINMD_INSTALLATION_ID=%s\nMINMD_DEPLOY_MODE=%s\n' "$INSTALLATION" "$MODE"
    printf 'COMPOSE_PROJECT_NAME=%s\nMINMD_IMAGE_PREFIX=%s\nMINMD_IMAGE_TAG=%s\n' "$PROJECT" "$PREFIX" "$VERSION"
    printf 'POSTGRES_IMAGE=%s\nCADDY_IMAGE=%s\nPOSTGRES_IMAGE_FALLBACK=%s\nCADDY_IMAGE_FALLBACK=%s\n' "$POSTGRES_IMAGE" "$CADDY_IMAGE" "$POSTGRES_IMAGE_FALLBACK" "$CADDY_IMAGE_FALLBACK"
    printf 'PUBLIC_ORIGIN=%s\nAPP_BIND_HOST=%s\nAPP_BIND_PORT=%s\n' "$ORIGIN" "$BIND" "$PORT"
    printf 'MINMD_TRUST_AUTOMATIC=%s\nTRUST_PROXY_ADDRESSES=%s\n' "$([ "$MODE" != direct ] && [ -z "$TRUST_ARG" ] && echo true || echo false)" "$TRUST_ARG"
    printf 'POSTGRES_DB=minmd\nPOSTGRES_PASSWORD=%s\nADMIN_ACCOUNT=admin\nADMIN_PASSWORD=%s\nAI_KEY_ENCRYPTION_KEY=%s\n' "$minmd_db_secret" "$minmd_admin_secret" "$minmd_key_secret"
  } > "$MINMD_ENV"
  validate_config
  lock_project
  check_ownership
  check_ports
  summary
  confirm '确认安装到上述目录和实例？'
  mv "$MINMD_ENV" "$MINMD_DIR/.env"
  MINMD_ENV="$MINMD_DIR/.env"
}
check_install_arguments() {
  for minmd_pair in "MINMD_DEPLOY_MODE:$MODE_ARG" "PUBLIC_ORIGIN:$ORIGIN_ARG" "APP_BIND_PORT:$PORT_ARG" "APP_BIND_HOST:$BIND_ARG" "TRUST_PROXY_ADDRESSES:$TRUST_ARG" "COMPOSE_PROJECT_NAME:$PROJECT_ARG" "MINMD_IMAGE_PREFIX:$PREFIX_ARG" "MINMD_IMAGE_TAG:$VERSION_ARG"; do
    minmd_name=${minmd_pair%%:*}; minmd_requested=${minmd_pair#*:}
    [ -z "$minmd_requested" ] || [ "$(value "$minmd_name")" = "$minmd_requested" ] || fail '已存在安装配置，不能通过 install 改写参数；请沿用原配置或指定新 --dir'
  done
}
backup_to() {
  sh "$MINMD_DEPLOY_ROOT/scripts/backup.sh" "$MINMD_ENV" "$1" ${2:+--keep-stopped}
  cp "$MINMD_ENV" "$1/deployment.env"
  chmod 600 "$1/deployment.env"
  (cd "$1" && if command -v sha256sum >/dev/null 2>&1; then sha256sum deployment.env >> SHA256SUMS; else shasum -a 256 deployment.env >> SHA256SUMS; fi)
}
validate_backup() {
  [ -d "$1" ] && [ -f "$1/deployment.env" ] || fail '备份缺少部署配置；旧版备份请按手动恢复文档操作'
  minmd_backup_dir=$(CDPATH= cd -- "$1" && pwd -P)
  [ -f "$minmd_backup_dir/SHA256SUMS" ] || fail '备份缺少校验清单'
  (cd "$minmd_backup_dir" && if command -v sha256sum >/dev/null 2>&1; then sha256sum -c SHA256SUMS; else shasum -a 256 -c SHA256SUMS; fi) || fail '备份校验失败，未替换数据'
  # 只解析需要恢复的字段，不执行备份中的配置，也不替换当前实例和数据库连接凭证。
  RESTORE_PREFIX=$(minmd_value MINMD_IMAGE_PREFIX "$minmd_backup_dir/deployment.env")
  RESTORE_VERSION=$(minmd_value MINMD_IMAGE_TAG "$minmd_backup_dir/deployment.env")
  RESTORE_KEY=$(minmd_value AI_KEY_ENCRYPTION_KEY "$minmd_backup_dir/deployment.env")
  valid_prefix "$RESTORE_PREFIX" && valid_tag "$RESTORE_VERSION" || fail '备份版本信息无效'
  printf '%s\n' "$RESTORE_KEY" | LC_ALL=C grep -Eq '^[a-f0-9]{64}$' || fail '备份缺少有效的原加密密钥'
}
prerequisites
NEW=false
if [ "$COMMAND" = install ] && [ ! -e "$MINMD_ENV" ]; then
  new_install; NEW=true
else
  validate_config
  case "$COMMAND" in status|doctor|logs) ;; *) lock_project ;; esac
  check_ownership
fi
compose config --quiet
case "$COMMAND" in
  install)
    [ ! -f "$PENDING" ] || fail '有未完成的升级 / 恢复，请重试原操作，不能重新安装'
    check_install_arguments
    verify_state
    prepare_images
    check_ports
    start_infrastructure
    compose run --rm -T migrate
    start_application
    summary
    if [ "$NEW" = true ]; then note "后台初始账号：admin；初始密码：$(value ADMIN_PASSWORD)"; else note '已沿用原配置和凭证完成启动。'; fi
    note '前台仍使用现有网页首次初始化流程，无初始化码。'
    ;;
  start|restart)
    [ ! -f "$PENDING" ] || fail '上次升级 / 恢复未完成；请重试该操作或恢复备份，不会启动可能不匹配的版本'
    verify_state
    prepare_images
    check_ports
    if [ "$COMMAND" = restart ]; then stop_app; fi
    start_infrastructure
    compose run --rm -T migrate
    start_application
    summary
    ;;
  stop) compose stop; note '服务已停止，数据库、附件和证书卷保留。' ;;
  status)
    summary
    if [ -f "$PENDING" ]; then note '有未完成的升级或恢复，应用应保持停止。'; fi
    compose ps -a
    ;;
  logs)
    minmd_service=${OPERAND:-app}
    case "$minmd_service" in app|postgres) ;; caddy) [ "$MODE" = https ] || fail '当前模式没有 Caddy' ;; *) fail '日志服务只能为 app、postgres 或 caddy' ;; esac
    if [ "$FOLLOW" = true ]; then compose logs --tail 100 -f "$minmd_service"; else compose logs --tail 100 "$minmd_service"; fi
    ;;
  doctor)
    verify_state
    note '配置、Docker、实例归属与数据卷检查通过。'
    [ ! -f "$PENDING" ] || fail '存在未完成的升级 / 恢复；请先完成原操作'
    check_database
    compose exec -T app bun -e 'const r=await fetch("http://127.0.0.1:9811/api/health");const v=await r.json();if(!r.ok||v.database!=="connected")process.exit(1)' || fail '应用健康检查失败'
    if [ "$MODE" = https ]; then compose exec -T caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile; fi
    if command -v curl >/dev/null 2>&1; then
      minmd_health=$(curl --noproxy '*' --fail --silent --show-error --max-time 10 "$ORIGIN/api/health") || fail '访问入口未就绪：请检查访问地址、防火墙 / 安全组、证书和反向代理'
      printf '%s' "$minmd_health" | grep -Eq '"database"[[:space:]]*:[[:space:]]*"connected"' || fail '访问地址未返回 MinMD 健康接口，请检查 IP / 端口或反代目标'
    else fail '缺少 curl，无法检查实际访问入口'; fi
    note '数据库、应用和实际访问入口检查通过；多人协作和上传仍需在页面验收。'
    ;;
  backup)
    verify_state
    [ ! -f "$PENDING" ] || fail '维护未完成，不能将当前状态标记为正常备份'
    minmd_target=${OPERAND:-$MINMD_DIR/backups/$(date -u '+%Y%m%dT%H%M%SZ')-$$}
    mkdir -p "$(dirname "$minmd_target")"
    backup_to "$minmd_target"
    ;;
  upgrade)
    valid_tag "$OPERAND" || fail '请指定固定镜像版本，不能使用 latest'
    if ! awk -v current="$VERSION" -v target="$OPERAND" 'BEGIN {
      if(current !~ /^v[0-9]+\.[0-9]+\.[0-9]+/)exit 0;
      if(target !~ /^v[0-9]+\.[0-9]+\.[0-9]+/)exit 1;
      a=current;b=target;sub(/^v/,"",a);sub(/^v/,"",b);split(a,x,".");split(b,y,".");
      for(i=1;i<=3;i++){if(y[i]+0<x[i]+0)exit 1;if(y[i]+0>x[i]+0)exit 0}
      if(current !~ /-/ && target ~ /-/)exit 1;
    }'; then fail 'upgrade 不允许降低版本；需要回退时请恢复对应版本的完整备份'; fi
    if [ -f "$PENDING" ]; then
      [ "$(minmd_value OPERATION "$PENDING")" = upgrade ] && [ "$(minmd_value TARGET "$PENDING")" = "$OPERAND" ] || fail '请先重试原升级版本，或执行 restore 恢复备份'
      minmd_backup=$(minmd_value BACKUP "$PENDING")
      validate_backup "$minmd_backup"
    else
      verify_state
      [ "$VERSION" != "$OPERAND" ] || { note '当前已是该版本。'; exit 0; }
      minmd_backup="$MINMD_DIR/backups/upgrade-$(date -u '+%Y%m%dT%H%M%SZ')-$$"
    fi
    VERSION=$OPERAND
    # 拉取失败不改配置，不停止旧服务。临时 env 只用于选择目标镜像。
    cp "$MINMD_ENV" "$MINMD_ENV.upgrade"
    MINMD_ENV="$MINMD_ENV.upgrade"; write_value MINMD_IMAGE_TAG "$VERSION"
    prepare_images
    MINMD_ENV="$MINMD_DIR/.env"
    if [ ! -f "$PENDING" ]; then
      mkdir -p "$MINMD_DIR/backups"
      backup_to "$minmd_backup" keep-stopped
      { printf 'OPERATION=upgrade\nTARGET=%s\nBACKUP=%s\n' "$VERSION" "$minmd_backup"; } > "$PENDING"
    fi
    stop_app
    write_value POSTGRES_IMAGE "$POSTGRES_IMAGE"
    write_value CADDY_IMAGE "$CADDY_IMAGE"
    write_value MINMD_IMAGE_TAG "$VERSION"
    start_infrastructure
    compose run --rm -T migrate
    start_application
    rm -f "$PENDING" "$MINMD_ENV.upgrade"
    note "升级成功：${VERSION}；升级前备份：$minmd_backup"
    ;;
  restore)
    validate_backup "$OPERAND"
    summary
    note "将用备份 $minmd_backup_dir 替换当前数据库和附件，并使用版本 ${RESTORE_VERSION}。"
    confirm '确认替换当前实例数据？'
    # 先验证所需镜像可用，失败时不触碰当前数据。
    for minmd_image in "$RESTORE_PREFIX-app:$RESTORE_VERSION" "$RESTORE_PREFIX-migrate:$RESTORE_VERSION"; do
      if [ "$OFFLINE" = true ]; then image_ready "$minmd_image" || fail "缺少恢复镜像：$minmd_image"; else docker pull "$minmd_image"; fi
    done
    printf 'OPERATION=restore\nBACKUP=%s\n' "$minmd_backup_dir" > "$PENDING"
    stop_app
    sh "$MINMD_DEPLOY_ROOT/scripts/restore.sh" "$MINMD_ENV" "$minmd_backup_dir" --replace-data
    write_value MINMD_IMAGE_PREFIX "$RESTORE_PREFIX"
    write_value MINMD_IMAGE_TAG "$RESTORE_VERSION"
    write_value AI_KEY_ENCRYPTION_KEY "$RESTORE_KEY"
    PREFIX=$RESTORE_PREFIX; VERSION=$RESTORE_VERSION
    save_state
    rm -f "$PENDING"
    note '恢复完成，应用保持停止。执行 start 后核对文档、表格、历史版本和图片。'
    ;;
esac
