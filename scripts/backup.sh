#!/usr/bin/env bash
# Back up MongoDB + uploaded files from a running docker compose deployment into ./backups/<timestamp>/
set -euo pipefail
cd "$(dirname "$0")/.."
STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="backups/$STAMP"
mkdir -p "$DEST"

echo "Dumping MongoDB..."
docker compose exec -T mongo mongodump --archive --gzip --db "${MONGO_DB:-student_management}" > "$DEST/mongo.archive.gz"

echo "Archiving uploads..."
docker compose exec -T app tar -C /data -czf - uploads > "$DEST/uploads.tar.gz"

echo "Backup written to $DEST"
