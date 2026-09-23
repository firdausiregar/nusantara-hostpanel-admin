# Security Policy

## Supported releases

Security fixes target the latest release line. Operators should keep the host OS, Node.js, Nginx, BIND9, MariaDB, PHP, Certbot, and Nusantara HostPanel Admin current.

## Reporting a vulnerability

Do **not** publish exploitable details in a public issue. After the repository is published, use GitHub Private Vulnerability Reporting / Security Advisories for `firdausiregar/nusantara-hostpanel-admin`. Include the affected release, impact, safe reproduction steps, and the smallest proof of concept needed to reproduce the issue.

## Security model

- Express production binds to `127.0.0.1` and runs as the unprivileged `hostpanel` user.
- Managed apps run as `hostapps` and bind to loopback ports behind Nginx.
- Root operations are restricted to the root-owned `/usr/local/sbin/hostpanelctl` allowlist through sudo; no browser shell or generic command action is exposed.
- Inputs are revalidated at the privilege boundary, including domains, ports, `/nusantara-hostpanel/apps` paths, DNS records, service names, Git repositories/branches, database names/users, npm scripts, and health paths.
- CSRF, Helmet/CSP, login/action rate limits, audit logging, session expiry, HttpOnly/SameSite cookies, and conditional HTTPS-only HSTS are enabled.
- Production requires a strong random session secret. Administrator passwords use bcrypt and password changes invalidate active sessions.
- App secrets are stored in permission-restricted environment files, not plaintext SQLite fields.
- Database accounts created by the panel are localhost-only and one-time passwords are not persisted for display.
- MariaDB is intended to listen on localhost; the installer does not expose port 3306.
- Git deployment v1.0.0 is limited to public GitHub HTTPS repositories and validated npm scripts; private deploy credentials are deliberately not stored yet.
- App health checks can only target localhost on that app's validated port.
- Managed apps can optionally enforce systemd `MemoryMax`, `CPUQuota`, and `TasksMax` to reduce noisy-neighbor/resource-exhaustion risk.
- Certbot uses the isolated `/opt/certbot` installation and Nginx reloads only after a successful `nginx -t`.
- Backups are created with restrictive permissions and can be SHA-256 verified.

## Local development

`HOSTPANEL_RUNTIME_MODE=local` is a simulator intended for a laptop. It does not invoke sudo, systemd, Nginx, BIND9, MariaDB, or Certbot. Never treat local-simulator success as proof that provider networking or production privileges are correctly configured.

## Operational limitations

`DNS_PUBLIC=1` is appropriate only when both public TCP and UDP port 53 reach BIND9. Authoritative DNS used in production should have redundant nameservers on separate failure domains. Remote MariaDB exposure, generic shell access, and private Git credential storage are intentionally outside the default security model.

See [SECURITY-AUDIT.md](SECURITY.md) for the release review and known limitations, and [docs/THREAT-MODEL.md](THREAT-MODEL.md) for trust boundaries and threat assumptions.
