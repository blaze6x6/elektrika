#!/bin/sh
set -eu

echo "=========================================="
echo "  Štrom poraba – zagon"
echo "=========================================="

if [ -z "${DATABASE_URL:-}" ]; then
  echo "❌ DATABASE_URL ni nastavljen" >&2
  exit 1
fi

# ── 1. Počakaj na PostgreSQL ──
echo "⏳ Čakam, da je PostgreSQL pripravljen..."
MAX_RETRIES=30
RETRY=0
until node -e "
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000 });
  pool.query('SELECT 1')
    .then(() => { pool.end(); process.exit(0); })
    .catch(() => { pool.end(); process.exit(1); });
" 2>/dev/null; do
  RETRY=$((RETRY + 1))
  if [ "$RETRY" -ge "$MAX_RETRIES" ]; then
    echo "❌ PostgreSQL ni dosegljiv po ${MAX_RETRIES} poskusih. Preveri DATABASE_URL." >&2
    exit 1
  fi
  sleep 2
done
echo "✅ PostgreSQL je pripravljen"

# ── 2. Preveri konfiguracijo, migriraj, seedaj ──
node scripts/init-db.js

# ── 3. Zaženi aplikacijo ──
echo "🚀 Zaganjam na portu ${PORT:-3000}"
exec node server.js
