#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo "INFO: install-debian12.sh dipertahankan untuk kompatibilitas. Installer utama sekarang scripts/install.sh"
exec bash "$ROOT_DIR/scripts/install.sh"
