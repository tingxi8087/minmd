ARG DEPENDENCIES_STAGE=dependencies

FROM node:22-bookworm-slim AS frontend-node

FROM oven/bun:1.3.13 AS manifests
WORKDIR /workspace
COPY package.json bun.lock ./
COPY system/server/package.json ./system/server/package.json
COPY apps/app_server/package.json ./apps/app_server/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/web-cms/package.json ./apps/web-cms/package.json
COPY patches ./patches
# 前后台构建工具版本不同，构建依赖保持 workspace 隔离。
FROM manifests AS build-dependencies
RUN bun install --frozen-lockfile
FROM build-dependencies AS build
# Vite 使用标准 Node 运行时并限制堆内存，避免 Bun fallback 构建大型编辑器时耗尽内存。
# Node 只在构建阶段存在，后端及最终镜像仍使用 Bun。
COPY --from=frontend-node /usr/local/bin/node /usr/local/bin/node
COPY . .
RUN NODE_OPTIONS=--max-old-space-size=4096 bun run build

FROM manifests AS dependencies
# 源码构建保留在 Linux 内安装的入口。
RUN bun install --frozen-lockfile --linker hoisted

# 本机发布用 Bun --os linux --cpu 按架构准备依赖，不在模拟器中重复安装。
FROM manifests AS dependencies-prebuilt
COPY --from=release-dependencies / /workspace/

FROM ${DEPENDENCIES_STAGE} AS runtime-dependencies
COPY package.json ./package.json
COPY deploy/scripts/check-image-dependencies.ts ./deploy/scripts/check-image-dependencies.ts
RUN bun --preserve-symlinks deploy/scripts/check-image-dependencies.ts
COPY scripts/generate-third-party-notices.ts ./scripts/generate-third-party-notices.ts
COPY docs/licenses ./docs/licenses
COPY LICENSE ./LICENSE
RUN bun scripts/generate-third-party-notices.ts

# 迁移只需要数据库工具和配置，不编译前后台网页。
FROM runtime-dependencies AS migrate
COPY database ./database
COPY system/server/src/config ./system/server/src/config
COPY system/server/src/database/client.ts ./system/server/src/database/client.ts
CMD ["bun", "run", "db:migrate"]

FROM oven/bun:1.3.13 AS app-runtime
WORKDIR /app
COPY --from=runtime-dependencies /workspace/LICENSE /workspace/THIRD_PARTY_NOTICES.txt ./
COPY --from=runtime-dependencies /workspace/node_modules ./node_modules
RUN mkdir -p /var/lib/minmd/assets /app/runtime/public && chown -R bun:bun /var/lib/minmd /app/runtime
USER bun
EXPOSE 9811
STOPSIGNAL SIGTERM
CMD ["bun", "dist/server/main.js"]

# 发布命令只在宿主机编译一次，两个架构共用同一份 dist。
FROM app-runtime AS app-prebuilt
COPY --from=release-artifacts /server ./dist/server
COPY --from=release-artifacts /web ./dist/web
COPY --from=release-artifacts /web-cms ./dist/web-cms
COPY package.json ./package.json

# 保留源码 Docker 构建入口，供自行构建及原有部署验收使用。
FROM app-runtime AS app
COPY --from=build /workspace/dist/server ./dist/server
# 后端在同一端口提供前台、后台、接口及协作连接。
COPY --from=build /workspace/dist/web ./dist/web
COPY --from=build /workspace/dist/web-cms ./dist/web-cms
COPY --from=build /workspace/package.json ./package.json
