# Quickstart — Debian / Ubuntu VPS

The same provider-agnostic installer is used on supported Debian and Ubuntu hosts:

```bash
sudo -E bash scripts/install.sh
```

Fresh install can be interactive or configured with environment variables:

```bash
PANEL_DOMAIN=panel.example.com \
PMA_DOMAIN=db.panel.example.com \
CERTBOT_EMAIL=admin@example.com \
NS1=ns1.example.com \
NS2=ns2.example.net \
NETWORK_MODE=auto \
TLS_MODE=local \
DNS_PUBLIC=auto \
SSH_PORT=22 \
sudo -E bash scripts/install.sh
```

Network modes:

```text
direct  public IP exists directly on the VPS
nat     provider/router forwards public ports to a private guest IP
proxy   provider/edge proxy terminates or forwards traffic in front of the VPS
auto    installer selects direct/nat when it can do so safely
```

Run after installation:

```bash
sudo bash /opt/hostpanel/scripts/diagnose.sh
```

Laptop development uses `npm run dev` instead of the production installer; see `docs/LOCAL-DEVELOPMENT.md`.
