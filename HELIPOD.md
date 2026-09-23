# Provider example — Helipod / NAT VPS

Nusantara HostPanel Admin is provider-agnostic. Helipod is documented only as one example of a NAT/public-endpoint topology.

```bash
NETWORK_MODE=nat \
TLS_MODE=local \
DNS_PUBLIC=0 \
sudo -E bash scripts/install.sh
```

For local TLS, map public traffic to the guest:

```text
HTTP  80  -> guest/internal 80
HTTPS 443 -> guest/internal 443
```

Managed Node apps remain on `127.0.0.1:<port>` and do not need separate public endpoints.

If the provider cannot forward **both TCP and UDP port 53**, keep `DNS_PUBLIC=0` and use an external authoritative DNS provider. Opening UFW alone does not make BIND9 reachable through provider NAT.

The same `scripts/install.sh` is used for fresh installation, repair, and redeploy; there is no Helipod-specific product fork.
