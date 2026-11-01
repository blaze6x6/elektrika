#!/bin/sh
# Na vsakih 10 min vpraša aplikacijo, ali je zapadel termin mesečnega poročila
# (dan/ura/minuta v Administracija → E-mail). Aplikacija sama odloči in prepreči dvojno pošiljanje.
set -u
APP_URL="${APP_URL:-http://web:3000}"
CRON_SECRET="${CRON_SECRET:-}"
[ -z "${CRON_SECRET}" ] && exit 1
body=$(curl -sS --max-time 120 -X POST "${APP_URL}/api/email/send" \
  -H "Content-Type: application/json" -H "x-cron-secret: ${CRON_SECRET}" \
  -d '{"type":"report","scheduled":true}' 2>&1) || body="napaka: ${body}"
# tiho, razen ko se je kaj zgodilo
case "${body}" in
  *'"skipped":true'*) ;;
  *) echo "[$(date '+%Y-%m-%d %H:%M:%S')] report: ${body}" ;;
esac
