#!/bin/sh
set -eu
[ "$#" -eq 3 ] || { echo '用法：package-release.sh 镜像前缀 版本 输出tar.gz' >&2; exit 2; }
printf '%s\n' "$1" | LC_ALL=C grep -Eq '^[a-z0-9][a-z0-9./:_-]*$' || exit 2
printf '%s\n' "$2" | LC_ALL=C grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+([.-][A-Za-z0-9.-]+)?$' || exit 2
MINMD_SOURCE=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
MINMD_STAGE=$(mktemp -d)
trap 'rm -rf "$MINMD_STAGE"' 0
trap 'exit 130' INT
trap 'exit 143' TERM
MINMD_BUNDLE="$MINMD_STAGE/minmd"
mkdir -p "$MINMD_BUNDLE/deploy/scripts" "$(dirname "$3")"
cp "$MINMD_SOURCE/minmd.sh" "$MINMD_SOURCE/LICENSE" "$MINMD_SOURCE/THIRD_PARTY_NOTICES.txt" "$MINMD_BUNDLE/"
for MINMD_FILE in compose.production.yaml compose.proxy.yaml compose.https.yaml compose.direct.yaml Caddyfile README.md .env.production.example; do
  cp "$MINMD_SOURCE/deploy/$MINMD_FILE" "$MINMD_BUNDLE/deploy/"
done
for MINMD_FILE in manage.sh compose.sh backup.sh restore.sh; do
  cp "$MINMD_SOURCE/deploy/scripts/$MINMD_FILE" "$MINMD_BUNDLE/deploy/scripts/"
done
printf 'MINMD_IMAGE_PREFIX=%s\nMINMD_IMAGE_TAG=%s\n' "$1" "$2" > "$MINMD_BUNDLE/deploy/release.env"
chmod +x "$MINMD_BUNDLE/minmd.sh"
tar czf "$3" -C "$MINMD_STAGE" minmd
MINMD_OUTPUT_DIR=$(CDPATH= cd -- "$(dirname "$3")" && pwd)
MINMD_OUTPUT_FILE=$(basename "$3")
(cd "$MINMD_OUTPUT_DIR" && if command -v sha256sum >/dev/null 2>&1; then sha256sum "$MINMD_OUTPUT_FILE" > "$MINMD_OUTPUT_FILE.sha256"; else shasum -a 256 "$MINMD_OUTPUT_FILE" > "$MINMD_OUTPUT_FILE.sha256"; fi)
echo "部署包已生成：$3"
