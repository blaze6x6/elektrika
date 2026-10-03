#!/bin/sh
# ──────────────────────────────────────────────
# Energy Dashboard – mesečna sinhronizacija
# + email opozorila + mesečno poročilo
# ──────────────────────────────────────────────

APP_URL="${APP_URL:-http://web:3000}"
CRON_SECRET="${CRON_SECRET:-energy_cron_secret_123}"

# Tekoči mesec (YYYY-MM)
MONTH=$(date '+%Y-%m')
TODAY=$(date '+%d')

echo "[$(date '+%Y-%m-%d %H:%M:%S')] === Dnevna sinhronizacija ==="

# 1. Sync celoten tekoči mesec
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Sinhroniziram mesec ${MONTH}..."
curl -s -X POST "${APP_URL}/api/sync" \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: ${CRON_SECRET}" \
  -d "{\"month\":\"${MONTH}\"}" \
  --max-time 300

echo ""

# 2. Vremenski podatki
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Prenašam vremenske podatke..."
curl -s -X POST "${APP_URL}/api/weather" \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: ${CRON_SECRET}" \
  -d "{\"month\":\"${MONTH}\"}" \
  --max-time 60

echo ""

# 3. Preveri opozorila (vsak dan)
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Preverjam opozorila..."
curl -s -X POST "${APP_URL}/api/email/send" \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: ${CRON_SECRET}" \
  -d "{\"month\":\"${MONTH}\",\"type\":\"alert\",\"secret\":\"${CRON_SECRET}\"}" \
  --max-time 60

echo ""

# 4. Mesečno poročilo (samo 1. v mesecu)
if [ "${TODAY}" = "01" ]; then
  # Pošlji poročilo za prejšnji mesec
  PREV_MONTH=$(date -d "@$(($(date +%s) - 86400))" '+%Y-%m')
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Pošiljam mesečno poročilo za ${PREV_MONTH}..."
  curl -s -X POST "${APP_URL}/api/email/send" \
    -H "Content-Type: application/json" \
    -H "x-cron-secret: ${CRON_SECRET}" \
    -d "{\"month\":\"${PREV_MONTH}\",\"type\":\"report\",\"secret\":\"${CRON_SECRET}\"}" \
    --max-time 60
  echo ""
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] === Končano ==="
