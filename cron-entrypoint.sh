#!/bin/sh
set -eu

TZ="${TZ:-Europe/Ljubljana}"
if [ -f "/usr/share/zoneinfo/${TZ}" ]; then
  cp "/usr/share/zoneinfo/${TZ}" /etc/localtime
  echo "${TZ}" > /etc/timezone
fi

# Urnik (cron sintaksa, privzeto vsak dan ob 4:00)
SYNC_SCHEDULE="${SYNC_SCHEDULE:-0 4 * * *}"
if ! echo "${SYNC_SCHEDULE}" | grep -Eq '^[0-9*/,-]+( [0-9*/,-]+){4}$'; then
  echo "❌ Neveljaven SYNC_SCHEDULE: '${SYNC_SCHEDULE}'" >&2
  exit 1
fi

# Izpis gre na stdout glavnega procesa -> viden z `docker compose logs cron`
echo "${SYNC_SCHEDULE} /app/cron-sync.sh > /proc/1/fd/1 2>&1" > /etc/crontabs/root
echo "⏰ Cron zagnan: '${SYNC_SCHEDULE}' (${TZ})"
exec crond -f -l 6
