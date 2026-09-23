#!/usr/bin/env bash
set -Eeuo pipefail
[[ ${EUID:-$(id -u)} -eq 0 ]] || { echo 'Jalankan sebagai root.' >&2; exit 1; }
major="${1:-}"
case "$major" in 20) version="${NODE20_VERSION:-20.20.2}"; echo "WARNING: Node 20 is EOL; gunakan hanya untuk legacy migration." >&2 ;; 22) version="${NODE22_VERSION:-22.23.2}" ;; 24) version="${NODE24_VERSION:-24.21.0}" ;; *) echo 'Usage: install-node-runtime.sh 20|22|24' >&2; exit 2 ;; esac
case "$(dpkg --print-architecture)" in amd64) arch=x64 ;; arm64) arch=arm64 ;; *) echo 'Arsitektur belum didukung.' >&2; exit 3 ;; esac
dir="/opt/hostpanel/runtimes/node${major}"
if [[ -x "$dir/bin/node" ]]; then "$dir/bin/node" --version; exit 0; fi
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
cd "$tmp"
base="https://nodejs.org/dist/v${version}"
curl -fsSLO "$base/node-v${version}-linux-${arch}.tar.xz"
curl -fsSLO "$base/SHASUMS256.txt"
grep " node-v${version}-linux-${arch}.tar.xz$" SHASUMS256.txt | sha256sum -c -
mkdir -p "$dir"
tar -xJf "node-v${version}-linux-${arch}.tar.xz" --strip-components=1 -C "$dir"
chown -R root:root "$dir"; chmod -R a+rX "$dir"
"$dir/bin/node" --version
