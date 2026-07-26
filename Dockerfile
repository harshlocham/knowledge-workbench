FROM oven/bun:1.3.6 AS deps
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM deps AS builder
WORKDIR /app

COPY . .

# Clerk publishable key is baked into the client bundle at build time.
ARG VITE_CLERK_PUBLISHABLE_KEY
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY

RUN bun run build

FROM oven/bun:1.3.6 AS runner
WORKDIR /app

ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  PORT=3000 \
  UPLOAD_DIR=/app/uploads \
  YT_DLP_PATH=/usr/local/bin/yt-dlp

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 ca-certificates curl \
  && curl -fsSL -o /usr/local/bin/yt-dlp \
    https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 app \
  && useradd --system --uid 1001 --gid app --home-dir /app --shell /usr/sbin/nologin app \
  && mkdir -p /app/uploads \
  && chown -R app:app /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production \
  && chown -R app:app /app/node_modules

COPY --from=builder --chown=app:app /app/.output ./.output
COPY --from=builder --chown=app:app /app/drizzle ./drizzle
COPY --from=builder --chown=app:app /app/drizzle.config.ts ./drizzle.config.ts
COPY --chown=app:app docker/entrypoint.sh ./docker/entrypoint.sh

RUN chmod +x ./docker/entrypoint.sh

USER app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./docker/entrypoint.sh"]
