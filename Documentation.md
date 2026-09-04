# Dokumentasi WhatsApp Webhook API

Dokumentasi ini memberikan panduan teknis mendalam tentang cara berinteraksi dengan WhatsApp Webhook API, termasuk penggunaan REST API, integrasi webhook, dan fitur manajemen lainnya.

---

## Daftar Isi
1. [Autentikasi](#1-autentikasi)
2. [REST API Endpoints](#2-rest-api-endpoints)
   - 2.1 [Cek Status Koneksi](#21-cek-status-koneksi)
   - 2.2 [Kirim Pesan Tunggal](#22-kirim-pesan-tunggal)
   - 2.3 [Kirim Pesan Interaktif](#23-kirim-pesan-dengan-button-interactive-message)
   - 2.4 [Kirim Dokumen](#24-kirim-dokumen--attachment)
   - 2.5 [Kirim Gambar](#25-kirim-gambar-image)
   - 2.6 [Kirim Video](#26-kirim-video)
   - 2.7 [Kirim Audio / Voice Note](#27-kirim-audio--voice-note)
   - 2.8 [Kirim Sticker](#28-kirim-sticker)
   - 2.9 [Kirim Poll (Voting)](#29-kirim-poll-voting)
   - 2.10 [Kirim Reaksi (Reaction)](#210-kirim-reaksi-reaction)
   - 2.11 [Edit Pesan](#211-edit-pesan)
   - 2.12 [Hapus Pesan (Revoke)](#212-hapus-pesan-revoke)
   - 2.13 [Pin / Unpin Pesan](#213-pin--unpin-pesan)
   - 2.14 [Kirim Button (Legacy)](#214-kirim-button-legacy)
   - 2.15 [Kirim List Menu](#215-kirim-list-menu)
   - 2.16 [Kirim CTA (Call-to-Action)](#216-kirim-cta-call-to-action)
3. [Manajemen Grup](#3-manajemen-grup)
4. [Integrasi Webhook](#4-integrasi-webhook)
5. [Balas Otomatis (Auto-Reply)](#5-balas-otomatis-auto-reply)
6. [Manajemen User](#6-manajemen-user)
7. [Pesan Interaktif dengan Button](#7-pesan-interaktif-dengan-button)

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
  curl -X POST https://gate.ireng.uk/send-document \
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

### 2.5 Kirim Gambar (Image)
Mengirim gambar ke satu nomor tujuan. Mendukung URL, base64, atau multipart upload.

- **URL**: `POST /send-image`
- **Body**:
  ```json
  {
    "to": "6281234567890",
    "url": "https://example.com/photo.jpg",
    "caption": "Foto produk",
    "mimetype": "image/jpeg",
    "reply_to_id": "optional_message_id"
  }
  ```

  Untuk upload file:
  ```bash
  curl -X POST https://gate.ireng.uk/send-image \
    -H "X-API-KEY: <kunci_api_anda>" \
    -F "to=6281234567890" \
    -F "caption=Foto produk" \
    -F "image=@/path/photo.jpg"
  ```

- **Response**:
  ```json
  {
    "success": true,
    "messageId": "IMG123XYZ",
    "to": "6281234567890",
    "type": "image",
    "fileName": "photo.jpg"
  }
  ```

### 2.6 Kirim Video
Mengirim video ke satu nomor tujuan. Mendukung URL, base64, atau multipart upload.

- **URL**: `POST /send-video`
- **Body**:
  ```json
  {
    "to": "6281234567890",
    "url": "https://example.com/video.mp4",
    "caption": "Video demo",
    "mimetype": "video/mp4",
    "reply_to_id": "optional_message_id"
  }
  ```

  Untuk upload file:
  ```bash
  curl -X POST https://gate.ireng.uk/send-video \
    -H "X-API-KEY: <kunci_api_anda>" \
    -F "to=6281234567890" \
    -F "caption=Video demo" \
    -F "video=@/path/video.mp4"
  ```

- **Response**:
  ```json
  {
    "success": true,
    "messageId": "VID123XYZ",
    "to": "6281234567890",
    "type": "video",
    "fileName": "video.mp4"
  }
  ```

### 2.7 Kirim Audio / Voice Note
Mengirim file audio atau voice note. Set `is_voice_note: true` untuk mengirim sebagai voice note (tampil sebagai pesan suara di WhatsApp).

- **URL**: `POST /send-audio`
- **Body**:
  ```json
  {
    "to": "6281234567890",
    "url": "https://example.com/audio.mp3",
    "mimetype": "audio/mpeg",
    "is_voice_note": false,
    "reply_to_id": "optional_message_id"
  }
  ```

  Untuk upload file:
  ```bash
  curl -X POST https://gate.ireng.uk/send-audio \
    -H "X-API-KEY: <kunci_api_anda>" \
    -F "to=6281234567890" \
    -F "is_voice_note=true" \
    -F "audio=@/path/voice.ogg"
  ```

- **Response**:
  ```json
  {
    "success": true,
    "messageId": "AUD123XYZ",
    "to": "6281234567890",
    "type": "audio",
    "fileName": "audio.mp3"
  }
  ```

### 2.8 Kirim Sticker
Mengirim sticker (format WebP). Mendukung URL, base64, atau multipart upload.

- **URL**: `POST /send-sticker`
- **Body**:
  ```json
  {
    "to": "6281234567890",
    "url": "https://example.com/sticker.webp",
    "mimetype": "image/webp",
    "reply_to_id": "optional_message_id"
  }
  ```

  Untuk upload file:
  ```bash
  curl -X POST https://gate.ireng.uk/send-sticker \
    -H "X-API-KEY: <kunci_api_anda>" \
    -F "to=6281234567890" \
    -F "sticker=@/path/sticker.webp"
  ```

- **Response**:
  ```json
  {
    "success": true,
    "messageId": "STK123XYZ",
    "to": "6281234567890",
    "type": "sticker",
    "fileName": "sticker.webp"
  }
  ```

### 2.9 Kirim Poll (Voting)
Mengirim pesan voting (poll) ke chat pribadi atau grup.

- **URL**: `POST /send-poll`
- **Body**:
  ```json
  {
    "to": "6281234567890",
    "question": "Makan siang di mana?",
    "options": ["Warung Padang", "Kantin", "Warteg"],
    "selectable_count": 1
  }
  ```
  - `options`: array string, minimal 2. Urutan dipakai untuk hash vote — jangan diubah setelah terkirim.
  - `selectable_count`: berapa opsi yang boleh dipilih pemilih (default 1).
- **Response**:
  ```json
  { "success": true, "messageId": "POLL123", "to": "6281234567890" }
  ```

### 2.10 Kirim Reaksi (Reaction)
Memberi reaksi emoji ke sebuah pesan. Kirim `emoji` sebagai string kosong (`""`) untuk menghapus reaksi.

- **URL**: `POST /send-reaction`
- **Body**:
  ```json
  {
    "to": "6281234567890",
    "emoji": "👍",
    "stanza_id": "ABC123XYZ",
    "from_me": false,
    "participant": "6289876543210@s.whatsapp.net"
  }
  ```
  - `stanza_id`: ID pesan yang direaksi (`messageId` dari response kirim / webhook).
  - `participant`: wajib di grup saat mereaksi pesan orang lain.
- **Response**:
  ```json
  { "success": true, "messageId": "REACT123", "to": "6281234567890" }
  ```

### 2.11 Edit Pesan
Mengubah isi pesan teks yang sudah terkirim (hanya pesan milik sendiri).

- **URL**: `POST /edit-message`
- **Body**:
  ```json
  {
    "to": "6281234567890",
    "stanza_id": "ABC123XYZ",
    "new_text": "Teks yang sudah dikoreksi"
  }
  ```
- **Response**:
  ```json
  { "success": true, "messageId": "EDIT123", "to": "6281234567890" }
  ```

### 2.12 Hapus Pesan (Revoke)
Menghapus pesan untuk semua orang (delete for everyone). Di grup, admin dapat menghapus pesan anggota dengan `from_me: false` + `participant`.

- **URL**: `POST /revoke-message`
- **Body**:
  ```json
  {
    "to": "6281234567890",
    "stanza_id": "ABC123XYZ",
    "from_me": true
  }
  ```
- **Response**:
  ```json
  { "success": true, "to": "6281234567890" }
  ```

### 2.13 Pin / Unpin Pesan
Menyematkan pesan di chat. Default durasi pin 24 jam; gunakan `duration_secs` untuk mengubahnya (misal `604800` = 7 hari, `2592000` = 30 hari).

- **URL**: `POST /pin-message`
- **Body**:
  ```json
  {
    "to": "6281234567890",
    "stanza_id": "ABC123XYZ",
    "action": "pin",
    "duration_secs": 604800
  }
  ```
  - `action`: `"pin"` atau `"unpin"`.
- **Response**:
  ```json
  { "success": true, "to": "6281234567890", "action": "pin" }
  ```

### 2.14 Kirim Button (Legacy)
Pesan tombol balasan cepat (maksimal 3 tombol). Untuk kebutuhan lebih kompleks gunakan `/send-interactive`.

- **URL**: `POST /send-button`
- **Body**:
  ```json
  {
    "to": "6281234567890",
    "title": "Konfirmasi",
    "content": "Lanjutkan pembayaran?",
    "footer": "Pilih salah satu",
    "buttons": [
      { "id": "pay_yes", "text": "Ya, Bayar" },
      { "id": "pay_no", "text": "Batalkan" }
    ]
  }
  ```
  - `buttons` juga menerima array string polos: `["Ya", "Tidak"]`.
- **Response**:
  ```json
  { "success": true, "messageId": "BTN123", "to": "6281234567890" }
  ```

### 2.15 Kirim List Menu
Pesan menu pilihan tunggal dengan beberapa seksi dan baris.

- **URL**: `POST /send-list`
- **Body**:
  ```json
  {
    "to": "6281234567890",
    "title": "Menu Utama",
    "description": "Pilih layanan yang Anda butuhkan",
    "button_text": "Lihat Menu",
    "footer": "CS 24 jam",
    "sections": [
      {
        "title": "Layanan",
        "rows": [
          { "id": "svc_1", "title": "Cek Pesanan", "description": "Lacak status pesanan" },
          { "id": "svc_2", "title": "Hubungi CS", "description": "Bicara dengan agen" }
        ]
      }
    ]
  }
  ```
- **Response**:
  ```json
  { "success": true, "messageId": "LIST123", "to": "6281234567890" }
  ```

### 2.16 Kirim CTA (Call-to-Action)
Pesan dengan satu tombol aksi: buka URL (`cta_url`) atau panggil nomor telepon (`cta_call`).

- **URL**: `POST /send-cta`
- **Body** (tombol URL):
  ```json
  {
    "to": "6281234567890",
    "body": "Cek promo terbaru kami!",
    "footer": "Periode terbatas",
    "display_text": "Lihat Promo",
    "url": "https://example.com/promo"
  }
  ```
- **Body** (tombol telepon):
  ```json
  {
    "to": "6281234567890",
    "body": "Butuh bantuan? Telepon kami sekarang.",
    "display_text": "Telepon CS",
    "phone_number": "6281234567890"
  }
  ```
- **Response**:
  ```json
  { "success": true, "messageId": "CTA123", "to": "6281234567890" }
  ```

---

## 3. Manajemen Grup

Endpoint untuk membuat, mengelola, dan mendapatkan informasi grup WhatsApp. Semua `group_id` menerima format polos (`120363...`) maupun JID lengkap (`120363...@g.us`).

### 3.1 Daftar Grup
Mendapatkan semua grup yang diikuti akun.

- **URL**: `GET /groups`
- **Response**:
  ```json
  {
    "success": true,
    "data": [
      {
        "group_id": "120363000000000000@g.us",
        "subject": "Tim Marketing",
        "owner": "6281234567890@s.whatsapp.net",
        "creation": 1735000000,
        "participants_count": 25
      }
    ]
  }
  ```

### 3.2 Metadata Grup
Mendapatkan detail lengkap satu grup (subjek, peserta, admin, pengaturan).

- **URL**: `GET /groups/metadata?group_id=120363000000000000@g.us`
- **Response**:
  ```json
  {
    "success": true,
    "data": {
      "jid": "120363000000000000@g.us",
      "subject": "Tim Marketing",
      "participants": [ { "jid": "...", "isAdmin": true } ],
      "announce": false
    }
  }
  ```

### 3.3 Buat Grup
Membuat grup baru. Mengembalikan metadata grup yang baru dibuat.

- **URL**: `POST /groups/create`
- **Body**:
  ```json
  {
    "subject": "Grup Baru",
    "participants": ["6281234567890", "6289876543210"]
  }
  ```
- **Response**:
  ```json
  { "success": true, "data": { "jid": "120363...@g.us", "subject": "Grup Baru" } }
  ```

### 3.4 Kelola Peserta
Tambah, keluarkan, jadikan admin, atau cabut admin. Mengembalikan hasil per-nomor — satu nomor bisa gagal (misal pengaturan privasi) walau request sukses; periksa field `code`/`status` tiap entri.

- **URL**: `POST /groups/participants`
- **Body**:
  ```json
  {
    "group_id": "120363000000000000@g.us",
    "action": "add",
    "participants": ["6281234567890"]
  }
  ```
  - `action`: `add` | `remove` | `promote` | `demote`
- **Response**:
  ```json
  {
    "success": true,
    "data": [ { "jid": "6281234567890@s.whatsapp.net", "status": "ok" } ]
  }
  ```

### 3.5 Ubah Info Grup
Mengubah nama dan/atau deskripsi grup.

- **URL**: `POST /groups/update-info`
- **Body**:
  ```json
  {
    "group_id": "120363000000000000@g.us",
    "subject": "Nama Baru",
    "description": "Deskripsi baru"
  }
  ```
- **Response**:
  ```json
  { "success": true, "message": "Group info updated" }
  ```

### 3.6 Kode Undangan Grup
Mendapatkan kode undangan dan link grup (khusus admin). Tidak merotasi kode.

- **URL**: `GET /groups/invite-code?group_id=120363000000000000@g.us`
- **Response**:
  ```json
  {
    "success": true,
    "data": {
      "code": "AbCdEfGh",
      "invite_url": "https://chat.whatsapp.com/AbCdEfGh"
    }
  }
  ```

### 3.7 Gabung Grup via Undangan
Bergabung ke grup menggunakan kode undangan.

- **URL**: `POST /groups/join`
- **Body**:
  ```json
  { "invite_code": "AbCdEfGh" }
  ```
- **Response**:
  ```json
  { "success": true, "data": { "jid": "120363...@g.us", "subject": "..." } }
  ```

### 3.8 Keluar Grup

- **URL**: `POST /groups/leave`
- **Body**:
  ```json
  { "group_id": "120363000000000000@g.us" }
  ```
- **Response**:
  ```json
  { "success": true, "message": "Left group" }
  ```

---

## 4. Integrasi Webhook

Webhook memungkinkan server Anda menerima notifikasi real-time saat terjadi aktivitas di akun WhatsApp yang terhubung.

### 4.1 Konfigurasi
Atur **Webhook URL** dan **Webhook Secret** di halaman **Pengaturan**.

### 4.2 Payload Webhook
Data dikirimkan menggunakan metode `POST` dengan format:
```json
{
  "event": "message.in",
  "data": { ... },
  "timestamp": 1735460000000
}
```

### 4.3 Jenis Event
- `message.in`: Pesan teks masuk.
- `message.out`: Pesan terkirim dari sistem atau perangkat.
- Untuk pesan dokumen/media, payload `message.in` dan `message.out` menyertakan `messageType` dan `attachment`.
- `interaction.button`: Pengguna menekan tombol pada pesan interaktif.
- `interaction.list`: Pengguna memilih opsi dari list message.
- `connection.update`: Perubahan status koneksi (connected, disconnected).

### 4.3.1 Payload Event Button Response
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

### 4.3.2 Payload Event List Response
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

### 4.4 Verifikasi Tanda Tangan (Signature)
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

## 5. Balas Otomatis (Auto-Reply)

Fitur ini memungkinkan bot menjawab pesan secara otomatis berdasarkan kata kunci.

- **Global Toggle**: Aktifkan/nonaktifkan fitur melalui menu Auto-Reply.
- **Aturan (Rules)**:
  - Kata kunci bersifat *case-insensitive*.
  - Mendukung pencocokan sebagian atau kata kunci yang persis.
  - Setiap aturan dapat diaktifkan/dinonaktifkan secara individu.

---

## 6. Manajemen User

Sistem ini mendukung multi-user dengan pembagian peran (role):
- **Admin**: Memiliki akses penuh ke semua fitur, termasuk manajemen user, pengaturan global, dan kunci API.
- **User**: Hanya dapat mengelola sesi WhatsApp dan aturan balas otomatis mereka sendiri.

*Catatan: User pertama yang mendaftar ke sistem secara otomatis akan mendapatkan peran **Admin**.*

---

## 7. Pesan Interaktif dengan Button

Fitur pesan interaktif memungkinkan Anda mengirim pesan dengan tombol atau list pilihan, meningkatkan engagement pengguna dan menyederhanakan response options.

### 7.1 Jenis Interactive Message

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

### 7.2 Best Practices

1. **Button Text**: Gunakan teks singkat dan jelas (maksimal 20 karakter per tombol)
2. **Button ID**: Gunakan ID yang deskriptif untuk tracking, contoh: `order_confirm`, `feedback_positive`
3. **Main Text**: Berikan konteks yang jelas sebelum tombol muncul
4. **Timeout**: Tangani timeout jika user tidak merespon dalam waktu tertentu

### 7.3 Contoh Use Cases

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

### 7.4 Error Handling

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
