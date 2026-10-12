# Perintah manual HostPanel dan SSL wildcard

Panduan ini untuk VPS dengan HostPanel yang sudah terpasang, menggunakan:

- Panel: `panel.firda.uz`
- phpMyAdmin: `db.panel.firda.uz`
- Wildcard: `*.panel.firda.uz`
- Email Let's Encrypt: `iam@firda.uz`

Jalankan perintah bertahap di terminal VPS. Ganti `~/nh` jika checkout repo berada di folder lain. DNS kedua layanan harus mengarah ke endpoint VPS dan HTTPS publik port 443 harus mencapai Nginx. Sertifikat wildcard tidak membuat DNS record atau vhost untuk subdomain lain secara otomatis.

## 1. Perbarui installer dan perbaiki instalasi

Pastikan perubahan lokal sudah disimpan sebelum berpindah branch. Jika Git melaporkan konflik atau perubahan lokal, selesaikan terlebih dahulu; jangan menggunakan reset paksa.

```bash
cd ~/nh
git switch main
git pull --ff-only origin main
sudo env AUTO_SSL=0 bash scripts/install.sh
```

Installer mempertahankan konfigurasi instalasi sebelumnya, memperbaiki kepemilikan database SQLite, dan menjalankan health check. `AUTO_SSL=0` menunda penerbitan SSL otomatis karena panduan ini memakai DNS manual.

Pastikan panel hidup sebelum melanjutkan:

```bash
sudo systemctl status hostpanel --no-pager -l
curl -fsS http://127.0.0.1:3030/healthz
```

Jika gagal:

```bash
sudo journalctl -u hostpanel -n 60 --no-pager -l
sudo ls -ld /var/lib/hostpanel
sudo ls -l /var/lib/hostpanel/hostpanel.sqlite*
```

SSL tidak memperbaiki aplikasi yang gagal hidup.

## 2. Backup dan periksa Nginx

```bash
sudo cp -a /etc/nginx "/etc/nginx-backup-$(date +%Y%m%d-%H%M%S)"
sudo nginx -t
```

Jika konfigurasi lama menampilkan error `TLSv1.0.0`, koreksi kedua vhost:

```bash
sudo sed -i 's/TLSv1\.0\.0/TLSv1.2/g' \
  /etc/nginx/sites-available/panel.firda.uz.conf \
  /etc/nginx/sites-available/db.panel.firda.uz.conf
sudo nginx -t
```

Lanjut hanya jika pemeriksaan konfigurasi berhasil.

## 3. Terbitkan sertifikat wildcard melalui DNS manual

Gunakan Certbot yang sudah dipasang installer:

```bash
sudo /opt/certbot/bin/certbot certonly \
  --manual \
  --preferred-challenges dns \
  --agree-tos \
  --email iam@firda.uz \
  --cert-name panel.firda.uz-wildcard \
  -d panel.firda.uz \
  -d '*.panel.firda.uz'
```

Jangan menambahkan `-d db.panel.firda.uz`: domain tersebut sudah tercakup wildcard dan dapat menyebabkan penolakan karena domain redundan. Domain utama `panel.firda.uz` tetap harus ditambahkan karena wildcard tidak mencakup domain utamanya. Wildcard ini juga tidak mencakup domain bertingkat seperti `admin.db.panel.firda.uz`.

Certbot menampilkan nama record TXT dan nilai token. Tambahkan record ke penyedia DNS authoritative yang mengelola zona `firda.uz`.

| Nama lengkap TXT | Name jika penyedia menambahkan zona firda.uz |
| --- | --- |
| `_acme-challenge.panel.firda.uz` | `_acme-challenge.panel` |

Ikuti nama persis yang ditampilkan Certbot. Jangan memasukkan suffix zona dua kali. Jika diminta token kedua untuk nama TXT yang sama, tambahkan record TXT kedua; jangan menimpa token pertama. Pertahankan semua token sampai penerbitan selesai.

Buka terminal kedua untuk mengecek propagasi:

```bash
dig @1.1.1.1 TXT _acme-challenge.panel.firda.uz +short
dig @8.8.8.8 TXT _acme-challenge.panel.firda.uz +short
```

Setelah nilai token yang diminta terlihat, kembali ke Certbot dan tekan Enter. Ulangi penambahan dan pemeriksaan jika Certbot meminta challenge berikutnya. Jika resolver belum menampilkan token, tunggu propagasi sebelum melanjutkan.

Cek sertifikat yang diterbitkan:

```bash
sudo /opt/certbot/bin/certbot certificates
```

## 4. Pasang sertifikat ke panel dan phpMyAdmin

```bash
sudo /opt/certbot/bin/certbot install \
  --nginx \
  --cert-name panel.firda.uz-wildcard
```

Jika Certbot meminta pemilihan vhost, pilih konfigurasi yang sesuai untuk panel dan phpMyAdmin. Jika salah satu hostname belum terpasang, periksa vhost tersebut; jangan mengganti seluruh konfigurasi karena routing panel dan proteksi phpMyAdmin harus dipertahankan.

Kedua vhost HTTPS harus memakai:

```nginx
ssl_certificate /etc/letsencrypt/live/panel.firda.uz-wildcard/fullchain.pem;
ssl_certificate_key /etc/letsencrypt/live/panel.firda.uz-wildcard/privkey.pem;
ssl_protocols TLSv1.2 TLSv1.3;
```

Validasi sebelum reload:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Perbarui alamat publik aplikasi:

```bash
sudo sed -i \
  -e 's|^PANEL_PUBLIC_URL=.*|PANEL_PUBLIC_URL=https://panel.firda.uz|' \
  -e 's|^PHPMYADMIN_URL=.*|PHPMYADMIN_URL=https://db.panel.firda.uz|' \
  /etc/hostpanel/hostpanel.env
sudo systemctl restart hostpanel
```

## 5. Verifikasi

```bash
curl -fsS http://127.0.0.1:3030/healthz
curl -I https://panel.firda.uz
curl -I https://db.panel.firda.uz
sudo systemctl status hostpanel --no-pager -l
```

Respons `401` dari phpMyAdmin wajar jika Basic Auth aktif. Respons `502` dari panel berarti backend perlu diperiksa. Jangan memakai `curl -k` untuk menguji validitas sertifikat.

## 6. Renewal manual

Sertifikat yang diterbitkan dengan DNS manual tidak bisa diperbarui otomatis tanpa authentication hook. Timer Certbot yang dipasang installer tidak bisa mengisi TXT manual; keberadaan timer tidak menjamin renewal sertifikat ini.

Sebelum kedaluwarsa, ulangi perintah penerbitan di langkah 3 menggunakan nama sertifikat yang sama, ikuti challenge TXT baru, kemudian:

```bash
sudo nginx -t && sudo systemctl reload nginx
sudo /opt/certbot/bin/certbot certificates
```

Karena vhost menunjuk path sertifikat yang sama, pemasangan ulang biasanya tidak diperlukan. Jangan menambahkan `--force-renewal` untuk percobaan berulang agar tidak memboroskan batas penerbitan.

Untuk renewal otomatis, gunakan DNS API Cloudflare atau RFC2136 yang didukung skrip `scripts/enable-bootstrap-ssl.sh`, dengan file credentials root-only. Jangan mengunggah token API, private key, atau credentials ke repository.

Referensi:
- https://eff-certbot.readthedocs.io/en/stable/using.html
- https://eff-certbot.readthedocs.io/en/stable/man/certbot.html
