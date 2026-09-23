# Install

## Git

```bash
git clone https://github.com/firdausiregar/nusantara-hostpanel-admin.git
cd nusantara-hostpanel-admin
sudo -E bash scripts/install.sh
```

## ZIP via SSH

```bash
ssh -p 22500 root@SERVER_IP 'cat > /root/nusantara-hostpanel-admin.zip' < nusantara-hostpanel-admin-v1.0.0.zip
```

Di server, extract lalu jalankan `sudo -E bash scripts/install.sh`. Installer idempotent mempertahankan state persistent HostPanel.
