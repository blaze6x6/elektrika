#!/bin/sh
# ──────────────────────────────────────────────
# Štrom poraba – dnevna sinhronizacija
#  1. sinhronizira tekoči mesec (SolarEdge, MELCloud, MojElektro)
#  2. 1. in 2. v mesecu sinhronizira tudi PREJŠNJI mesec (končni podatki zadnjega dne)
#  3. preveri opozorilo za včerajšnji dan
#  4. 1. v mesecu pošlje mesečno poročilo za prejšnji mesec
# Skripta vrne izhodno kodo 1, če je katerikoli klic spodletel.
# ──────────────────────────────────────────────
set -u

APP_URL="${APP_URL:-http://web:3000}"
CRON_SECRET="${CRON_SECRET:-}"
FAILED=0

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

if [ -z "${CRON_SECRET}" ]; then
  log "❌ CRON_SECRET ni nastavljen – prekinjam."
  exit 1
fi

# call <pot> <json-telo>
call() {
  tmp="/tmp/cron-resp.$$"
  err="/tmp/cron-err.$$"
  code=$(curl -sS --max-time 300 -o "${tmp}" -w '%{http_code}' -X POST "${APP_URL}$1" \
    -H "Content-Type: application/json" \
    -H "x-cron-secret: ${CRON_SECRET}" \
    -d "$2" 2>"${err}") || code="000"
  body=$(cat "${tmp}" 2>/dev/null || true)
  curl_err=$(cat "${err}" 2>/dev/null || true)
  rm -f "${tmp}" "${err}"
  case "${code}" in
    2*) log "✅ $1 [${code}] ${body}" ;;
    *)  log "❌ $1 [${code}] ${body} ${curl_err}"; FAILED=1 ;;
  esac
}

MONTH=$(date '+%Y-%m')
DAY=$(date '+%d')
MONTHS="${MONTH}"

# 5 dni nazaj od 1. ali 2. v mesecu je vedno v prejšnjem mesecu
if [ "${DAY}" -le 2 ]; then
  PREV_MONTH=$(date -d "@$(( $(date +%s) - 5 * 86400 ))" '+%Y-%m')
  MONTHS="${PREV_MONTH} ${MONTH}"
fi

log "=== Dnevna sinhronizacija (${MONTHS}) ==="

for M in ${MONTHS}; do
  call /api/sync "{\"month\":\"${M}\"}"
  call /api/sync/mojelektro "{\"month\":\"${M}\"}"
  sleep 2
done

call /api/email/send '{"type":"alert"}'

if [ "${DAY}" = "01" ]; then
  PREV_MONTH=$(date -d "@$(( $(date +%s) - 5 * 86400 ))" '+%Y-%m')
  log "Pošiljam mesečno poročilo za ${PREV_MONTH}..."
  call /api/email/send "{\"type\":\"report\",\"month\":\"${PREV_MONTH}\"}"
fi

if [ "${FAILED}" -ne 0 ]; then
  log "=== Končano Z NAPAKAMI ==="
  exit 1
fi
log "=== Končano ==="
