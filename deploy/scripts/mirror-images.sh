#!/bin/sh
# 复制已发布的内容，不在国内镜像源重建；转换清单格式兼容个人版仓库。
set -eu
[ "$#" -eq 4 ] || { echo '用法：mirror-images.sh GitHub用户/仓库 固定版本 腾讯云命名空间 app|migrate|postgres|caddy' >&2; exit 2; }
printf '%s\n' "$1" | LC_ALL=C grep -Eq '^[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*$' || exit 2
printf '%s\n' "$2" | LC_ALL=C grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+([.-][A-Za-z0-9.-]+)?$' || exit 2
printf '%s\n' "$3" | LC_ALL=C grep -Eq '^[a-z0-9][a-z0-9_-]{0,62}$' || exit 2
MINMD_REPO=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')
MINMD_TAG=$2
MINMD_TARGET="ccr.ccs.tencentyun.com/$3/minmd-$4"
case "$4" in
  app|migrate) MINMD_SOURCE="ghcr.io/$MINMD_REPO-$4:$MINMD_TAG" ;;
  postgres) MINMD_SOURCE=docker.io/library/postgres:18; MINMD_TAG=18 ;;
  caddy) MINMD_SOURCE=docker.io/library/caddy:2.11.4-alpine; MINMD_TAG=2.11.4-alpine ;;
  *) echo '未知镜像类型' >&2; exit 2 ;;
esac
MINMD_STAGE=$(mktemp -d)
trap 'rm -rf "$MINMD_STAGE"' 0
trap 'exit 130' INT
trap 'exit 143' TERM
skopeo inspect --raw "docker://$MINMD_SOURCE" > "$MINMD_STAGE/source.json"
MINMD_DIGEST="sha256:$(sha256sum "$MINMD_STAGE/source.json" | awk '{print $1}')"
MINMD_PINNED="${MINMD_SOURCE%:*}@$MINMD_DIGEST"
for MINMD_ARCH in amd64 arm64; do
  skopeo --override-os linux --override-arch "$MINMD_ARCH" copy --retry-times 3 --format v2s2 \
    --authfile "${DOCKER_CONFIG:-$HOME/.docker}/config.json" \
    "docker://$MINMD_PINNED" "docker://$MINMD_TARGET:$MINMD_TAG-$MINMD_ARCH"
done
docker buildx imagetools create --tag "$MINMD_TARGET:$MINMD_TAG" \
  "$MINMD_TARGET:$MINMD_TAG-amd64" "$MINMD_TARGET:$MINMD_TAG-arm64"
# 使用空凭证配置确认公开分发；登录推送成功不代表用户能匿名拉取。
mkdir "$MINMD_STAGE/anonymous"
printf '{}\n' > "$MINMD_STAGE/anonymous/config.json"
docker --config "$MINMD_STAGE/anonymous" manifest inspect "$MINMD_TARGET:$MINMD_TAG" > "$MINMD_STAGE/target.json"
python3 - "$MINMD_STAGE/target.json" <<'PY'
import json, sys
with open(sys.argv[1]) as stream:
    image = json.load(stream)
platforms = {(m["platform"]["os"], m["platform"]["architecture"]) for m in image["manifests"]}
assert platforms == {("linux", "amd64"), ("linux", "arm64")}, platforms
PY
printf '国内镜像已同步并通过匿名双架构检查：%s:%s（来源 %s）\n' "$MINMD_TARGET" "$MINMD_TAG" "$MINMD_PINNED"
