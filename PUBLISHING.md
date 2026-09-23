# Publishing to GitHub

Target repository:

```text
https://github.com/firdausiregar/nusantara-hostpanel-admin
```

## First publish

Create the empty repository on GitHub first, then from the project directory:

```bash
git init
git add .
git commit -m "Nusantara HostPanel Admin v1.0.0"
git branch -M main
git remote add origin https://github.com/firdausiregar/nusantara-hostpanel-admin.git
git push -u origin main
```

Do not commit secrets/runtime state. Review `.gitignore`, `SECURITY.md`, and the diff before the first push.

## Install from Git

```bash
git clone https://github.com/firdausiregar/nusantara-hostpanel-admin.git
cd nusantara-hostpanel-admin
sudo -E bash scripts/install.sh
```

For a later source revision on an already installed server:

```bash
cd /root/nusantara-hostpanel-admin
git pull --ff-only
sudo -E bash scripts/install.sh
```

There are no version-specific `upgrade-vX.sh` scripts. `scripts/install.sh` is the idempotent fresh-install/repair/redeploy entry point.

## Recommended repository settings

Enable branch protection for `main`, require the CI workflow before merge, enable Dependabot/security alerts, enable Private Vulnerability Reporting, and publish signed/tagged releases from reviewed commits.
