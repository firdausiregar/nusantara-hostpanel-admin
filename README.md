# Nusantara HostPanel Admin

**Nusantara HostPanel Admin v1.0.0** adalah self-hosted Node.js SaaS/PaaS dan server control plane yang security-first, multi-workspace, Git-driven, provider-agnostic, dan hemat RAM. Pengalaman project/deploy dibuat sesederhana platform modern seperti Heroku/Vercel, tetapi runtime tetap transparan dan milik operator sendiri: systemd, Nginx, BIND9, MariaDB/phpMyAdmin, dan Let's Encrypt.

Repository: `firdausiregar/nusantara-hostpanel-admin`  
License: MIT  
Production: Debian/Ubuntu + systemd  
Development: Linux/macOS/Windows + Node.js 22/24

> Alur utama: **Connect GitHub → Import Repo → Detect Framework → Atomic Build → Health Gate → Domain/SSL → Monitor → Rollback**.

## Highlights v1.0.0

### Responsive console

- Mobile sidebar/hamburger diperbaiki total: backdrop, close button, `Escape`, body-scroll lock, ARIA state, auto-close ketika menu dipilih, dan sinkronisasi ketika resize.
- Bottom navigation untuk mobile: Home, Projects, Deploy, Monitor, Menu.
- Sidebar desktop tetap mempertahankan seluruh menu lama dan menambah Billing, Preview, Integrations, Alerts, Documentation, serta Release & Updates.
- Production membawa `app.css` + `hostpanel-ui.css` prebuilt agar panel tidak bergantung pada compiler Tailwind saat deploy ke VPS.

### Projects seperti PaaS

- Project Node.js: Start/Stop/Restart, logs, health, metrics, resource guard, environment, workers, cron, files, domains, deployments.
- Startup: Node entry, npm script, atau safe command tanpa shell operator.
- Atomic releases di `releases/<release-id>` dan symlink `current`.
- Health check loopback-only sebelum release diaktifkan.
- Automatic rollback jika release baru gagal health check.
- Manual rollback dari deployment history.
- Node runtime `system`, Node 22, Node 24; Node 20 hanya legacy.
- `MemoryMax`, `CPUQuota`, `TasksMax` per project.

### GitHub import penuh: OAuth + GitHub App

Buka **Integrations → GitHub** lalu **Projects → New Project**.

1. GitHub App (direkomendasikan) memberi akses granular per repository dan installation token sementara untuk private repo.
2. OAuth App tersedia untuk identity/public repo dan dapat diberi scope tambahan bila operator memang membutuhkannya.
3. Fine-grained PAT tetap tersedia sebagai fallback.
4. Pilih repository; HostPanel membaca `package.json`, mendeteksi framework/start/build recommendation, lalu melakukan atomic deploy + health gate.
5. Private repository via GitHub App tidak membutuhkan token project permanen; installation token dibuat saat inspect/deploy.

```env
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
GITHUB_CALLBACK_URL=https://panel.example.com/integrations/github/callback
GITHUB_OAUTH_SCOPE="read:user user:email"
GITHUB_APP_ID=123456
GITHUB_APP_SLUG=nusantara-hostpanel
GITHUB_APP_PRIVATE_KEY_PATH=/etc/hostpanel/github-app.pem
GITHUB_APP_SETUP_URL=https://panel.example.com/integrations/github/app/callback
```

### Midtrans billing production

Billing sekarang memiliki Snap hosted checkout, invoice/transaction mapping, webhook signature verification, GET Status reconciliation, cancel, platform-admin refund, recurring token vault, dan Midtrans Subscription API enable/disable. Paket hanya diaktifkan setelah status server-to-server valid; redirect browser bukan bukti pembayaran.

```env
PANEL_PUBLIC_URL=https://panel.example.com
MIDTRANS_ENV=sandbox
MIDTRANS_SERVER_KEY=...
MIDTRANS_CLIENT_KEY=...
MIDTRANS_MERCHANT_ID=...
MIDTRANS_RECURRING=0
```

Set Notification URL Midtrans ke `https://panel.example.com/hooks/midtrans`. Aktifkan `MIDTRANS_RECURRING=1` hanya bila recurring/One Click sudah diaktifkan pada merchant Midtrans.

