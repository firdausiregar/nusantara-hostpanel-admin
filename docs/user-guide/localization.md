# Multi-language / i18n

v1.0.0 membawa localization core dengan fallback deterministic. Locale yang dikirim dalam release adalah:

- `id` — Bahasa Indonesia (default)
- `en` — English

Pilihan user tersimpan di kolom `users.locale` dan tersedia dari language selector di topbar. Navigation, shell, Billing, GitHub Integration, dan Notification Center memakai translation key. View lama yang belum memiliki key khusus tetap aman menggunakan teks Indonesia sebagai fallback.

Translation catalog ada di:

```text
src/locales/id.json
src/locales/en.json
```

Untuk menambah bahasa baru, tambahkan JSON catalog, masukkan locale ke `src/core/i18n/index.js`, jalankan quality gate, lalu tambahkan test key coverage sebelum release.
