# syntax=docker/dockerfile:1.7

# ---- 1. build the React client -------------------------------------------------------------
FROM node:22-alpine AS client-build
WORKDIR /build/client
COPY client/package.json client/package-lock.json client/.npmrc ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ---- 2. install production-only server dependencies ----------------------------------------
FROM node:22-alpine AS server-deps
WORKDIR /build/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---- 3. runtime image ---------------------------------------------------------------------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    SERVE_CLIENT=true \
    PORT=5000 \
    UPLOAD_DIR=/data/uploads
WORKDIR /app
COPY --from=server-deps /build/server/node_modules ./server/node_modules
COPY server/package.json ./server/package.json
COPY server/src ./server/src
COPY --from=client-build /build/client/dist ./client/dist

# uploads live on a volume so they survive container re-creation
RUN mkdir -p /data/uploads && chown -R node:node /data /app
VOLUME ["/data/uploads"]
USER node
EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/api/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

WORKDIR /app/server
CMD ["node", "src/server.js"]
