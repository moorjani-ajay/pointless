# Playwright base image ships Chromium + all system deps for PDF export.
# Keep this tag in sync with the playwright version in server/package.json.
FROM mcr.microsoft.com/playwright:v1.60.0-noble AS base
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
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY shared/package.json shared/
COPY server/package.json server/
RUN pnpm install --frozen-lockfile --prod --filter @pointless/server --filter @pointless/shared
COPY --from=build /app/shared/dist shared/dist
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/themes server/themes
COPY --from=build /app/web/dist server/public
EXPOSE 3000
CMD ["node", "server/dist/index.js"]
