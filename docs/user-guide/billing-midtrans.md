# Midtrans Billing

Nusantara HostPanel v1.0.0 menyediakan adapter Midtrans untuk billing workspace tanpa memindahkan Server Key ke browser.

## Environment

Tambahkan ke `/etc/hostpanel/hostpanel.env`:

```env
PANEL_PUBLIC_URL=https://panel.example.com
MIDTRANS_ENV=sandbox
MIDTRANS_SERVER_KEY=SB-Mid-server-...
MIDTRANS_CLIENT_KEY=SB-Mid-client-...
MIDTRANS_MERCHANT_ID=...
MIDTRANS_RECURRING=0
```

Gunakan `MIDTRANS_ENV=production` hanya setelah sandbox selesai diuji. `MIDTRANS_RECURRING=1` mengaktifkan flow recurring/Subscription API dan membutuhkan fitur recurring/One Click pada merchant Midtrans.

## Notification URL

Atur HTTP Notification URL di dashboard Midtrans ke:

```text
https://panel.example.com/hooks/midtrans
```

HostPanel memverifikasi `signature_key` menggunakan SHA-512, mendeduplikasi event, lalu memanggil GET Status Midtrans sebelum mengubah invoice/subscription. Browser redirect dari Snap tidak dianggap bukti pembayaran.

## Checkout

Workspace owner/admin membuka **Billing & Plans**, memilih plan IDR berbayar, lalu klik **Pay with Midtrans**. HostPanel membuat invoice + `order_id`, meminta Snap token melalui backend, lalu mengarahkan user ke hosted Snap page.

## Recurring

Jika recurring diaktifkan, Snap pertama meminta flow recurring. Setelah transaksi sukses dan token tersimpan, tombol **Enable auto-renew** membuat Subscription API bulanan. Disable/enable dilakukan dari HostPanel; refund tetap dibatasi platform admin.

## Security

- Server Key hanya berada di environment root-owned.
- Webhook signature diverifikasi timing-safe.
- Nominal GET Status harus sama dengan transaction HostPanel.
- Event webhook idempotent.
- Refund hanya platform admin.
- Payment token recurring disimpan terenkripsi dengan vault.
