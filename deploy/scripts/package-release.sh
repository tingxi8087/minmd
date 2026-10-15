#!/bin/sh
set -eu
[ "$#" -ge 3 ] && [ "$#" -le 4 ] || { echo '用法：package-release.sh 镜像前缀 版本 输出tar.gz [GitHub用户/仓库]' >&2; exit 2; }
printf '%s\n' "$1" | LC_ALL=C grep -Eq '^[a-z0-9][a-z0-9./:_-]*$' || exit 2
printf '%s\n' "$2" | LC_ALL=C grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+([.-][A-Za-z0-9.-]+)?$' || exit 2
MINMD_SOURCE=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
MINMD_RELEASE_REPOSITORY=${4:-tingxi8087/minmd}
printf '%s\n' "$MINMD_RELEASE_REPOSITORY" | LC_ALL=C grep -Eq '^[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*$' || exit 2
mkdir -p "$(dirname "$3")"
MINMD_OUTPUT_DIR=$(CDPATH= cd -- "$(dirname "$3")" && pwd)
[ "$MINMD_OUTPUT_DIR" != "$MINMD_SOURCE" ] || { echo '请输出到 dist/ 或其他独立目录，不能覆盖源码安装入口' >&2; exit 2; }
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
# Release 的薄入口绑定实际发布仓库，fork 发布也不会误下载上游。
sed "s|^MINMD_DEFAULT_REPOSITORY=.*|MINMD_DEFAULT_REPOSITORY=$MINMD_RELEASE_REPOSITORY|" "$MINMD_SOURCE/install.sh" > "$MINMD_STAGE/install.sh"
cp "$MINMD_STAGE/install.sh" "$MINMD_OUTPUT_DIR/install.sh"
chmod +x "$MINMD_OUTPUT_DIR/install.sh"
cp "$MINMD_BUNDLE/deploy/release.env" "$MINMD_OUTPUT_DIR/release.env"
echo "部署包、校验文件、install.sh 和 release.env 已生成：$MINMD_OUTPUT_DIR"
