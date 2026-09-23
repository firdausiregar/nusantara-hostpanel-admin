# Preview Environments

Preview menjalankan branch/PR Git sebagai service systemd terpisah dengan port, build directory, environment `preview`, health check, log, dan TTL sendiri. Preview tidak berjalan di process HostPanel.

Jika `preview_domain_suffix` diisi, HostPanel membuat Nginx proxy untuk hostname preview. Untuk HTTPS tanpa issuance per-preview, siapkan wildcard DNS + wildcard certificate pada suffix tersebut.

Preview otomatis dapat dibuat dari event GitHub Pull Request dan dibersihkan ketika PR ditutup atau TTL berakhir. Resource preview dibatasi dan dikelola melalui background job queue sehingga request webhook tidak menahan build panjang.
