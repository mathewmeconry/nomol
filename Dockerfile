FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

# The app is static: camera, detection and recording all run in the browser.
FROM nginx:alpine
COPY --from=build /app/build/client /usr/share/nginx/html
