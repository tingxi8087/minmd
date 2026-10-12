#!/bin/sh
set -eu
umask 077
# 用法：backup.sh 环境文件 新备份目录（不覆盖已有目录）。
[ "$#" -eq 2 ] || { echo '用法：backup.sh deploy/.env.production backups/时间戳' >&2; exit 2; }
MINMD_DEPLOY_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
MINMD_ENV=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
[ -f "$MINMD_ENV" ] || { echo '环境文件不存在' >&2; exit 2; }
[ ! -e "$2" ] || { echo '备份目标已存在，请使用新目录' >&2; exit 2; }
mkdir -p "$2"
MINMD_BACKUP=$(cd "$2" && pwd)
compose() { docker compose --env-file "$MINMD_ENV" -f "$MINMD_DEPLOY_ROOT/compose.production.yaml" "$@"; }
MINMD_APP=$(compose ps -q app)
[ -n "$MINMD_APP" ] || { echo 'app必须正在运行，不能确认已停止实例的落盘结果' >&2; exit 1; }
MINMD_ASSET_VOLUME=$(docker inspect "$MINMD_APP" --format '{{range .Mounts}}{{if eq .Destination "/var/lib/minmd/assets"}}{{.Name}}{{end}}{{end}}')
[ -n "$MINMD_ASSET_VOLUME" ] || { echo '找不到私有附件卷' >&2; exit 1; }
MINMD_WEB=$(compose ps -q web)
trap 'MINMD_STATUS=$?; if [ "$MINMD_STATUS" -ne 0 ]; then echo "备份失败；服务可能保持停止，请检查退出状态后手动恢复。未完整备份不能用于一致性恢复。" >&2; fi' 0
compose stop web
compose stop app
MINMD_EXIT=$(docker inspect "$MINMD_APP" --format '{{.State.ExitCode}}')
[ "$MINMD_EXIT" -eq 0 ] || { echo '应用未正常退出，拒绝把该备份视为一致备份；服务保持停止' >&2; exit 1; }
compose exec -T postgres sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-acl --no-password' > "$MINMD_BACKUP/database.dump"
docker run --rm --network none --read-only -v "$MINMD_ASSET_VOLUME:/source:ro" -v "$MINMD_BACKUP:/backup" postgres:18 tar czf /backup/assets.tar.gz -C /source .
docker inspect "$MINMD_APP" --format '{{.Image}}' > "$MINMD_BACKUP/app-image.txt"
date -u '+%Y-%m-%dT%H:%M:%SZ' > "$MINMD_BACKUP/created-at.txt"
(cd "$MINMD_BACKUP" && if command -v sha256sum >/dev/null 2>&1; then sha256sum database.dump assets.tar.gz > SHA256SUMS; else shasum -a 256 database.dump assets.tar.gz > SHA256SUMS; fi)
compose up -d app
if [ -n "$MINMD_WEB" ]; then compose up -d web; fi
trap - 0
echo "一致备份已写入：${MINMD_BACKUP}。请加密保管并在独立项目演练恢复。"
