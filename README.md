# PCC Daily Report — Padel Culture Club Bogor

Website laporan operasional harian. Admin membuka satu link, mengisi laporan shift (booking court AYO/manual per court, penjualan & sewa produk, pemasukan lain), menekan **Kirim Laporan**, dan selesai. Data masuk ke Google Sheets, summary dihitung otomatis, dan arsip harian dibuat di folder Google Drive **LAPORAN HARIAN**.

```
Website (GitHub Pages)  ──POST JSON──▶  Google Apps Script (Web App)  ──▶  Google Sheets (database)
index.html + assets/                     apps-script/Code.gs + Logic.gs        └─▶ Google Drive (arsip harian)
```

## Isi folder

| Path | Isi |
|---|---|
| `index.html`, `assets/` | Website (HTML, CSS, JavaScript). Ini yang ditayangkan GitHub Pages. |
| `assets/config.js` | Satu-satunya file yang perlu diubah: `API_URL` dari Apps Script. Tidak berisi rahasia. |
| `apps-script/Code.gs`, `Logic.gs`, `appsscript.json` | Backend Google Apps Script. Ditempel ke editor Apps Script, bukan dijalankan dari GitHub. |
| `shared/logic.js` | Sumber tunggal semua rumus dan validasi. Disalin ke `apps-script/Logic.gs` dan `assets/logic.js` dengan `node tools/sync-logic.js`. |
| `tests/` | Tes otomatis backend + rumus (`node tests/run-tests.js`). |
| `panduan/PANDUAN.md` | Panduan lengkap: struktur database, setup Apps Script, Drive, GitHub, deployment, dan pengujian. |

## Aturan utama

- **Revenue booking** = harga per jam × total jam; **total jam** = jumlah booking × durasi per booking. Satu court boleh punya banyak tarif.
- **Booking court dicatat per hari oleh Shift 2**; penjualan dicatat per shift.
- **Satu laporan per tanggal + shift + nama admin.** Kirim ulang dengan kombinasi yang sama **menimpa** laporan itu (data terakhir yang dipakai); versi lama tetap tercatat di sheet `Audit_Log`.
- **Klik ganda / sinyal putus** tidak membuat data dobel: setiap form punya ID pengiriman unik yang dicek server.
- Semua total dihitung ulang di server dari baris transaksi; sheet `Daily_Summary` hanya berisi rumus.
- Tanpa `API_URL`, website berjalan dalam **mode demo** (data hanya di browser) untuk latihan.

Mulai dari [panduan/PANDUAN.md](panduan/PANDUAN.md).