### i18n & Notification Center

- Locale per-user tersimpan di database; release membawa Bahasa Indonesia dan English dengan fallback aman.
- Language selector tersedia di topbar.
- Navigation shell, billing, GitHub integration, dan notification inbox menggunakan translation key.
- Notification Center mendukung mark read, delete satu notifikasi, delete selected, delete read, delete all, channel delivery, dan audit log.
- Sidebar/mobile navigation memakai SVG icon konsisten tanpa icon-font/CDN eksternal.

### Auto-deploy & Preview Pull Request

Project dapat membuat signed GitHub webhook. Di GitHub aktifkan event **Pushes** dan **Pull requests**.

- Push ke production branch → idempotent background deployment.
- PR `opened`, `reopened`, `synchronize` → preview environment bila Preview diaktifkan.
- PR `closed` → preview dijadwalkan dihapus.
- Signature `X-Hub-Signature-256`, branch filtering, rate-limit, idempotency key, retry/backoff dan dead-letter queue.

Preview memakai service systemd, port, release directory, env `preview`, health check, logs, dan TTL sendiri. Bila `preview_domain_suffix` disiapkan, Nginx membuat hostname preview; wildcard DNS/SSL dapat dipakai agar tidak menerbitkan sertifikat per-preview.

### SaaS control plane

- Workspace sebagai tenant boundary.
- Role: owner, admin, developer, viewer; platform admin terpisah.
- Workspace status active/suspended; suspended workspace tidak dapat melakukan aksi mutasi.
- Plan, subscription state, invoice metadata, trial/grace/suspend control-plane.
- Quota project/domain/database/storage metadata.
- Team invitations dan RBAC.
- Personal API tokens dengan scope, expiry, hash-at-rest, revoke, last-used.
- Session registry, revoke session, security events.
- TOTP 2FA + recovery codes.
- Password reset token hash-at-rest, expiry, generic anti-enumeration response.

Billing v1.0.0 memiliki adapter Midtrans server-side yang lengkap untuk checkout Snap, webhook/status reconciliation, invoice mapping, cancel/refund, dan optional Subscription API recurring. Server Key tetap berada di environment root-owned.

### Alerts & observability ringan

Tanpa Prometheus/Redis/Elasticsearch wajib.

- CPU/load, RAM, disk, uptime, service state.
- App memory/tasks/restart/PID + health incidents.
- Metric history dengan retention.
- Alert rule: memory, disk, load, unhealthy app, SSL expiry, backup/job failure.
- `duration_min` benar-benar membutuhkan kondisi bertahan selama window tersebut; cooldown mencegah notification storm.
- Notification inbox dan external channel support ketika dikonfigurasi.

### Domain, DNS, SSL

- Nginx reverse proxy ke loopback.
- HTTP→HTTPS, canonical www/non-www, WebSocket, upload limit, proxy timeout, maintenance mode, allowlisted security headers.
- Existing certificate sync dan SAN/wildcard discovery.
- Let's Encrypt HTTP-01 untuk domain biasa.
- Wildcard DNS-01 Cloudflare/RFC2136-BIND TSIG.
- Staging, rate-limit cooldown, renewal/dry-run.
- Admin Panel + phpMyAdmin system SSL.
- BIND9 A/AAAA/CNAME/MX/TXT/NS/CAA/SRV, wildcard owner, serial monotonic, validation/rollback.

### Database, backup & recovery

- MariaDB localhost-only manager.
- Per-workspace database ownership/quota.
- Create/adopt DB, DB user, password rotation, dump `.sql.gz`, restore.
- phpMyAdmin behind Nginx + Basic Auth + controluser repair.
- HostPanel backup with SHA-256 verification.
- Scheduled backup/retention and off-site target via rclone.
- Restore dijalankan sebagai privileged scheduled operation, bukan request web panjang.
- Disaster-recovery docs tersedia di web docs.

### Security boundary

```text
Browser
  ↓
Controller
  ↓
Service
  ↓
Runtime Adapter
  ↓
sudo allowlist
  ↓
hostpanelctl (root-owned)
  ↓
systemd / Nginx / BIND / MariaDB / Certbot
```

