#!/usr/bin/env bash
# ──────────────────────────────────────────────
# Štrom poraba – varnostna kopija baze
# ──────────────────────────────────────────────
# Uporaba:
#   ./backup.sh                 → v ./backups/
#   ./backup.sh /mnt/nas/       → v drugo mapo
#   KEEP=60 ./backup.sh         → ohrani zadnjih 60 kopij (privzeto 30)
#
# Primer cron vnosa (vsako noč ob 3:15):
#   15 3 * * * cd /pot/do/projekta && ./backup.sh /mnt/nas/elektrika >> backup.log 2>&1
#
# Skripta se ustavi ob KATERIKOLI napaki (tudi pg_dump v cevovodu) in nikoli
# ne pusti pol-zapisane datoteke kot veljavne kopije.
set -euo pipefail
cd "$(dirname "$0")"

BACKUP_DIR="${1:-./backups}"
KEEP="${KEEP:-30}"

# DB_USER / DB_NAME: iz okolja, sicer iz .env (brez izvajanja .env kot kode)
env_get() { grep -E "^$1=" .env 2>/dev/null | tail -n1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//' || true; }
DB_USER="${DB_USER:-$(env_get DB_USER)}"; DB_USER="${DB_USER:-energy_user}"
DB_NAME="${DB_NAME:-$(env_get DB_NAME)}"; DB_NAME="${DB_NAME:-energydb}"

ts() { date '+%Y-%m-%d %H:%M:%S'; }
FILE="${BACKUP_DIR}/energydb_backup_$(date '+%Y%m%d_%H%M%S').sql.gz"
TMP="${FILE}.partial"

umask 077
mkdir -p "${BACKUP_DIR}"
trap 'rm -f "${TMP}"' EXIT

echo "[$(ts)] Ustvarjam varnostno kopijo (${DB_NAME})..."
docker compose exec -T db pg_dump -U "${DB_USER}" -d "${DB_NAME}" --no-owner --clean --if-exists | gzip > "${TMP}"

# Preverba: veljaven gzip in vsaj nekaj vsebine
gzip -t "${TMP}"
SIZE_BYTES=$(wc -c < "${TMP}")
if [ "${SIZE_BYTES}" -lt 500 ]; then
  echo "[$(ts)] ❌ Kopija je sumljivo majhna (${SIZE_BYTES} B) – zavračam." >&2
  exit 1
fi

mv "${TMP}" "${FILE}"
trap - EXIT
echo "[$(ts)] ✅ Backup ustvarjen: ${FILE} ($(du -h "${FILE}" | cut -f1))"

# Ohrani samo zadnjih $KEEP kopij
ls -1t "${BACKUP_DIR}"/energydb_backup_*.sql.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f --
echo "[$(ts)]    Stare kopije počiščene (ohranjenih zadnjih ${KEEP})."
