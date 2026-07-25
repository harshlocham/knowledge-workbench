#!/bin/sh
set -eu

if [ "${SKIP_DB_MIGRATE:-0}" != "1" ]; then
  echo "[entrypoint] Running database migrations..."
  bun run db:migrate
fi

echo "[entrypoint] Starting Knowledge Workbench on ${HOST:-0.0.0.0}:${PORT:-3000}"
exec bun run .output/server/index.mjs
