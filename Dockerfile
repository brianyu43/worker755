# Worker 755: one container serving the game and its API on port 8755.
FROM node:24-slim AS web
WORKDIR /app
COPY web/package.json web/package-lock.json web/
RUN npm ci --prefix web --no-audit --no-fund
# The shell runs in the browser, in a Web Worker the web build bundles.
COPY shell shell
COPY web web
RUN npm run build --prefix web

FROM node:24-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8755 DATA_DIR=/data
WORKDIR /app
COPY server/package.json server/package-lock.json server/
RUN npm ci --prefix server --omit=dev --no-audit --no-fund
COPY shell shell
COPY server server
# The avatar shapes the link-preview images draw (server/src/card-render.ts).
COPY web/src/game/avatar-gallery.json web/src/game/avatar-gallery.json
COPY --from=web /app/web/dist web/dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8755
CMD ["node", "server/src/index.ts"]
