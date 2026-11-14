FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

# The app is static: camera, detection and recording all run in the browser.
FROM nginx:alpine
COPY --from=build /app/apps/web/build/client /usr/share/nginx/html
