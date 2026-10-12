#!/bin/sh
set -eu
# 显式替换目标数据，仅在隔离的新项目或已核实的恢复目标执行。
[ "$#" -eq 3 ] && [ "$3" = --replace-data ] || { echo '用法：restore.sh 环境文件 备份目录 --replace-data（将替换目标数据库和附件）' >&2; exit 2; }
MINMD_DEPLOY_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
MINMD_ENV=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
MINMD_BACKUP=$(cd "$2" && pwd)
[ -f "$MINMD_ENV" ] && [ -f "$MINMD_BACKUP/database.dump" ] && [ -f "$MINMD_BACKUP/assets.tar.gz" ] && [ -f "$MINMD_BACKUP/SHA256SUMS" ] || { echo '环境或备份文件不完整' >&2; exit 2; }
(cd "$MINMD_BACKUP" && if command -v sha256sum >/dev/null 2>&1; then sha256sum -c SHA256SUMS; else shasum -a 256 -c SHA256SUMS; fi)
compose() { docker compose --env-file "$MINMD_ENV" -f "$MINMD_DEPLOY_ROOT/compose.production.yaml" "$@"; }
compose stop web app
compose up -d --wait --wait-timeout 60 postgres
compose create app
MINMD_APP=$(compose ps -aq app)
MINMD_ASSET_VOLUME=$(docker inspect "$MINMD_APP" --format '{{range .Mounts}}{{if eq .Destination "/var/lib/minmd/assets"}}{{.Name}}{{end}}{{end}}')
[ -n "$MINMD_ASSET_VOLUME" ] || { echo '找不到目标私有附件卷' >&2; exit 1; }
# 恢复期间不启动app；数据库单事务失败会回滚。附件恢复失败时服务保持停止。
compose exec -T postgres sh -c 'exec pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-acl --no-password --single-transaction' < "$MINMD_BACKUP/database.dump"
docker run --rm --network none -v "$MINMD_ASSET_VOLUME:/target" -v "$MINMD_BACKUP:/backup:ro" postgres:18 sh -c 'find /target -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && tar xzf /backup/assets.tar.gz -C /target'
echo '恢复写入完成；应用保持停止。请用备份匹配版本启动并核验当前内容、历史版本和附件。'
