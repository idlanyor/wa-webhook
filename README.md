<div align="center">

# WhatsApp Webhook API Service
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org/)
[![SQLite](https://img.shields.io/badge/database-SQLite-informational.svg)](https://www.sqlite.org/)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
[![WA Channel](https://img.shields.io/badge/WhatsApp-Channel-25D366?style=flat&logo=whatsapp)](https://www.whatsapp.com/channel/0029VagADOLLSmbaxFNswH1m)

**Layanan API WhatsApp modern yang mendukung multi-user, auto-reply, API, dan integrasi webhook real-time.**

[Fitur](#-fitur-utama) • [Instalasi](#-instalasi) • [Panduan API](#4-penggunaan-api) • [Kontak](#-kontak--dukungan)

---
</div>

## Screenshoot

### Tampilan Dashboard sebelum terhubung

![alt text](image-1.png)

### Tampilan Dashboard setelah terhubung

![alt text](image.png)


## Fitur Utama

- **Multi-Tenant**: Registrasi dan login user terpisah.
- **Manajemen Sesi**: Hubungkan WhatsApp dengan scan QR Code langsung dari dashboard.
- **Live Chat**: Antarmuka chatting real-time menggunakan Socket.IO.
- **Balas Otomatis (Auto-Reply)**: Konfigurasi jawaban otomatis berdasarkan kata kunci.
- **Manajemen Kontak**: Impor kontak secara massal via berkas VCF atau CSV.
- **Integrasi Webhook**: Kirim notifikasi event (pesan masuk/keluar, status koneksi) ke server Anda.
- **Kunci API (API Keys)**: Akses fitur pengiriman pesan melalui HTTP REST API.
- **UI Modern**: Antarmuka responsif dengan Tailwind CSS dan Remix Icons.

---

## Prasyarat

Sebelum memulai, pastikan Anda telah menginstal:

- [Node.js](https://nodejs.org/) (Versi 22 atau lebih tinggi — dibutuhkan untuk WebSocket bawaan yang dipakai zapo-js) atau [Bun](https://bun.sh/)
- NPM atau [Bun](https://bun.sh/) (Optional untuk performa lebih cepat)

---

##  Instalasi

1. **Clone repositori:**
   ```bash
   git clone <repository-url>
   cd wa-webhook
   ```

2. **Instal dependensi:**
   ```bash
   npm install
   ```

3. **Konfigurasi Environment:**
   Salin file `.env.example` menjadi `.env` dan sesuaikan nilainya.
   ```bash
   cp .env.example .env
   ```

   Isi file `.env`:
   ```env
   PORT=8181
   NODE_ENV=development
   SESSION_SECRET=masukkan-secret-key-anda-disini
   SQLITE_PATH=./data/wa-webhook.db
   ZAPO_SQLITE_PATH=./data/wa-session.db
   ```

   **Database:** aplikasi memakai SQLite (via [Drizzle ORM](https://orm.drizzle.team/)), tidak perlu server database terpisah. File dibuat otomatis dan migrasi skema dijalankan saat start. Driver: `better-sqlite3` di Node, `bun:sqlite` di Bun.

   | File | Isi |
   | --- | --- |
   | `SQLITE_PATH` (default `./data/wa-webhook.db`) | Data aplikasi: user, API key, pesan, auto-reply, jadwal, pengaturan |
   | `ZAPO_SQLITE_PATH` (default `./data/wa-session.db`) | Sesi WhatsApp (credential + Signal state) |

   Backup cukup dengan menyalin folder `data/` saat aplikasi berhenti.

   **Di belakang HTTPS / Cloudflare:** set `NODE_ENV=production` supaya cookie login hanya dikirim lewat HTTPS. Dengan setting ini login lewat HTTP biasa (mis. `http://IP:8181`) tidak bisa. IP asli pengunjung (untuk rate limit) dibaca dari `X-Forwarded-For` dengan hanya mempercayai jaringan lokal dan rentang IP Cloudflare; ubah lewat `TRUST_PROXY` bila proxy-nya lain.

   **Pindah dari instalasi lama (MongoDB):** jalankan sekali dengan database SQLite yang masih kosong:
   ```bash
   MONGODB_URI=mongodb://localhost:27017/whatsapp-webhook npm run db:migrate-mongo
   ```
   Semua user, API key, pesan, kontak, auto-reply, jadwal, dan pengaturan disalin dengan ID yang sama (cookie login tetap berlaku). Sesi WhatsApp **tidak** bisa dipindahkan: setiap user perlu scan QR ulang.

   **Mengubah skema:** edit `src/db/schema.js`, lalu `npm run db:generate` untuk membuat file migrasi baru di `drizzle/`. `npm run db:studio` membuka Drizzle Studio untuk melihat isi database.

---

##  Menjalankan Aplikasi

### Mode Pengembangan
Gunakan `nodemon` untuk restart otomatis setiap kali ada perubahan kode:
```bash
npm run dev
```

### Mode Produksi
```bash
npm start
```

Aplikasi akan berjalan di `http://localhost:8181` (atau port yang Anda tentukan).

---

## Panduan Penggunaan

### 1. Registrasi & Login
- Buka `/register` untuk membuat akun admin/user pertama.
- Login melalui `/login`.

### 2. Menghubungkan WhatsApp
- Buka **Dasbor**.
- Tunggu QR Code muncul, lalu scan menggunakan aplikasi WhatsApp di ponsel Anda (Perangkat Tertaut).
- Status akan berubah menjadi **Connected** jika berhasil.

### 3. Konfigurasi Webhook
- Buka menu **Pengaturan**.
- Masukkan **Webhook URL** server Anda.
- Pilih event yang ingin dipantau (Pesan Masuk, Pesan Keluar, Status Koneksi).
- Simpan dan gunakan tombol **Kirim Uji** untuk memverifikasi integrasi.

### 4. Penggunaan API
- Buat kunci di menu **Kunci API**.
- Gunakan kunci tersebut untuk mengirim pesan via REST API:

**Endpoint:** `POST /send-message`
**Header:** `X-API-KEY: <your_api_key>`
**Body (JSON):**
```json
{
  "to": "6281234567890",
  "message": "Halo, ini pesan dari API!"
}
```

Kirim dokumen:

**Endpoint:** `POST /send-document`
**Body (JSON):**
```json
{
  "to": "6281234567890",
  "url": "https://example.com/file.pdf",
  "fileName": "file.pdf",
  "mimetype": "application/pdf",
  "caption": "Dokumen terlampir"
}
```

Upload file juga didukung via `multipart/form-data` dengan field `document` atau `file`.

---

##  Struktur Folder

```text
├── app.js              # Entry point aplikasi
├── src/
│   ├── config/         # Konfigurasi aplikasi
│   ├── db/             # Skema & koneksi SQLite (Drizzle)
│   ├── middleware/     # Auth & Upload middleware
│   ├── routes/         # Express Routes
│   ├── services/       # Logika bisnis & Integrasi WA
│   └── utils/          # Helper & Logger
├── views/              # Template EJS (Frontend)
├── public/             # File statis (CSS/JS)
├── drizzle/            # File migrasi SQL (hasil drizzle-kit)
├── scripts/            # Skrip satu kali (migrasi dari MongoDB)
└── data/               # File database SQLite
```

> **Mesin WhatsApp**: Menggunakan **zapo-js** (`zapo.to`) — pengganti Baileys. Sesi WhatsApp (credential + Signal state) disimpan di SQLite melalui `@zapo-js/store-sqlite`, bukan di folder `auth_info_baileys/`. Folder lama hanya berlaku untuk sesi yang belum dimigrasi.

---

## Keamanan
- Password di-hash menggunakan `bcryptjs`.
- Otentikasi sesi menggunakan JWT (JSON Web Token).
- Verifikasi webhook menggunakan tanda tangan HMAC SHA256 (Opsional).

---

## Kontak & Dukungan

Jika Anda memiliki pertanyaan atau ingin mendapatkan update terbaru, hubungi kami melalui:

- **WhatsApp Channel**: [Gabung Saluran](https://www.whatsapp.com/channel/0029VagADOLLSmbaxFNswH1m)
- **Sosial Media (Threads, FB, IG)**: [@kang.potokopi](https://instagram.com/kang.potokopi)
- **Email**: support@antidonasi.web.id
- **Author Website**: [idlanyor.web.id](https://idlanyor.web.id)

---

##  Lisensi
Distributed under the ISC License. Lihat `LICENSE` untuk informasi lebih lanjut.
