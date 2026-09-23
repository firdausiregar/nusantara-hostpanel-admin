# Architecture — Nusantara HostPanel Admin v1.0.0

## Goals

Nusantara HostPanel adalah Node.js-first hosting control plane. UI web tidak mendapatkan shell root. Semua perubahan host production harus melewati adapter runtime dan root-owned allowlisted helper.

## Hierarchical MVC

```text
src/
├── app.js                         # HTTP composition root
├── core/
│   ├── config/                    # configuration + local env loader
│   ├── database/                  # SQLite connection + migrations
│   ├── http/                      # HTTP shared helpers
│   ├── runtime/                   # system/local runtime adapters
│   └── security/                  # cross-module validators
├── middleware/                    # auth, CSRF, flash
├── lib/                           # legacy-compatible shared utilities
└── modules/
    ├── apps/
    │   ├── apps.model.js          # persistence/query only
    │   ├── apps.service.js        # runtime/business orchestration
    │   ├── apps.controller.js     # HTTP request/response
    │   └── apps.routes.js         # URL + middleware mapping
    ├── auth/
    ├── backups/
    ├── dashboard/
    ├── database/
    ├── deployments/
    ├── dns/
    ├── domains/
    ├── monitoring/
    ├── services/
    ├── settings/
    └── ssl/
```

Rule of thumb:
- **Routes** tidak menjalankan SQL atau system command.
- **Controllers** mengubah request menjadi use-case dan response/flash.
- **Services** mengatur business flow + runtime actions.
- **Models** hanya mengurus SQLite persistence/query.
- **Core runtime** adalah satu-satunya abstraction untuk privileged host operations.
- Semua feature module wajib memiliki empat lapisan bernama konsisten: `<module>.model.js`, `<module>.service.js`, `<module>.controller.js`, `<module>.routes.js`.
- CI architecture checker menolak controller/routes yang mengimpor runtime privileged atau `child_process`.

## Runtime adapters

```text
Controller -> Service -> Runtime Adapter
                       ├── system-provider -> sudo -> hostpanelctl -> OS
                       └── local-provider  -> data/local-runtime.json
```

`HOSTPANEL_RUNTIME_MODE=system` digunakan production. `local` dipakai laptop/development dan tidak memanggil sudo/systemd/Nginx/BIND/MariaDB/Certbot.

## Production topology

```text
Internet / Provider Edge
        |
        | public IP | NAT/port-forward | reverse proxy
        v
      Nginx :80/:443
        |
        +-- HostPanel 127.0.0.1:3030 (user hostpanel)
        +-- Node app A 127.0.0.1:4xxx (user hostapps)
        +-- Node app B 127.0.0.1:4xxx (user hostapps)
        +-- PHP-FPM -> phpMyAdmin

BIND9 :53 TCP/UDP (optional authoritative public)
MariaDB 127.0.0.1:3306
```

## Privilege boundary

Web process berjalan sebagai `hostpanel`. Ia hanya dapat memanggil:

```text
sudo -n -- /usr/local/sbin/hostpanelctl <allowlisted-action> [validated args]
```

Helper tidak menyediakan generic `exec`, terminal, atau arbitrary shell string. Domain, port, path `/nusantara-hostpanel/apps`, DNS record, Git repository, database name, branch, npm script, service name, dan health path divalidasi kembali pada trust boundary root helper.

## Persistent state

- `/var/lib/hostpanel`: SQLite/session state.
- `/etc/hostpanel`: runtime config, app env, DNS metadata.
- `/nusantara-hostpanel/apps`: application source.
- `/etc/nginx`: vhosts.
- `/etc/letsencrypt`: certificates.
- `/var/lib/bind/hostpanel`: generated zone files.
- `/var/backups/hostpanel`: backups.

`scripts/install.sh` bersifat install/repair/redeploy dan tidak menghapus persistent state di atas.