- Express berjalan sebagai user `hostpanel`, bukan root.
- Project memakai Linux user terpisah.
- Controller/routes dilarang memanggil `child_process`, `sudo`, `systemctl`, atau helper root secara langsung; architecture checker menolak pelanggaran.
- AES-256-GCM vault dengan `HOSTPANEL_MASTER_KEY` terpisah dari session secret.
- CSRF, Helmet/CSP, secure session, login/action rate-limit, webhook HMAC.
- Health check dipaksa loopback untuk mencegah SSRF.
- File Manager dibatasi ke project root dan menolak symlink/path traversal/sensitive file.
- Tidak ada web root terminal.

## Menu

Seluruh menu lama dipertahankan:

```text
Workspace
  Overview
  Workspaces
  Team & RBAC
  Billing & Plans
  Notifications

Build & Ship
  Projects
  Deployments
  Preview Environments
  Integrations
  Log Center

Network
  Domain & Nginx
  DNS BIND9
  SSL & Renewal

Operations
  Monitoring
  Alerts & Rules
  Backup & Restore
  Layanan Server

Data & Security
  Database Manager
  Security Center
  Platform Settings

Resources
  Documentation
  Release & Updates
```

## Hemat RAM

HostPanel tidak mewajibkan Redis, Docker daemon, Kubernetes, Elasticsearch, atau Prometheus. Web UI, SQLite WAL, job queue, scheduler, metrics retention, alerts dan health sweep berjalan dalam satu Node process. Unit control-plane production memiliki guard RAM/tasks; aplikasi user tetap proses systemd terpisah.

## Supported VPS

Target resmi:

- Debian 12/13;
- Ubuntu 22.04/24.04+;
- amd64/arm64;
- KVM, LXC/container, cloud VM, dedicated VM atau NAT VPS;
- provider apa pun selama requirement di atas tersedia.

Network mode:

```text
NETWORK_MODE=direct
NETWORK_MODE=nat
NETWORK_MODE=proxy
NETWORK_MODE=auto
```

Helipod hanya contoh `nat`; tidak ada provider lock-in.

## Install dari GitHub

Setelah repository dibuat:

```bash
git clone https://github.com/firdausiregar/nusantara-hostpanel-admin.git
cd nusantara-hostpanel-admin
sudo -E bash scripts/install.sh
```

Redeploy versi source baru memakai entry point yang sama:

```bash
cd /root/nusantara-hostpanel-admin
git pull --ff-only
sudo -E bash scripts/install.sh
```

Tidak ada `upgrade-vX.sh`.

Installer melakukan dependency install di **staging directory**. Active `/opt/hostpanel` baru di-swap setelah dependency dan asset validation berhasil. Jika tahap sesudah swap gagal, source control-plane sebelumnya dikembalikan dan service lama dicoba dinyalakan kembali. Persistent data tetap di luar source tree.

## Install ZIP via SSH

```bash
ssh -p 22500 root@109.199.123.180 \
  'cat > /root/nusantara-hostpanel-admin-v1.0.0.zip' \
  < nusantara-hostpanel-admin-v1.0.0.zip
```

Kemudian:

```bash
ssh root@109.199.123.180 -p 22500
cd /root
unzip -o nusantara-hostpanel-admin-v1.0.0.zip
cd nusantara-hostpanel-admin-v1.0.0
sudo -E bash scripts/install.sh
```

State yang tidak dihapus:

```text
/etc/hostpanel
/var/lib/hostpanel
/etc/letsencrypt
/etc/nginx
/nusantara-hostpanel/apps
```

## Non-interactive install

```bash
PANEL_DOMAIN=panel.example.com \
PMA_DOMAIN=db.panel.example.com \
CERTBOT_EMAIL=admin@example.com \
SERVER_IPV4=203.0.113.10 \
NETWORK_MODE=auto \
TLS_MODE=local \
DNS_PUBLIC=auto \
SSH_PORT=22 \
sudo -E bash scripts/install.sh
```

Optional GitHub/docs environment:

