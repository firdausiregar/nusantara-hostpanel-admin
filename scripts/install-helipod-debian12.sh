#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export NETWORK_MODE="${NETWORK_MODE:-nat}"
export TLS_MODE="${TLS_MODE:-local}"
export DNS_PUBLIC="${DNS_PUBLIC:-0}"
export TRUST_PROXY="${TRUST_PROXY:-1}"
export AUTO_SSL="${AUTO_SSL:-0}"
echo "INFO: wrapper Helipod tetap tersedia, tetapi HostPanel sekarang provider-agnostic."
exec bash "$ROOT_DIR/scripts/install.sh"
