# node:22-bookworm-slim, resolved 2026-11-09
FROM node:22-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d
ENV NODE_ENV=production \
    SHELLHERD_SERVER_DATA=/data \
    SHELLHERD_SERVER_HOST=0.0.0.0 \
    SHELLHERD_SERVER_PORT=8787
WORKDIR /app
COPY server/main.mjs ./server/main.mjs
COPY scripts/sync-prototype/server.mjs scripts/sync-prototype/server-access.mjs scripts/sync-prototype/http-proof.mjs scripts/sync-prototype/account-auth.mjs scripts/sync-prototype/account-init.mjs scripts/sync-prototype/rate-limit.mjs scripts/sync-prototype/vault-file-wire.mjs scripts/sync-prototype/rendezvous.mjs ./scripts/sync-prototype/
COPY src/shared/sync-server-url.mjs ./src/shared/sync-server-url.mjs
RUN mkdir /data && chown node:node /data && chmod 0700 /data
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/v1/info', {signal:AbortSignal.timeout(3000)}).then(async r=>{if(!r.ok || !(await r.json()).rendezvous)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "server/main.mjs"]
CMD ["serve"]
