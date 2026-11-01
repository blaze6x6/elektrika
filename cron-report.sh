#!/bin/sh
# Na vsakih 10 min vpraša aplikacijo, ali je treba kaj narediti za mesečno poročilo
# (dan/ura/minuta v Administracija → E-mail). Aplikacija sama odloči in prepreči dvojno izvajanje:
#  - od 1 h pred terminom: odgovori { "presync": "YYYY-MM" } → sinhronizacija celotnega prejšnjega meseca
#  - ob terminu: pošlje poročilo
set -u
APP_URL="${APP_URL:-http://web:3000}"
CRON_SECRET="${CRON_SECRET:-}"
[ -z "${CRON_SECRET}" ] && exit 1

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

post() { # <pot> <telo>
  curl -sS --max-time 300 -X POST "${APP_URL}$1" \
    -H "Content-Type: application/json" -H "x-cron-secret: ${CRON_SECRET}" -d "$2" 2>&1 || echo "napaka curl"
}

body=$(post /api/email/send '{"type":"report","scheduled":true}')
case "${body}" in
  *'"presync":"'*)
    M=$(echo "${body}" | sed -n 's/.*"presync":"\([0-9-]*\)".*/\1/p')
    log "=== Sinhronizacija pred poročilom (${M}) ==="
    if [ "${REPORT_PRESYNC:-all}" = "mojelektro" ]; then
      log "(samo MojElektro – SolarEdge/MELCloud preskočena)"
    else
      log "sync: $(post /api/sync "{\"month\":\"${M}\"}")"
    fi
    log "mojelektro: $(post /api/sync/mojelektro "{\"month\":\"${M}\"}")"
    ;;
  *'"skipped":true'*) ;;
  *) log "report: ${body}" ;;
esac
