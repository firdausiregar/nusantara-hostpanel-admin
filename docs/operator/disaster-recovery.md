# Disaster Recovery

1. Siapkan VPS baru dengan OS yang didukung.
2. Install HostPanel dari release yang kompatibel.
3. Restore backup terverifikasi.
4. Verifikasi Nginx/BIND/MariaDB/Certbot dan aplikasi.
5. Ubah DNS/port-forward ke server baru setelah health check sukses.

Jangan mengandalkan backup yang belum pernah diuji restore.
