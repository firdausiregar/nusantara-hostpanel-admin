# Local Development

Local development tidak membutuhkan root, systemd, Nginx, BIND9, MariaDB, phpMyAdmin, atau Certbot.

## Requirements

- Node.js 22 LTS atau 24 LTS (Node 24 direkomendasikan agar sama dengan production installer).
- npm.
- compiler/toolchain yang dibutuhkan native SQLite package pada OS Anda.

## Start

```bash
git clone https://github.com/firdausiregar/nusantara-hostpanel-admin.git
cd nusantara-hostpanel-admin
npm install
npm run dev:setup
npm run dev
```

Buka:

```text
http://127.0.0.1:3030/setup
```

Buat administrator lokal pertama. `.env.local` dibuat otomatis dan di-ignore Git.

## How simulation works

Development default:

```env
NODE_ENV=development
HOSTPANEL_RUNTIME_MODE=local
TLS_MODE=off
DNS_PUBLIC=0
```

Aksi seperti restart service, Nginx route, BIND sync, certificate, backup, MariaDB, monitoring, dan deployment disimulasikan oleh `src/core/runtime/local-provider.js`. State mock disimpan di:

```text
data/local-runtime.json
```

SQLite aplikasi tetap nyata di folder `data/`, jadi model/controller/view/migration dapat dikembangkan seperti production.

## Reset local state

```bash
rm -rf data .env.local
npm run dev:setup
```

Jangan menjalankan `HOSTPANEL_RUNTIME_MODE=system` di laptop kecuali Anda benar-benar menyiapkan root helper dan service production.
