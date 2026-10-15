FROM oven/bun:1.3.13 AS build
WORKDIR /workspace
COPY package.json bun.lock ./
COPY system/server/package.json ./system/server/package.json
COPY apps/app_server/package.json ./apps/app_server/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/web-cms/package.json ./apps/web-cms/package.json
COPY patches ./patches
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

# 显式的一次性迁移任务；复用原迁移命令及审查后的SQL。
FROM build AS migrate
CMD ["bun", "run", "db:migrate"]

FROM oven/bun:1.3.13 AS app
WORKDIR /app
COPY --from=build /workspace/dist/server ./dist/server
# 系统启动时校验管理后台产物存在；对外静态资源由web提供。
COPY --from=build /workspace/dist/web-cms ./dist/web-cms
COPY --from=build /workspace/package.json ./package.json
COPY --from=build /workspace/LICENSE /workspace/THIRD_PARTY_NOTICES.txt ./
COPY --from=build /workspace/node_modules ./node_modules
RUN mkdir -p /var/lib/minmd/assets /app/runtime/public && chown -R bun:bun /var/lib/minmd /app/runtime
USER bun
EXPOSE 9811
STOPSIGNAL SIGTERM
CMD ["bun", "dist/server/main.js"]

FROM nginxinc/nginx-unprivileged:1.28-alpine AS web
COPY deploy/nginx.conf /etc/minmd/default.conf.template
COPY deploy/nginx-main.conf /etc/minmd/nginx.conf
COPY --from=build /workspace/dist/web /usr/share/nginx/html
COPY --from=build /workspace/dist/web-cms /usr/share/nginx/html/admin
EXPOSE 8080
CMD ["sh", "-c", "envsubst '${MINMD_PROXY_GATEWAY}' < /etc/minmd/default.conf.template > /tmp/minmd.conf && exec nginx -c /etc/minmd/nginx.conf -g 'daemon off;'"]
