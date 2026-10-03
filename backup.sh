#!/bin/sh
# ──────────────────────────────────────────────
# Energy Dashboard – Varnostna kopija baze
# ──────────────────────────────────────────────
# Uporaba:
#   ./backup.sh               → v ./backups/
#   ./backup.sh /mnt/nas/     → na zunanji disk
# ──────────────────────────────────────────────

BACKUP_DIR="${1:-./backups}"
TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
FILENAME="energydb_backup_${TIMESTAMP}.sql.gz"

mkdir -p "${BACKUP_DIR}"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Ustvarjam varnostno kopijo..."

docker compose exec -T db pg_dump -U "${DB_USER:-energy_user}" "${DB_NAME:-energydb}" | gzip > "${BACKUP_DIR}/${FILENAME}"

if [ $? -eq 0 ]; then
  SIZE=$(ls -lh "${BACKUP_DIR}/${FILENAME}" | awk '{print $5}')
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✅ Backup ustvarjen: ${BACKUP_DIR}/${FILENAME} (${SIZE})"

  # Ohrani samo zadnjih 30 backupov
  cd "${BACKUP_DIR}" && ls -t energydb_backup_*.sql.gz 2>/dev/null | tail -n +31 | xargs -r rm
  echo "   Stari backupi počiščeni (ohranjih zadnjih 30)."
else
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ❌ Backup neuspešen!"
  exit 1
fi