```env
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_CALLBACK_URL=https://panel.example.com/integrations/github/callback
GITHUB_OAUTH_SCOPE="read:user user:email"
GITHUB_APP_ID=
GITHUB_APP_SLUG=
GITHUB_APP_PRIVATE_KEY_PATH=/etc/hostpanel/github-app.pem
GITHUB_APP_SETUP_URL=https://panel.example.com/integrations/github/app/callback
MIDTRANS_ENV=sandbox
MIDTRANS_SERVER_KEY=
MIDTRANS_CLIENT_KEY=
MIDTRANS_MERCHANT_ID=
MIDTRANS_RECURRING=0
PANEL_PUBLIC_URL=https://panel.example.com
DOCS_URL=https://firdausiregar.github.io/nusantara-hostpanel-admin/
```

## Development di laptop

```bash
git clone https://github.com/firdausiregar/nusantara-hostpanel-admin.git
cd nusantara-hostpanel-admin
npm install
npm run dev:setup
npm run dev
```

Buka `http://127.0.0.1:3030/setup`.

`HOSTPANEL_RUNTIME_MODE=local` tidak memerlukan root, sudo, systemd, Nginx, BIND9, MariaDB atau Certbot. Privileged actions—including Preview Deploy—disimulasikan dalam `data/local-runtime.json`, sedangkan MVC, SQLite, auth, workspace, vault, migrations, EJS dan responsive UI berjalan nyata.

## Dokumentasi web otomatis

Docs menggunakan MkDocs Material.

```bash
python3 -m venv .venv-docs
. .venv-docs/bin/activate
pip install -r docs/requirements.txt
mkdocs serve
```

Repository berisi:

```text
mkdocs.yml
.readthedocs.yaml
docs/requirements.txt
.github/workflows/docs.yml
.github/workflows/pages.yml
```

- **GitHub Pages**: workflow membangun dan publish docs dari branch `main` setelah Pages diaktifkan untuk GitHub Actions.
- **Read the Docs**: import repository `firdausiregar/nusantara-hostpanel-admin` satu kali. Setelah itu Read the Docs membaca `.readthedocs.yaml` dari repository dan build mengikuti source docs yang sama.
- Panel menu **Documentation** membuka web docs, GitHub, dan `/api/openapi.yaml`.

## Release quality gate

CI Node 22/24 memeriksa:

```text
Hierarchical MVC boundary
JavaScript syntax
Security regression
Bash syntax
CSS/mobile assets
Database migrations
Local runtime boot smoke
Login + /healthz + CSS render
Docs strict build
Production dependency audit
CodeQL / Dependabot
```

Tag `vX.Y.Z` menjalankan release workflow untuk membuat ZIP, TAR.GZ, SHA-256 dan CycloneDX SBOM sebelum GitHub Release dibuat.

> `package-lock.json` sebaiknya di-commit setelah `npm install` berhasil pada mesin dengan akses registry. CI mendukung repo tanpa lockfile untuk bootstrap, tetapi release reproducibility terbaik dicapai dengan lockfile yang committed.

## Docs & security

- `docs/ARCHITECTURE.md`
- `docs/THREAT-MODEL.md`
- `docs/LOCAL-DEVELOPMENT.md`
- `SECURITY.md`
- `SECURITY-AUDIT.md`
- `RELEASE-CHECKLIST.md`
- `CHANGELOG.md`

## License

MIT.

## RBAC menu matrix (v1.0.0)

UI dan backend memakai batas akses berlapis. Menu yang tidak berhak tidak dirender, tetapi direct URL tetap diperiksa di route guard.

| Area | Viewer | Developer | Workspace owner/admin | Platform admin |
| --- | --- | --- | --- | --- |
| Projects / Deployments / Domains / DNS read | ✓ | ✓ | ✓ | ✓ |
| Preview / Logs / Integrations / Alerts | — | ✓ | ✓ | ✓ |
| Team / Billing / Database Manager | — | — | ✓ | ✓ |
| SSL system / Server Monitoring / Server Backup / Services / Platform Settings / Updates | — | — | — | ✓ |
| Personal Security / Docs / Notifications / Workspace switch | ✓ | ✓ | ✓ | ✓ |

Workspace berstatus `suspended` tetap dapat dibaca sesuai role, tetapi operasi mutasi tenant diblokir. Platform admin tetap dapat melakukan recovery.
