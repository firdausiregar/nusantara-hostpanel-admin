# Nusantara HostPanel Admin

Nusantara HostPanel adalah **self-hosted Node.js SaaS/PaaS + hosting control plane** yang menggabungkan alur Git → build → deploy → domain → SSL → monitor → rollback dengan kontrol Linux transparan.

## Prinsip produk

- Security-first: web process tidak root; privileged action melewati helper allowlist.
- Hemat RAM: SQLite WAL + systemd, tanpa Redis/Kubernetes/Elasticsearch wajib.
- Project-centric: deployment atomic, environment variables, worker, cron, domain, database, logs, backup.
- Provider-agnostic: direct VPS, NAT/port-forward, atau reverse-proxy edge.
- Laptop-safe development: privileged runtime disimulasikan.

Mulai dari [Install](user-guide/install.md) atau [New Project](user-guide/projects.md).
