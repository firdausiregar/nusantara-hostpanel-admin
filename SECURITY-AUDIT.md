# Security Review — v1.0.0 Full Integrations

This document records the static/configuration security review for the v1.0.0 source tree. It is not a third-party penetration test. The v1.0.0 review is retained below for historical traceability.

## v1.0.0 incremental findings and controls

- Midtrans Server Key remains server-side; browser checkout receives only the hosted Snap redirect/token.
- Midtrans notification signatures use SHA-512 and successful notifications are reconciled against GET Status before plan activation.
- Billing provider events are deduplicated and workspace/amount ownership is revalidated.
- Recurring payment tokens are encrypted at rest; GoPay account tokens may be resolved server-to-server through the Pay Account endpoint.
- GitHub App private keys stay on disk outside SQLite; installation access tokens are minted on demand and are not persisted as long-lived project secrets.
- GitHub OAuth/PAT secrets remain vault-encrypted.
- Notification deletion is workspace-scoped and audited.
- Locale mutation is authenticated and restricted to supported locales.
- Existing role-aware navigation and backend route guards remain in force.

---

# Security Review — v1.0.0 Responsive SaaS/PaaS

Date: 2026-09-22

This document records the security posture reviewed for the v1.0.0 source tree. It is a static/configuration review and does **not** claim to be a third-party penetration test or formal audit.

## Trust boundaries

1. Browser requests terminate at Express running as the unprivileged `hostpanel` user.
2. Application processes run as the separate `hostapps` user.
3. Privileged host changes must pass through the runtime adapter and the root-owned `/usr/local/sbin/hostpanelctl` allowlist.
4. Production applications remain loopback-only behind Nginx.
5. MariaDB is intended to remain bound to localhost unless an operator deliberately changes the hardening model.

## v1.0.0 review findings and controls

- Hierarchical MVC separates HTTP routing, controller logic, business/runtime orchestration, and SQLite persistence.
- `HOSTPANEL_RUNTIME_MODE=local` prevents laptop development from calling sudo/systemd/Nginx/BIND/MariaDB/Certbot.
- Production refuses a short/default session secret; installer generates a cryptographically random secret.
- CSRF protection covers state-changing methods and session cookies are HttpOnly + SameSite=Strict with Secure behavior behind configured HTTPS/trusted proxy.
- CSP is configured without inline script/style requirements; `X-Powered-By` is disabled.
- Password changes require re-authentication and invalidate panel sessions; bcrypt cost remains 12 with the 72-byte bcrypt input limit enforced.
- Privileged helper does not expose a generic shell/exec endpoint. Service names, domains, ports, paths, DNS records, database identifiers, Git repository/branch names, npm script names, and health paths are validated again at the root boundary.
- App source is restricted to `/nusantara-hostpanel/apps`; real paths are checked so symlinks cannot escape the allowed tree.
- App environment secrets live in root-managed `/etc/hostpanel/apps/*.env`, not plaintext SQLite fields, and existing secret values are not rendered back into forms.
- Custom application startup commands are tokenized without a shell and limited to approved runtimes.
- Git deployment v1.0.0 accepts only public `https://github.com/<owner>/<repo>` repositories. No private token/deploy key storage exists yet.
- Initial Git import requires an empty target directory, performs `npm ci`, optional validated npm build script, production prune, then creates the systemd unit. Redeploy checks that `origin` still matches the configured repository.
- Deployment actions are rate-limited and deployment success/failure is written to history/audit logs.
- Health checks are constrained to `127.0.0.1:<validated app port>` and a validated relative HTTP path, preventing arbitrary SSRF destinations.
- Database Manager validates identifiers, creates users only as `@localhost`, generates one-time passwords, and requires exact database-name confirmation before destructive drop.
- MariaDB password material is supplied via stdin/SQL rather than exposed as a process argument where practical.
- Backup files use root-only permissions and verification uses SHA-256 metadata; v1.0.0 intentionally does not expose a destructive one-click restore path.
- BIND9 zone writes are validated with `named-checkzone`/`named-checkconf`, use monotonic SOA serials, normalize SRV FQDN targets, split long TXT values, validate wildcard owners, and roll back failed file/SQLite changes.
- TLS supports ACME preflight/staging/rate-limit cooldown, SAN-based wildcard certificate discovery, manual certificate sync, and an isolated `/opt/certbot` runtime with a deploy hook that validates Nginx before reload.
- Manual DNS-01 certificates without an authentication hook are marked as not automatically renewable rather than giving a false renewal guarantee.
- UFW changes are additive on repair/redeploy; the installer does not intentionally reset an operator's existing default policy.
- Diagnostic and BIND audit scripts are read-only.

## Known limitations intentionally left for later releases

- Private Git repositories are not supported until an encrypted/OS-backed deploy-secret design is implemented.
- Backup restore remains a documented administrator procedure until transactional preflight, rollback, and restore verification are implemented.
- There is no browser terminal or arbitrary shell runner by design.
- One `hostapps` Unix account currently runs managed applications; per-project Unix identities/cgroups are a future hardening target.
- Public authoritative DNS still depends on provider routing for both TCP and UDP port 53 and should use redundant nameservers for serious production use.
- Local runtime is a development simulator, not a security-equivalent replacement for production integration testing.

## Operator verification before production

Run:

```bash
npm run check
npm run test:security
sudo bash /opt/hostpanel/scripts/diagnose.sh
sudo bash /opt/hostpanel/scripts/check-bind9.sh
sudo nginx -t
sudo /opt/certbot/bin/certbot renew --dry-run
```

For security-sensitive changes, test on a disposable VPS before applying them to a production host.

## v1.0.0 incremental findings

- Dashboard tenant leakage fixed: workspace users only receive counts, deployments, and audit activity scoped to the active workspace; global overview is platform-admin only.
- Suspended workspaces cannot perform workspace-level mutations; platform admin retains recovery access.
- Billing invoice-paid mutation is platform-admin only.
- GitHub OAuth defaults to `read:user`; private repository access should use a fine-grained read-only token scoped only to required repositories.
- GitHub webhooks require HMAC SHA-256 signatures, event allowlisting, rate limits and idempotent background jobs.
- Pull-request previews run outside the web process as separate systemd units with isolated ports, bounded memory/tasks and TTL cleanup.
- Installer prepares dependencies in a staging tree before swapping `/opt/hostpanel`; the previous source tree is retained until the new health check passes and is restored on post-swap failure.
- Alert duration windows are enforced from metric samples before notification creation; cooldown protects against repeated notification storms.
