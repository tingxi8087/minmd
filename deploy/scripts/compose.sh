#!/bin/sh
# 仅解析键值，不执行配置文件；维护入口和备份恢复共用同一组 Compose 文件。
minmd_value() {
  awk -v key="$1" 'index($0,key "=")==1 {print substr($0,length(key)+2);exit}' "$2"
}
minmd_postgres_image() {
  minmd_image=$(minmd_value POSTGRES_IMAGE "$MINMD_ENV")
  printf '%s\n' "${minmd_image:-postgres:18}"
}
minmd_caddy_image() {
  minmd_image=$(minmd_value CADDY_IMAGE "$MINMD_ENV")
  printf '%s\n' "${minmd_image:-caddy:2.11.4-alpine}"
}
compose() (
  # Shell 导出的同名变量优先于 --env-file；清理后才能保证目标实例及凭证来自该文件。
  for minmd_key in COMPOSE_PROJECT_NAME COMPOSE_PROFILES COMPOSE_FILE COMPOSE_ENV_FILES MINMD_IMAGE_PREFIX MINMD_IMAGE_TAG MINMD_INSTALLATION_ID PUBLIC_ORIGIN APP_BIND_HOST APP_BIND_PORT TRUST_PROXY_ADDRESSES POSTGRES_IMAGE CADDY_IMAGE POSTGRES_DB POSTGRES_PASSWORD ADMIN_ACCOUNT ADMIN_PASSWORD AI_KEY_ENCRYPTION_KEY AUTH_SESSION_HOURS DOC_COLLAB_MAX_SESSIONS SHEET_COLLAB_MAX_SESSIONS ASSET_UNBOUND_GRACE_HOURS LOG_LEVEL HTTP_BODY_LIMIT_BYTES AI_EXECUTION_TIMEOUT_MS DOC_COLLAB_MESSAGES_PER_SECOND; do
    unset "$minmd_key"
  done
  minmd_mode=$(minmd_value MINMD_DEPLOY_MODE "$MINMD_ENV")
  case "${minmd_mode:-proxy}" in
    proxy|https|direct) ;;
    *) echo 'MINMD_DEPLOY_MODE 只能为 proxy、https 或 direct' >&2; exit 2 ;;
  esac
  docker compose --env-file "$MINMD_ENV" \
    -f "$MINMD_DEPLOY_ROOT/compose.production.yaml" \
    -f "$MINMD_DEPLOY_ROOT/compose.${minmd_mode:-proxy}.yaml" "$@"
)
