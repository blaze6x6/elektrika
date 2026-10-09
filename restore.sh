#!/usr/bin/env bash
# ──────────────────────────────────────────────
# Štrom poraba – obnova baze iz kopije
# Uporaba:  ./restore.sh backups/energydb_backup_20261008_031500.sql.gz
# OPOZORILO: prepiše vse trenutne podatke v bazi.
# ──────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")"

FILE="${1:-}"
if [ -z "${FILE}" ] || [ ! -f "${FILE}" ]; then
  echo "Uporaba: $0 <datoteka.sql.gz>" >&2
  exit 1
fi
gzip -t "${FILE}"

env_get() { grep -E "^$1=" .env 2>/dev/null | tail -n1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//' || true; }
DB_USER="${DB_USER:-$(env_get DB_USER)}"; DB_USER="${DB_USER:-energy_user}"
DB_NAME="${DB_NAME:-$(env_get DB_NAME)}"; DB_NAME="${DB_NAME:-energydb}"

echo "To bo PREPISALO bazo '${DB_NAME}' s podatki iz ${FILE}."
read -r -p "Za nadaljevanje vpiši 'da': " ANSWER
[ "${ANSWER}" = "da" ] || { echo "Prekinjeno."; exit 1; }

echo "Ustavljam aplikacijo in cron..."
docker compose stop web cron

echo "Obnavljam..."
gunzip -c "${FILE}" | docker compose exec -T db psql -U "${DB_USER}" -d "${DB_NAME}" -v ON_ERROR_STOP=1 --single-transaction -q

echo "Zaganjam aplikacijo..."
docker compose start web cron
echo "✅ Obnova končana."
