# Dokumentasi WhatsApp Webhook API

Dokumentasi ini memberikan panduan teknis mendalam tentang cara berinteraksi dengan WhatsApp Webhook API, termasuk penggunaan REST API, integrasi webhook, dan fitur manajemen lainnya.

---

## Daftar Isi
1. [Autentikasi](#1-autentikasi)
2. [REST API Endpoints](#2-rest-api-endpoints)
3. [Integrasi Webhook](#3-integrasi-webhook)
4. [Balas Otomatis (Auto-Reply)](#4-balas-otomatis-auto-reply)
5. [Manajemen User](#5-manajemen-user)

---

## 1. Autentikasi

Layanan ini mendukung dua metode autentikasi untuk akses API:

### A. Kunci API (API Key)
Metode ini direkomendasikan untuk integrasi antar server (S2S).
- **Header**: `X-API-KEY: <kunci_api_anda>`
- **Query Parameter**: `?api_key=<kunci_api_anda>`

Anda dapat mengelola kunci API melalui menu **Kunci API** di dasbor.

### B. Cookie Sesi (Session Cookie)
Digunakan oleh frontend web. Jika Anda ingin melakukan pengujian cepat melalui browser atau curl setelah login:
- **Cookie**: `auth-token=<token_jwt_anda>`

---

## 2. REST API Endpoints

Semua endpoint API menggunakan format JSON untuk request dan response.

### 2.1 Cek Status Koneksi
Memeriksa apakah WhatsApp sudah terhubung atau memerlukan pemindaian QR Code.

- **URL**: `GET /status`
- **Response**:
  ```json
  {
    "isConnected": true,
    "status": "connected",
    "phoneNumber": "6281234567890",
    "pushName": "User Name"
  }
  ```
  Jika belum terhubung:
  ```json
  {
    "isConnected": false,
    "status": "qr_ready",
    "qr": "data:image/png;base64,..."
  }
  ```

### 2.2 Kirim Pesan Tunggal
Mengirim pesan teks ke satu nomor tujuan.

- **URL**: `POST /send-message`
- **Body**:
  ```json
  {
    "to": "6281234567890",
    "message": "Halo dari API!",
    "reply_to_id": "optional_message_id"
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "messageId": "ABC123XYZ",
    "to": "6281234567890",
    "message": "Halo dari API!"
  }
  ```

---

## 3. Integrasi Webhook

Webhook memungkinkan server Anda menerima notifikasi real-time saat terjadi aktivitas di akun WhatsApp yang terhubung.

### 3.1 Konfigurasi
Atur **Webhook URL** dan **Webhook Secret** di halaman **Pengaturan**.

### 3.2 Payload Webhook
Data dikirimkan menggunakan metode `POST` dengan format:
```json
{
  "event": "message.in",
  "data": { ... },
  "timestamp": 1735460000000
}
```

### 3.3 Jenis Event
- `message.in`: Pesan teks masuk.
- `message.out`: Pesan terkirim dari sistem atau perangkat.
- `connection.update`: Perubahan status koneksi (connected, disconnected).

### 3.4 Verifikasi Tanda Tangan (Signature)
Jika Anda mengatur **Webhook Secret**, setiap request akan menyertakan header `X-Signature`. Gunakan ini untuk memastikan data berasal dari server yang sah.

**Contoh Verifikasi (Node.js):**
```javascript
const crypto = require('crypto');

function verifySignature(payload, signature, secret) {
    const hmac = crypto.createHmac('sha256', secret);
    const digest = hmac.update(JSON.stringify(payload)).digest('hex');
    return signature === digest;
}
```

---

## 4. Balas Otomatis (Auto-Reply)

Fitur ini memungkinkan bot menjawab pesan secara otomatis berdasarkan kata kunci.

- **Global Toggle**: Aktifkan/nonaktifkan fitur melalui menu Auto-Reply.
- **Aturan (Rules)**:
  - Kata kunci bersifat *case-insensitive*.
  - Mendukung pencocokan sebagian atau kata kunci yang persis.
  - Setiap aturan dapat diaktifkan/dinonaktifkan secara individu.

---

## 5. Manajemen User

Sistem ini mendukung multi-user dengan pembagian peran (role):
- **Admin**: Memiliki akses penuh ke semua fitur, termasuk manajemen user, pengaturan global, dan kunci API.
- **User**: Hanya dapat mengelola sesi WhatsApp dan aturan balas otomatis mereka sendiri.

*Catatan: User pertama yang mendaftar ke sistem secara otomatis akan mendapatkan peran **Admin**.*

---

*Dokumentasi ini dibuat untuk versi 1.0.0. Jika ada pertanyaan lebih lanjut, silakan hubungi tim dukungan.*
