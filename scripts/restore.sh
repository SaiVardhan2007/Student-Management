#!/usr/bin/env bash
# Restore a backup made by scripts/backup.sh:   scripts/restore.sh backups/20260101-120000
# WARNING: replaces the current database contents and uploaded files.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="${1:?Usage: scripts/restore.sh backups/<timestamp>}"
[ -f "$SRC/mongo.archive.gz" ] || { echo "No mongo.archive.gz in $SRC" >&2; exit 1; }

read -r -p "This will overwrite the current data. Type 'yes' to continue: " ANSWER
[ "$ANSWER" = "yes" ] || { echo "Aborted."; exit 1; }

docker compose exec -T mongo mongorestore --archive --gzip --drop < "$SRC/mongo.archive.gz"
if [ -f "$SRC/uploads.tar.gz" ]; then
  docker compose exec -T app sh -c 'rm -rf /data/uploads/* && tar -C /data -xzf -' < "$SRC/uploads.tar.gz"
fi
echo "Restore complete."
