<iframe src="https://github.com/sponsors/idlanyor/card" title="Sponsor idlanyor" height="225" width="600" style="border: 0;"></iframe>
<div align="center">

# WhatsApp Webhook API Service
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![MongoDB](https://img.shields.io/badge/database-MongoDB-informational.svg)](https://www.mongodb.com/)
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

- [Node.js](https://nodejs.org/) (Versi 16.x atau lebih tinggi)
- [MongoDB](https://www.mongodb.com/try/download/community) (Lokal atau MongoDB Atlas)
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
   MONGODB_URI=mongodb://localhost:27017/whatsapp-webhook
   SESSION_SECRET=masukkan-secret-key-anda-disini
   ```

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

---

##  Struktur Folder

```text
├── app.js              # Entry point aplikasi
├── src/
│   ├── config/         # Konfigurasi DB & App
│   ├── middleware/     # Auth & Upload middleware
│   ├── models/         # Mongoose Schema
│   ├── routes/         # Express Routes
│   ├── services/       # Logika bisnis & Integrasi WA
│   └── utils/          # Helper & Logger
├── views/              # Template EJS (Frontend)
├── public/             # File statis (CSS/JS)
└── auth_info_baileys/  # Data sesi WhatsApp (Jangan di-commit)
```

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
