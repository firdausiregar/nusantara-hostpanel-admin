# Threat Model

Nusantara HostPanel Admin adalah control plane yang dapat memengaruhi systemd, Nginx, BIND9, MariaDB, Certbot, dan source aplikasi. Karena dampak komprominya tinggi, desain menganggap browser/web process sebagai komponen yang **tidak boleh** memiliki root shell.

## Assets

- session administrator;
- application environment secrets;
- database credentials;
- certificate private keys;
- DNS zone data;
- source code di `/nusantara-hostpanel/apps`;
- root-owned service/network configuration.

## Trust boundaries

```text
Browser
  ↓ HTTP + CSRF/session controls
Express (user hostpanel)
  ↓ validated action
Runtime adapter
  ↓ sudo allowlist
hostpanelctl (root-owned)
  ↓ re-validation
systemd / Nginx / BIND9 / MariaDB / Certbot / Git
```

Local development memutus boundary setelah runtime adapter: privileged action disimulasikan dan tidak memanggil sudo/system service.

## Primary threats and mitigations

- **RCE melalui input admin**: tidak ada generic shell endpoint; helper memakai argument array dan validator allowlist. Custom start command menolak shell operators dan hanya runtime tertentu.
- **Privilege escalation**: web process non-root; sudo hanya ke satu helper root-owned dan action allowlist.
- **Path traversal/symlink escape**: source app wajib berada di `/nusantara-hostpanel/apps`; canonical path diperiksa ulang pada helper.
- **SSRF melalui health check**: host tidak berasal dari input; selalu `127.0.0.1:<validated-port>`.
- **Credential exposure**: app secret tidak disimpan plaintext di SQLite; generated DB/Basic-Auth passwords hanya tampil sekali; sensitive helper input menggunakan stdin bila relevan.
- **Compromised app exhausting host**: optional per-app `MemoryMax`, `CPUQuota`, `TasksMax`, plus systemd sandboxing.
- **DNS misconfiguration**: BIND zone divalidasi sebelum reload dan memiliki rollback.
- **TLS misconfiguration**: Nginx config diuji sebelum reload; wildcard match membaca SAN dan hanya satu DNS label.
- **Supply-chain risk**: Git deploy v1.0.0 hanya public HTTPS GitHub, npm uses `ci`; GitHub Dependabot + CodeQL + CI tersedia. Production operators tetap harus review dependency updates.
- **Destructive backup restore**: one-click restore belum diaktifkan pada v1.0.0 sampai transactional preflight/rollback tersedia.

## Explicit non-goals in v1.0.0

- web terminal/root shell;
- arbitrary remote database users (`%`);
- storing private Git deploy tokens;
- exposing MariaDB publicly;
- pretending a single authoritative DNS server is HA.
