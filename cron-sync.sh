#!/bin/sh
# ──────────────────────────────────────────────
# Štrom poraba – dnevna sinhronizacija
#  1. sinhronizira tekoči mesec (SolarEdge, MELCloud, MojElektro)
#  2. 1. in 2. v mesecu sinhronizira tudi PREJŠNJI mesec (končni podatki zadnjega dne); MojElektro prejšnjega meseca do 10. (zamik podatkov)
#  3. preveri opozorilo za včerajšnji dan
#  (mesečno poročilo ima svoj termin – cron-report.sh, nastavljivo v Administracija → E-mail)
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
PREV_MONTH=$(date -d "@$(( $(date +%s) - 12 * 86400 ))" '+%Y-%m')

# SolarEdge: prejšnji mesec še 1. in 2. v mesecu (zadnji dan dobi končne vrednosti)
# MojElektro: podatki zamujajo nekaj dni → prejšnji mesec dopolnjujemo do 10. v mesecu
SYNC_PREV_ALL=0
SYNC_PREV_MOJ=0
[ "${DAY}" -le 2 ] && SYNC_PREV_ALL=1
[ "${DAY}" -le 10 ] && SYNC_PREV_MOJ=1

log "=== Dnevna sinhronizacija (${MONTH}$([ "${SYNC_PREV_MOJ}" = 1 ] && echo " + MojElektro ${PREV_MONTH}")) ==="

if [ "${SYNC_PREV_ALL}" = 1 ]; then
  call /api/sync "{\"month\":\"${PREV_MONTH}\"}"
fi
if [ "${SYNC_PREV_MOJ}" = 1 ]; then
  call /api/sync/mojelektro "{\"month\":\"${PREV_MONTH}\"}"
fi
call /api/sync "{\"month\":\"${MONTH}\"}"
call /api/sync/mojelektro "{\"month\":\"${MONTH}\"}"
sleep 2

call /api/email/send '{"type":"alert"}'

if [ "${FAILED}" -ne 0 ]; then
  log "=== Končano Z NAPAKAMI ==="
  exit 1
fi
log "=== Končano ==="
