# GitHub Deploy

Nusantara HostPanel menyediakan tiga jalur autentikasi GitHub.

## GitHub App — direkomendasikan untuk private repository

GitHub App memberi akses per-installation/per-repository, installation token berumur pendek, dan tidak perlu menyimpan PAT permanen untuk deploy.

Environment:

```env
GITHUB_APP_ID=123456
GITHUB_APP_SLUG=nusantara-hostpanel
GITHUB_APP_PRIVATE_KEY_PATH=/etc/hostpanel/github-app.pem
GITHUB_APP_SETUP_URL=https://panel.example.com/integrations/github/app/callback
```

Di pengaturan GitHub App, set **Setup URL** ke callback di atas. Permission minimum untuk import/deploy adalah **Repository contents: Read** dan **Metadata: Read**. Tambahkan event Push/Pull request bila GitHub App juga dipakai untuk webhook global.

Buka **Integrations → GitHub → Install GitHub App**, pilih account dan repository yang boleh diakses, lalu import dari **Projects → New Project**.

## OAuth App

OAuth digunakan untuk identitas/repository user. Environment:

```env
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
GITHUB_CALLBACK_URL=https://panel.example.com/integrations/github/callback
GITHUB_OAUTH_SCOPE="read:user user:email"
```

Jika operator sengaja ingin OAuth memiliki akses private repo, `repo` dapat ditambahkan ke scope. Untuk security-first production, GitHub App lebih disarankan karena izin dapat dibatasi per repository.

## Fine-grained PAT

PAT tetap tersedia sebagai fallback. Gunakan fine-grained PAT, batasi ke repository yang dibutuhkan, dan berikan Contents read-only kecuali operasi lain benar-benar diperlukan.

## Import

Setelah terhubung, HostPanel menampilkan repository yang dapat diakses. Klik **Import**, HostPanel membaca `package.json`, mendeteksi Express/Next/Nuxt/Nest/Vite/Node, mengisi build/start recommendation, lalu deploy menggunakan atomic release + health gate.

Untuk private repo yang terhubung via GitHub App, HostPanel membuat installation token sementara saat inspect/deploy. Token tersebut tidak disimpan sebagai credential project permanen.
