# Panduan PCC Daily Report

Urutan pemasangan (sekitar 30–45 menit, sekali saja):

1. [Buat database Google Sheets](#1-buat-database-google-sheets)
2. [Pasang Google Apps Script](#2-pasang-google-apps-script)
3. [Isi Script Properties (PIN dan folder Drive)](#3-isi-script-properties)
4. [Deploy sebagai Web App](#4-deploy-sebagai-web-app)
5. [Hubungkan website ke Apps Script](#5-hubungkan-website)
6. [Upload ke GitHub dan aktifkan GitHub Pages](#6-upload-ke-github-dan-github-pages)
7. [Uji sistem](#7-pengujian)

Semua langkah dilakukan dengan **akun Google PCC** (pemilik folder LAPORAN HARIAN), supaya database, script, dan arsip ada di Drive PCC.

---

## Ringkasan alur data

| Saat admin… | Yang terjadi |
|---|---|
| Membuka website | Website meminta PIN, lalu mengambil daftar produk, shift, dan metode bayar dari sheet `Master_Produk` dan `Config`. |
| Mengisi form | Draft tersimpan otomatis di HP/laptop itu. Kalau halaman tertutup, isian tidak hilang. |
| Menekan **Kirim Laporan** | Apps Script memvalidasi, menghitung ulang semua total, menulis ke `Reports`, `Court_Bookings`, `Sales`, `Other_Income`, mencatat `Audit_Log`, lalu memperbarui arsip harian di Drive. |
| Kirim ulang (tanggal + shift + nama sama) | Laporan lama diganti seluruhnya, versi naik (v2, v3, …), versi lama tetap ada di `Audit_Log`. Website memperingatkan dulu sebelum menimpa. |
| Shift 1 mengirim laporan | Hanya berisi penjualan (dan pemasukan lain). Halaman Booking Court dilewati. |
| Shift 2 mengirim laporan | Berisi penjualan Shift 2 **dan booking court satu hari penuh**. Tersimpan sebagai laporan terpisah di file yang sama; summary harian menjumlahkan kedua shift. Kalau Shift 1 mencoba mengisi booking court, server menolak supaya tidak terhitung dua kali. |

## Struktur database (Google Sheets)

Dibuat otomatis oleh fungsi `setup()`.

| Sheet | Isi | Diisi oleh |
|---|---|---|
| `Reports` | Satu baris per laporan shift: `report_id`, `report_key` (tanggal\|shift\|nama), tanggal, shift, admin, catatan, status, versi, waktu dibuat/diperbarui, ID pengiriman terakhir, semua total (revenue AYO/Manual per court, sales, lain-lain, grand total, booking & jam per court), link arsip | Sistem |
| `Court_Bookings` | Satu baris per tarif: report_id, tanggal, shift, admin, court, kategori (AYO/Manual), harga, jumlah booking, durasi, total jam, revenue, metode | Sistem |
| `Sales` | Satu baris per produk terjual: produk, harga, harga modal, qty, total, margin, metode | Sistem |
| `Other_Income` | Pemasukan lain: keterangan, nominal, metode | Sistem |
| `Audit_Log` | Setiap kirim (CREATE/UPDATE) dengan isi lengkap laporan dalam JSON. Jejak koreksi. | Sistem |
| `Daily_Summary` | Rekap per tanggal **dari rumus** (SUMIFS ke sheet transaksi): revenue AYO, Manual, court, sales, lain-lain, grand total, booking & jam per court | Rumus |
| `Archive_Index` | Tanggal → file arsip di Drive | Sistem |
| `Master_Produk` | Daftar produk, harga jual, harga modal, aktif (TRUE/FALSE). Diisi awal dari laporan 15 Nov 2026. | **Owner/manajer** |
| `Config` | Shift, metode bayar, saran nama admin, nama court, saran harga booking, batas jam per court, `COURT_SHIFT` (shift yang mencatat booking court; default `Shift 2`, kosongkan bila semua shift boleh) | **Owner/manajer** |

Jangan mengetik manual di sheet yang diisi sistem. Ubah produk atau harga lewat `Master_Produk`; perubahan muncul di website setelah halaman dimuat ulang.

File `LAPORAN PEMASUKAN *.xlsx` yang sudah ada **tidak disentuh**. Apps Script tidak bisa menulis ke file .xlsx, jadi database memakai Google Sheet baru.

---

## 1. Buat database Google Sheets

1. Buka [drive.google.com](https://drive.google.com) dengan akun PCC.
2. Masuk ke folder tempat menyimpan file sistem (boleh folder induk dari **LAPORAN HARIAN**).
3. **New → Google Sheets → Blank spreadsheet**. Beri nama: `PCC Daily Report – Database`.

## 2. Pasang Google Apps Script

1. Di spreadsheet tadi: **Extensions → Apps Script**.
2. Di editor, hapus seluruh isi `Code.gs`, lalu tempel **seluruh isi file `apps-script/SALIN-KE-APPS-SCRIPT.gs`** (satu file berisi semua backend, sudah dalam urutan yang benar).
3. Klik ikon gerigi **Project Settings** → *Time zone* pilih **(GMT+07:00) Jakarta**. Kembali ke Editor, klik **Save** (ikon disket).
4. Di dropdown fungsi pilih `setup`, klik **Run**.
5. Google akan meminta izin: **Review permissions → pilih akun PCC → Advanced → Go to project (unsafe) → Allow**. Peringatan "unsafe" muncul karena script ini milik Anda sendiri dan belum diverifikasi Google; itu normal.
6. Kembali ke spreadsheet dan muat ulang halaman: sekarang ada sheet `Reports`, `Court_Bookings`, `Sales`, `Other_Income`, `Audit_Log`, `Master_Produk` (29 produk), `Config`, `Daily_Summary`, `Archive_Index`, **`Rekap Bulanan`**, dan menu baru **PCC** di bilah menu.

## 3. Isi Script Properties

PIN dan ID folder **tidak** ditulis di kode supaya tidak ikut ke GitHub.

1. Di editor Apps Script: **Project Settings → Script properties → Add script property**.
2. Isi:

| Property | Nilai | Keterangan |
|---|---|---|
| `ACCESS_PIN` | PIN pilihan Anda, mis. 6 digit | Wajib. Dibagikan hanya ke admin & manajemen. |
| `ARCHIVE_FOLDER_ID` | ID folder **LAPORAN HARIAN** | Ambil dari URL folder: `drive.google.com/drive/folders/`**`INI_ID_NYA`**. Kosongkan kalau belum mau arsip. |
| `ARCHIVE_MONTH_FOLDERS` | `false` | `true` jika arsip mau dipisah per subfolder bulan (mis. `NOVEMBER 2026`). Default `false` mengikuti struktur folder sekarang (file per tanggal langsung di LAPORAN HARIAN). |
| `REKAP_FOLDER_ID` | ID folder **Laporan Bulanan** | Tempat file `REKAP BULAN … (WEB)`. |
| `DAILY_TEMPLATE_ID` | ID Google Sheet **TEMPLATE LAPORAN PEMASUKAN (WEB) - JANGAN DIHAPUS** | File harian dibuat dari salinan template ini (format persis LAPORAN PEMASUKAN milik PCC), lalu sel input diisi otomatis. Hari tanpa penjualan tetap keluar lengkap dengan angka 0. Untuk mengganti format: simpan file .xlsx baru sebagai Google Sheet, isi ID-nya di sini, jalankan `prepareDailyTemplate` lalu `rebuildAllArchives` dari editor. |
| `INVENTORY_TEMPLATE_ID` | ID Google Sheet **TEMPLATE INVENTORY STOKIES (WEB) - JANGAN DIHAPUS** | Setiap laporan menulis total Shift 1 + Shift 2 per produk ke kolom **Qty Keluar** di `INVENTORY STOKIES <BULAN> (WEB)` (folder bulan). File bulan baru dibuat otomatis dari template, stok awal = Sisa Stok bulan lalu. Qty Masuk, Complementary dan Keterangan tetap diisi admin. Untuk mengisi ulang satu bulan: jalankan `rebuildInventoryMonth` dari editor. Produk Minuman/Snack baru di Master_Produk: jalankan `addInventoryProducts` (tab baru di template + file bulan ini; isi stok awalnya di baris 7). |
| `REPORT_ROOT_FOLDER_ID` | ID folder **Report PCC Bogor** | **Disarankan.** Kalau diisi, tiga properti di atas diabaikan: arsip harian otomatis masuk `LAPORAN 2026/NOVEMBER 2026/LAPORAN HARIAN`, rekap ke `LAPORAN 2026/NOVEMBER 2026/Laporan Bulanan`. Folder tahun/bulan yang belum ada dibuat otomatis. Setelah mengisi, jalankan `moveAllToReportFolder` sekali dari editor untuk memindahkan file lama (termasuk database ke `LAPORAN <tahun>`). |
| `WA_TARGET` | Nomor WhatsApp penerima rekap, mis. `628xxxxxxxxxx` | Dipakai tombol "Kirim rekap ke WhatsApp". Tidak disimpan di GitHub. |
| `WA_TOKEN` | Token device Fonnte (opsional) | Isi hanya jika rekap mau terkirim **otomatis** tanpa menekan tombol. Lihat bagian WhatsApp. |

3. **Save script properties**.

Arsip yang dibuat: Google Sheet bernama `LAPORAN PEMASUKAN 17 NOVEMBER 2026 (WEB)` dengan tab **Summary**, **Booking Lapang**, **Penjualan & Penyewaan**, **Pemasukan Lain**. Satu file per tanggal, berisi gabungan semua shift, diperbarui setiap ada laporan masuk atau koreksi. Akhiran "(WEB)" membedakannya dari file .xlsx manual yang sudah ada.

## Rekap Bulanan

Sheet **`Rekap Bulanan`** mengikuti format **REKAP BULAN OKTOBER**: satu baris per tanggal dengan jam lapangan (jika fully booked, reguler, photoshoot, event), pemasukan online (AYO), offline (manual), photoshoot, event (lapangan, kebersihan, keamanan, pemasangan alat), biaya tambahan, coaching per coach, pemasukan lainnya, dan jumlah terjual tiap produk. Di bawahnya: **Total**, **Utilisasi / Nilai (Rp)** per produk, **TOTAL KESELURUHAN**, dan **MEDIAN**.

- Ganti bulan di sel **B2** (format `2026-11`). Semua angka berupa rumus dari data transaksi, jadi selalu terbaru.
- Menu **PCC → Simpan Rekap Bulanan ke Drive** membuat/ memperbarui file `REKAP BULAN NOVEMBER 2026 (WEB)` di folder **Laporan Bulanan**.
- Menu **PCC → Aktifkan simpan rekap otomatis tiap tanggal 1**: setiap tanggal 1 jam 06.00, rekap bulan sebelumnya disimpan otomatis.
- Setelah menambah produk di `Master_Produk` atau coach di `Config` (`COACHES`), jalankan **PCC → Perbarui kolom Rekap Bulanan**.
- Jam penuh per hari (48 = 3 court × 16 jam) diatur di `Config` → `FULL_HOURS_PER_DAY`.

## WhatsApp

Setelah laporan terkirim, sistem menyusun pesan rekap shift dalam format PCC (nama admin, jam shift, penjualan Minuman/Snack/Lainnya, total Majoo; untuk Shift 2 ditambah jam terpakai per court, pendapatan AYO, manual court, add-on AYO, coaching, dan total AYO + manual).

- **Tanpa biaya (default):** di layar sukses ada tombol hijau **Kirim rekap ke WhatsApp**. WhatsApp terbuka dengan pesan sudah terisi ke nomor `WA_TARGET`; admin tinggal tekan kirim. Ada juga tombol **Salin teks rekap**.
- **Otomatis (opsional, berbayar):** daftar di [fonnte.com](https://fonnte.com), hubungkan satu nomor WhatsApp pengirim (scan QR), salin *token device*, isi ke Script property `WA_TOKEN`. Setelah itu setiap laporan langsung terkirim ke `WA_TARGET` tanpa disentuh admin. Kalau pengiriman gagal, layar sukses memberi tahu dan tombol manual tetap tersedia.
- Laporan yang dikirim ulang (versi 2, 3, …) ditandai *Revisi laporan* di pesannya. Klik ganda tidak mengirim WA dua kali.
- Urutan dan nama produk di pesan diatur di `Master_Produk` kolom `grup` (Minuman / Snack / Lainnya) dan `label_wa`. Jam shift di `Config` → `SHIFT_HOURS`.

## 4. Deploy sebagai Web App

1. Di editor Apps Script: **Deploy → New deployment**.
2. Klik gerigi di samping *Select type* → **Web app**.
3. Isi:
   - Description: `PCC Daily Report v1`
   - Execute as: **Me** (akun Google PCC)
   - Who has access: **Anyone**
4. **Deploy** → salin **Web app URL** (berakhiran `/exec`).
5. Cek: buka URL itu di browser. Harus muncul `{"ok":true,"service":"PCC Daily Report API",...}`.

"Anyone" diperlukan agar website bisa mengirim data tanpa login Google. Data tetap terlindungi oleh PIN; tanpa PIN yang benar server menolak semua permintaan, dan setelah 20 kali PIN salah, akses dikunci 10 menit.

**Kalau kode diubah lagi nanti:** Deploy → **Manage deployments** → ikon pensil → Version: **New version** → Deploy. URL tetap sama.

## 5. Hubungkan website

Buka `assets/config.js`, isi `API_URL` dengan URL dari langkah 4:

```js
window.PCC_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfy.../exec',
  LOGO_URL: '',          // opsional: 'assets/logo.png' setelah file logo di-upload
  APP_NAME: 'PCC Daily Report'
};
```

Selama `API_URL` kosong, website berjalan dalam **mode demo** (ada banner kuning). Data demo hanya tersimpan di browser.

## 6. Upload ke GitHub dan GitHub Pages

### 6a. Buat akun & repository
1. Daftar di [github.com/signup](https://github.com/signup) (gunakan email PCC). Lewati jika sudah punya akun.
2. Klik **+ → New repository**:
   - Repository name: `pcc-daily-report`
   - **Public** (GitHub Pages gratis hanya untuk repo publik; repo ini tidak berisi PIN atau data)
   - Klik **Create repository**.

### 6b. Upload file
1. Di halaman repo baru, klik **uploading an existing file**.
2. Buka folder `pcc-daily-report` di laptop, pilih **semua isinya** (index.html, assets, apps-script, shared, tests, tools, panduan, README.md, .gitignore) lalu seret ke halaman GitHub.
   - File `.gitignore` tersembunyi di Windows; aktifkan *View → Hidden items* di File Explorer, atau lewati saja file ini.
3. Commit message: `Upload PCC Daily Report v1` → **Commit changes**.

### 6c. Aktifkan GitHub Pages
1. Di repo: **Settings → Pages**.
2. Source: **Deploy from a branch**; Branch: **main**, folder **/(root)** → **Save**.
3. Tunggu 1–2 menit, muat ulang halaman. Link muncul, contoh: `https://NAMA-AKUN.github.io/pcc-daily-report/`.
4. Bagikan link itu + PIN ke admin. Simpan di layar utama HP: Chrome → menu ⋮ → **Add to Home screen**.

### Mengubah website nanti
Edit file langsung di GitHub (ikon pensil) atau upload ulang file yang berubah. GitHub Pages memperbarui situs dalam 1–2 menit.

---

## 7. Pengujian

### Tes otomatis (di laptop, perlu Node.js)
```bash
node tests/run-tests.js
```
Menguji aturan booking court hanya oleh Shift 2, rumus (contoh brief: AYO 3×1 jam @Rp100.000 = Rp300.000 / 3 jam; Manual 2×2 jam @Rp150.000 = Rp600.000 / 4 jam), validasi, dan seluruh backend Apps Script terhadap simulasi Google Sheets: setup, PIN salah, submit, klik ganda, timpa (versi 2), dua shift di hari yang sama, laporan tidak valid, riwayat, koreksi, arsip, dan penambahan baris saat sheet penuh. Hasil yang diharapkan: `25 tests passed` (23 tanpa file impor lokal).

### Uji langsung setelah deployment (checklist)

| # | Langkah | Hasil yang diharapkan |
|---|---|---|
| 1 | Buka link GitHub Pages | Tidak ada banner "Mode demo"; muncul layar PIN |
| 2 | Masukkan PIN salah | "PIN salah." |
| 3 | Masukkan PIN benar | Form muncul dengan daftar 28 produk |
| 4 | Isi tanggal hari ini, nama `TES`, Shift 2. Court 1 AYO: Rp100.000 × 3 booking × 1 jam. Court 1 Manual: Rp150.000 × 2 × 2 jam, BRI. Raket 2, BRI | Summary: AYO Rp300.000, Manual Rp600.000, Court Rp900.000, Sales Rp100.000, Grand Total Rp1.000.000, Court 1: 5 booking, 7 jam |
| 5 | Kirim Laporan | "Laporan Terkirim!", ID laporan, link arsip |
| 6 | Cek spreadsheet | 1 baris di `Reports`, 2 di `Court_Bookings`, 1 di `Sales`, 1 di `Audit_Log`; `Daily_Summary` menampilkan tanggal hari ini dengan Grand Total Rp1.000.000 |
| 7 | Cek folder LAPORAN HARIAN | Ada `LAPORAN PEMASUKAN … (WEB)` |
| 8 | Isi lagi dengan nama `TES`, Shift 2, ubah Raket jadi 4 | Summary memperingatkan "Sudah ada laporan…"; setelah kirim: "Laporan diperbarui (versi 2)"; `Reports` tetap 1 baris, Sales Rp200.000 |
| 9 | Kirim laporan Shift 1 nama `TES2`, hanya penjualan | Halaman Booking Court menampilkan info "dicatat oleh Shift 2"; `Reports` jadi 2 baris; Dashboard harian menjumlahkan keduanya |
| 10 | Riwayat → buka laporan → **Koreksi laporan ini** | Form terisi, tanggal/shift/nama terkunci; kirim → versi naik |
| 11 | Matikan internet, kirim | Pesan gagal, isian tidak hilang; nyalakan internet, kirim ulang → tersimpan sekali |
| 12 | Hapus baris uji `TES`/`TES2` dari sheet `Reports`, `Court_Bookings`, `Sales`, `Audit_Log`, dan file arsip uji | Database bersih untuk dipakai |

---

## Pemakaian harian (untuk admin)

1. Buka link → PIN (centang "Ingat di perangkat ini" di HP kantor).
2. **Input Laporan**: tanggal, nama, shift, catatan; isi jumlah terjual tiap produk (+/−) dan metode bayarnya. Produk yang dibayar dengan dua metode: **+ Pisah metode bayar**.
3. **Booking Court** (hanya **Shift 2**, untuk satu hari penuh): per court, isi tarif AYO dan Manual. Beda harga → **+ Tambah tarif**. Shift 1 melewati langkah ini.
4. **Summary**: periksa angka dan peringatan, lalu **Kirim Laporan**.
5. Salah input setelah terkirim? **Riwayat → buka laporan → Koreksi laporan ini**, betulkan, kirim lagi.

## Keamanan

- Repo GitHub publik hanya berisi kode. PIN dan ID folder ada di Script Properties milik akun PCC.
- Ganti PIN kapan saja di Script Properties (tidak perlu deploy ulang). Semua perangkat akan diminta PIN baru.
- Web App berjalan sebagai akun PCC, jadi admin tidak perlu akses ke spreadsheet. Bagikan spreadsheet hanya ke owner/manajemen.

## Masalah umum

| Gejala | Penyebab & solusi |
|---|---|
| "Server belum dikonfigurasi (ACCESS_PIN kosong)" | Isi `ACCESS_PIN` di Script Properties. |
| "Sheet "Reports" tidak ada" | Jalankan `setup()` di editor Apps Script. |
| Arsip "Tidak aktif" | `ARCHIVE_FOLDER_ID` kosong. Isi, lalu kirim ulang laporan hari itu. |
| Arsip "Gagal (…)" | Akun yang men-deploy tidak punya akses edit ke folder, atau ID folder salah. Laporan tetap tersimpan. |
| Perubahan kode tidak berpengaruh | Buat **New version** di Manage deployments. |
| Website masih mode demo | `API_URL` di `assets/config.js` kosong atau salah (harus diawali `https://script.google.com/`). |
| Produk baru tidak muncul | Tambah di `Master_Produk` (kolom aktif = TRUE), lalu muat ulang website. |

## Pengembangan berikutnya

Struktur ini sudah dipisah per jenis transaksi, jadi laporan mingguan/bulanan cukup memakai filter Dashboard atau rumus baru di atas `Court_Bookings`/`Sales`. Inventory, laporan staff, atau keuangan bisa ditambah sebagai sheet baru + aksi baru di `doPost` (`Code.gs`) + halaman baru di `assets/app.js`, tanpa mengubah data yang sudah ada. Rumus bersama selalu diubah di `shared/logic.js` lalu `node tools/sync-logic.js`.

## Impor laporan lama (.xlsx)

Laporan harian lama (`LAPORAN PEMASUKAN DD BULAN YYYY.xlsx`) bisa dimasukkan ke database supaya Dashboard punya data sejak awal bulan.

1. Download folder **LAPORAN HARIAN** dari Drive (klik kanan → Download), ekstrak zip-nya.
2. Ubah file ke format impor (butuh Python + `pip install openpyxl`):
   ```bash
   python tools/import_xlsx.py "PATH/KE/LAPORAN HARIAN" "../import-data/history.json"
   ```
   Skrip mencetak tabel per tanggal dan mencocokkan total impor dengan sheet **Summary** di tiap file. Simpan hasilnya **di luar** folder repo: isinya data pendapatan PCC dan tidak boleh ikut ke GitHub.
3. Setelah Web App aktif, uji dulu lalu kirim:
   ```bash
   node tools/push-import.js ../import-data/history.json https://script.google.com/macros/s/XXXX/exec
   node tools/push-import.js ../import-data/history.json https://script.google.com/macros/s/XXXX/exec --send
   ```
   PIN ditanyakan di layar. Laporan yang tanggal + shift + namanya sudah ada di database dilewati, jadi laporan live dari admin tidak tertimpa. Menjalankan ulang tidak membuat data dobel.

Cara pemetaan file lama:
- Penjualan tabel **Shift 1 <nama>** → laporan Shift 1 atas nama itu; tabel **Shift 2 <nama>** + seluruh booking court + photoshoot/event/RECLUB/coaching → laporan Shift 2.
- File lama mencatat **jam**, bukan jumlah booking, jadi jumlah booking = jam dan durasi = 1 jam.
- Kolom "Jumlah Terjualan" = metode BRI, kolom "Via Ayo" = metode AYO; booking manual = BRI (sesuai kolom di file lama).
- Sheet **Bookingan Internal-Komunitas** tidak diimpor: isinya sama di semua file (3 jam Padelan Society per court), terlihat seperti isian bawaan template, dan tidak punya pendapatan.


## Keuangan (khusus manajer) — https://pccbogor.github.io/pcc-daily-report/keuangan/

Satu backend dengan laporan harian, tapi memakai PIN terpisah.

| Script property | Isi |
|---|---|
| `MANAGER_PIN` | PIN manajer (isi sendiri, jangan dibagikan ke admin) |
| `PETTY_CASH_ID` | Google Sheet **Report Arus Keuangan Petty Cash (WEB)** di KEUANGAN/PETTY CASH |
| `PENGAJUAN_FOLDER_ID` | Folder **KEUANGAN/PENGAJUAN & REIMBURSMENT** |
| `PENGAJUAN_TEMPLATE_ID` | Google Sheet **TEMPLATE PENGAJUAN DAN REIMBURSMENT (WEB) - JANGAN DIHAPUS** |
| `BUKTI_FOLDER_ID` | Folder **KEUANGAN/BUKTI & LAMPIRAN** |

- **Petty Cash**: setiap transaksi ditambahkan sebagai baris baru di buku kas berjalan (kolom Date, Transactions, Kredit, Debit, Category, Ke Account, Struk Nota). Edit/hapus dari website mengecek dulu bahwa baris di spreadsheet belum berubah.
- **Pengajuan**: item disimpan di tab `Fin_Pengajuan` (database), lalu file "Pengajuan dan Reimbursment <tanggal> (WEB)" dibuat ulang dari template setiap ada perubahan (versi lama ke Sampah). Item dengan A/N yang sama dikelompokkan, Grand Total digabung. Item yang dibayar: kolom Tanggal Pembayaran terisi dan Mark = LUNAS + link bukti transfer.
- **Lampiran**: semua foto/PDF masuk `BUKTI & LAMPIRAN/<YYYY-MM BULAN>/`, nama file diawali tanggal pencatatan.
- Semua perubahan tercatat di tab `Fin_Log`.
