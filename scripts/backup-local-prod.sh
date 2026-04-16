#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${ROOT_DIR}/backups/$(date +"%Y%m%d-%H%M%S")"

mkdir -p "${BACKUP_DIR}"

if [ -f "${ROOT_DIR}/soulmate.db" ]; then
  cp "${ROOT_DIR}/soulmate.db" "${BACKUP_DIR}/"
fi

if [ -f "${ROOT_DIR}/soulmate.db-wal" ]; then
  cp "${ROOT_DIR}/soulmate.db-wal" "${BACKUP_DIR}/"
fi

if [ -f "${ROOT_DIR}/soulmate.db-shm" ]; then
  cp "${ROOT_DIR}/soulmate.db-shm" "${BACKUP_DIR}/"
fi

if [ -d "${ROOT_DIR}/generated-media" ]; then
  tar -czf "${BACKUP_DIR}/generated-media.tar.gz" -C "${ROOT_DIR}" generated-media
fi

echo "Backup created at ${BACKUP_DIR}"
