FROM node:24-bookworm-slim AS base
RUN corepack enable

FROM base AS build
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm -r build

FROM base
WORKDIR /app
ENV NODE_ENV=production PORT=3000
# Stamp the version/commit so the running container reports what it was cut
# from (read by server/src/version.ts → MCP serverInfo, GET /version, startup
# log). Release CI passes these as --build-arg; a plain build falls back to the
# package.json version. The release pipeline also sets the full OCI label set.
ARG POINTLESS_VERSION=""
ARG POINTLESS_COMMIT=""
ENV POINTLESS_VERSION=$POINTLESS_VERSION POINTLESS_COMMIT=$POINTLESS_COMMIT
LABEL org.opencontainers.image.version=$POINTLESS_VERSION
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY shared/package.json shared/
COPY server/package.json server/
# --ignore-scripts: the runtime image runs no lifecycle scripts. Without it the
# root `prepare` (husky) runs during this prod install, but husky is a
# devDependency absent under --prod, so the build would fail with
# "husky: not found". None of the prod dependencies need a postinstall.
RUN pnpm install --frozen-lockfile --prod --ignore-scripts --filter @pointless/server --filter @pointless/shared
COPY --from=build /app/shared/dist shared/dist
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist server/public
EXPOSE 3000
CMD ["node", "server/dist/index.js"]
