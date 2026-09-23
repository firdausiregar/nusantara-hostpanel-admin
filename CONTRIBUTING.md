# Contributing

Thanks for contributing to **Nusantara HostPanel Admin**.

Repository target: `https://github.com/firdausiregar/nusantara-hostpanel-admin`

## Architecture rules

- Keep the runtime CommonJS and within the supported Node.js range in `package.json`.
- New product features belong in `src/modules/<feature>/{model,service,controller,routes}`.
- Routes map URLs/middleware only; controllers own HTTP concerns; services orchestrate business/runtime work; models own SQLite access.
- Shared host operations go through `src/core/runtime`, never directly from controllers/views.
- Never run the Express process as root.
- Any new privileged production action must be an explicit `hostpanelctl` allowlist action with independent root-boundary validation.
- Never add a generic web shell, arbitrary `exec`, or unsanitized shell-string execution.
- Nginx/BIND changes must validate before reload and restore the prior valid configuration on failure.
- Never commit credentials, private keys, database dumps, `.env*` secrets, `/etc/hostpanel`, `/var/lib/hostpanel`, or local simulator state.

## Laptop development

```bash
git clone https://github.com/firdausiregar/nusantara-hostpanel-admin.git
cd nusantara-hostpanel-admin
npm install
npm run dev:setup
npm run dev
```

The default development runtime is local/simulated and requires no root services. See `docs/LOCAL-DEVELOPMENT.md`.

## Before a pull request

```bash
npm run check
npm run test:security
for f in scripts/*.sh; do bash -n "$f"; done
```

For host/runtime changes, also test on a disposable supported Debian/Ubuntu VPS. For TLS changes run `nginx -t` and a safe Certbot staging/dry-run flow. For BIND changes run `named-checkconf` and `named-checkzone` through the included diagnostics.

In the PR, state the runtime tested (`local`/`system`) and network topology (`direct`, `nat`, or `proxy`).
