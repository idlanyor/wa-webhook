# Dokumentasi WhatsApp Webhook API

Dokumentasi ini memberikan panduan teknis mendalam tentang cara berinteraksi dengan WhatsApp Webhook API, termasuk penggunaan REST API, integrasi webhook, dan fitur manajemen lainnya.

---

## Daftar Isi
1. [Autentikasi](#1-autentikasi)
2. [REST API Endpoints](#2-rest-api-endpoints)
3. [Integrasi Webhook](#3-integrasi-webhook)
4. [Balas Otomatis (Auto-Reply)](#4-balas-otomatis-auto-reply)
5. [Manajemen User](#5-manajemen-user)
6. [Pesan Interaktif dengan Button](#pesan-interaktif-dengan-button)

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

### 2.3 Kirim Pesan dengan Button (Interactive Message)
Mengirim pesan interaktif dengan tombol untuk memudahkan pengguna berinteraksi.

- **URL**: `POST /send-interactive`
- **Body** (Message Buttons):
  ```json
  {
    "to": "6281234567890",
    "text": "Pilih opsi di bawah:",
    "footer": "Silakan pilih salah satu",
    "interactiveButtons": [
      {
        "name": "quick_reply",
        "buttonParamsJson": "{\"display_text\":\"Ya\",\"id\":\"btn_1\"}"
      },
      {
        "name": "quick_reply",
        "buttonParamsJson": "{\"display_text\":\"Tidak\",\"id\":\"btn_2\"}"
      },
      {
        "name": "quick_reply",
        "buttonParamsJson": "{\"display_text\":\"Nanti\",\"id\":\"btn_3\"}"
      }
    ]
  }
  ```

- **Body** (List Message):
  ```json
  {
    "to": "6281234567890",
    "text": "Silakan pilih menu:",
    "title": "Menu Utama",
    "footer": "Pilih dari list di bawah",
    "interactiveButtons": [
      {
        "name": "single_select",
        "buttonParamsJson": "{\"title\":\"Lihat Opsi\",\"sections\":[{\"title\":\"Layanan Kami\",\"rows\":[{\"header\":\"Produk\",\"title\":\"Produk\",\"description\":\"Lihat katalog produk kami\",\"id\":\"service_1\"},{\"header\":\"Layanan\",\"title\":\"Layanan\",\"description\":\"Layanan yang kami tawarkan\",\"id\":\"service_2\"}]}]}"
      }
    ]
  }
  ```

- **Response**:
  ```json
  {
    "success": true,
    "messageId": "ABC456DEF",
    "to": "6281234567890",
    "type": "button",
    "timestamp": 1735460000000
  }
  ```

**Catatan**:
- Maximum 3 buttons untuk quick_reply buttons
- `buttonParamsJson` harus berupa string JSON yang valid
- Button ID (`id` dalam buttonParamsJson) digunakan untuk tracking respon pada webhook
- Untuk list message, gunakan `name: "single_select"` dengan sections dan rows dalam buttonParamsJson

### 2.4 Kirim Dokumen / Attachment
Mengirim file dokumen ke satu nomor tujuan. Sumber dokumen dapat berupa URL publik atau string base64.
Endpoint ini juga menerima `multipart/form-data` dengan field file `document` atau `file`.

- **URL**: `POST /send-document`
- **Body**:
  ```json
  {
    "to": "6281234567890",
    "url": "https://example.com/invoice.pdf",
    "fileName": "invoice.pdf",
    "mimetype": "application/pdf",
    "caption": "Invoice bulan ini",
    "reply_to_id": "optional_message_id"
  }
  ```

  Untuk upload file:
  ```bash
  curl -X POST http://localhost:8181/send-document \
    -H "X-API-KEY: <kunci_api_anda>" \
    -F "to=6281234567890" \
    -F "caption=Dokumen terlampir" \
    -F "document=@/path/invoice.pdf"
  ```

  Untuk base64:
  ```json
  {
    "to": "6281234567890",
    "base64": "JVBERi0xLjQKJ...",
    "fileName": "invoice.pdf",
    "mimetype": "application/pdf"
  }
  ```

- **Response**:
  ```json
  {
    "success": true,
    "messageId": "ABC789XYZ",
    "to": "6281234567890",
    "type": "document",
    "fileName": "invoice.pdf"
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
- Untuk pesan dokumen/media, payload `message.in` dan `message.out` menyertakan `messageType` dan `attachment`.
- `interaction.button`: Pengguna menekan tombol pada pesan interaktif.
- `interaction.list`: Pengguna memilih opsi dari list message.
- `connection.update`: Perubahan status koneksi (connected, disconnected).

### 3.3.1 Payload Event Button Response
Contoh payload saat pengguna menekan tombol:
```json
{
  "event": "interaction.button",
  "data": {
    "from": "6281234567890",
    "messageId": "ABC456DEF",
    "buttonId": "btn_1",
    "buttonText": "Ya",
    "timestamp": 1735460000000
  }
}
```

### 3.3.2 Payload Event List Response
Contoh payload saat pengguna memilih dari list:
```json
{
  "event": "interaction.list",
  "data": {
    "from": "6281234567890",
    "messageId": "ABC456DEF",
    "rowId": "service_1",
    "rowTitle": "Produk",
    "rowDescription": "Lihat katalog produk kami",
    "timestamp": 1735460000000
  }
}
```

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

## 6. Pesan Interaktif dengan Button

Fitur pesan interaktif memungkinkan Anda mengirim pesan dengan tombol atau list pilihan, meningkatkan engagement pengguna dan menyederhanakan response options.

### 6.1 Jenis Interactive Message

#### 6.1.1 Button Message
Pesan dengan tombol pilihan (maksimal 3 tombol). Cocok untuk:
- Konfirmasi (Ya/Tidak)
- Pilihan sederhana
- Feedback rating

#### 6.1.2 List Message
Pesan dengan list opsi dalam dropdown. Cocok untuk:
- Menu dengan banyak opsi
- Katalog produk
- Form dengan field pilihan

### 6.2 Best Practices

1. **Button Text**: Gunakan teks singkat dan jelas (maksimal 20 karakter per tombol)
2. **Button ID**: Gunakan ID yang deskriptif untuk tracking, contoh: `order_confirm`, `feedback_positive`
3. **Main Text**: Berikan konteks yang jelas sebelum tombol muncul
4. **Timeout**: Tangani timeout jika user tidak merespon dalam waktu tertentu

### 6.3 Contoh Use Cases

#### Flow Konfirmasi Pesanan
```bash
# Kirim pesan konfirmasi
POST /send-interactive
{
  "to": "6281234567890",
  "type": "button",
  "text": "Apakah Anda ingin melanjutkan pesanan?",
  "buttons": [
    { "id": "order_yes", "text": "Ya, Lanjut" },
    { "id": "order_no", "text": "Batalkan" },
    { "id": "order_later", "text": "Nanti Saja" }
  ]
}

# Webhook menerima response:
# - order_yes: Lanjut ke pembayaran
# - order_no: Batalkan pesanan
# - order_later: Simpan ke cart
```

#### Menu Layanan Pelanggan
```bash
POST /send-interactive
{
  "to": "6281234567890",
  "type": "list",
  "text": "Apa yang bisa kami bantu?",
  "title": "Layanan Pelanggan",
  "buttonText": "Pilih Menu",
  "sections": [
    {
      "title": "Bantuan",
      "rows": [
        { "id": "help_order", "title": "Cek Pesanan", "description": "Lihat status pesanan terakhir" },
        { "id": "help_product", "title": "Info Produk", "description": "Tanya tentang produk" },
        { "id": "help_shipping", "title": "Info Pengiriman", "description": "Cek status pengiriman" },
        { "id": "help_return", "title": "Pengembalian", "description": "Proses retur barang" }
      ]
    }
  ]
}
```

### 6.4 Error Handling

Kode error yang mungkin:
- `400`: Bad Request (format invalid, jumlah button > 3)
- `404`: Contact tidak ditemukan
- `500`: Internal Server Error

Contoh error response:
```json
{
  "success": false,
  "error": "BUTTON_LIMIT_EXCEEDED",
  "message": "Maximum 3 buttons allowed per message"
}
```

*Dokumentasi ini dibuat untuk versi 2.0.0. Jika ada pertanyaan lebih lanjut, silakan hubungi tim dukungan.*
