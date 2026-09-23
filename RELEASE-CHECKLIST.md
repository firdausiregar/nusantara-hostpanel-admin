# Production Release Checklist

## Source & version
- [ ] `package.json` dan `src/core/config/index.js` memiliki versi yang sama.
- [ ] CHANGELOG berisi release baru.
- [ ] Tidak ada secret, `.env`, database runtime, backup atau token dalam Git.
- [ ] Bila tersedia, `package-lock.json` sudah di-refresh dan committed.

## Automated gates
- [ ] `npm run check`
- [ ] `npm run test:security`
- [ ] `npm run check:assets`
- [ ] `npm run check:migrations`
- [ ] `npm run smoke:local`
- [ ] `npm run css:build && npm run check:assets`
- [ ] `npm audit --omit=dev --audit-level=high`
- [ ] `mkdocs build --strict`
- [ ] `for f in scripts/*.sh; do bash -n "$f"; done`

## UI smoke
- [ ] Login desktop.
- [ ] Login mobile.
- [ ] Hamburger open/close/backdrop/Escape bekerja.
- [ ] Bottom navigation mobile bekerja.
- [ ] Projects/New Project/Integrations/Preview/Alerts/Billing/Docs render tanpa error.
- [ ] CSS `app.css` dan `hostpanel-ui.css` HTTP 200.

## Project/deployment smoke
- [ ] Import public GitHub repo.
- [ ] Private credential tersimpan tanpa tampil kembali.
- [ ] Atomic deploy sukses + health gate.
- [ ] Failed health menghasilkan rollback.
- [ ] Signed push webhook membuat satu idempotent deploy.
- [ ] PR preview create/log/remove bekerja.

## Security/tenancy
- [ ] Viewer tidak dapat melakukan mutation.
- [ ] Suspended workspace tidak dapat mutation.
- [ ] Workspace admin tidak dapat menandai invoice paid.
- [ ] Platform admin recovery tetap bekerja.
- [ ] Controller/routes tidak melewati service/runtime boundary.
- [ ] File/path/health/webhook validation tests hijau.

## Installer/recovery
- [ ] Fresh Debian/Ubuntu VM.
- [ ] Existing install redeploy tanpa kehilangan `/etc/hostpanel`, `/var/lib/hostpanel`, `/etc/letsencrypt`, `/etc/nginx`, `/nusantara-hostpanel/apps`.
- [ ] Simulasikan npm staging failure: active source tidak berubah.
- [ ] Simulasikan failure setelah code swap: previous source rollback bekerja.
- [ ] Backup + restore test pada environment non-production.

## Documentation/release
- [ ] GitHub Pages build hijau.
- [ ] `.readthedocs.yaml` build hijau setelah repo di-import.
- [ ] OpenAPI YAML dapat diakses.
- [ ] Tag `vX.Y.Z` menghasilkan ZIP/TAR/SHA-256/SBOM.
