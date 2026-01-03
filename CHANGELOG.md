# Changelog - Enhanced WhatsApp Webhook Features

## Version 2.0 - Interactive Buttons & Pairing Code Support

### 🎉 Major Features Added

#### 1. Interactive Buttons Support (buttons-warpper)
- ✅ Integrated `buttons-warpper@1.2.0` for enhanced button compatibility
- ✅ Support for all button types:
  - `quick_reply` - Quick reply buttons
  - `cta_url` - URL/link buttons
  - `cta_copy` - Copy to clipboard
  - `cta_call` - Call buttons
  - `single_select` - List selection
  - `cta_catalog` - Business catalog
  - `send_location` - Location request
  - And more...
- ✅ Automatic binary node injection (`biz`, `interactive`, `native_flow`, `bot`)
- ✅ Compatible with private chats and groups

**New API Endpoint:**
```
POST /send-interactive
Content-Type: application/json
x-api-key: YOUR_API_KEY

{
  "to": "6283891882373",
  "text": "Choose an option",
  "title": "Menu",
  "footer": "Powered by Bot",
  "interactiveButtons": [
    {
      "name": "quick_reply",
      "buttonParamsJson": "{\"display_text\":\"Option 1\",\"id\":\"opt1\"}"
    }
  ]
}
```

#### 2. Pairing Code Authentication
- ✅ Alternative authentication method to QR code
- ✅ Automatic phone number normalization (08xxx → 628xxx)
- ✅ UI support in dashboard
- ✅ Reliable WebSocket connection handling

**New API Endpoint:**
```
POST /pairing-code
Content-Type: application/json

{
  "phoneNumber": "6283891882373"
}
```

#### 3. Persistent Local Development
- ✅ MongoDB Memory Server with data persistence
- ✅ Data stored in `data/db` directory
- ✅ No data loss on server restarts
- ✅ New script: `npm run start:local`

### 📦 Dependencies Added
```json
{
  "buttons-warpper": "^1.2.0",
  "baileys-shard": "^0.0.7",
  "mongodb-memory-server": "^11.0.1"
}
```

### 🐛 Bug Fixes
- Fixed duplicate `requestPairingCode` function in frontend
- Corrected API endpoint paths
- Improved browser configuration for better compatibility
- Fixed pairing code WebSocket connection reliability

### 📝 Files Modified
**Backend:**
- `src/services/WhatsAppService.js` - Added buttons-warpper integration & pairing code
- `src/routes/whatsapp.js` - Added new endpoints
- `package.json` - Added dependencies

**Frontend:**
- `views/partials/qr-container.ejs` - Added pairing code UI
- `views/partials/scripts.ejs` - Fixed duplicate functions

**Development:**
- `start_local.js` - New file for local development with persistence

### 🔄 Commits
1. `d4ac1cc` - Remove PR documentation files
2. `973d014` - Add pull request documentation for upstream contribution
3. `fd9effa` - Remove interactive button test UI from dashboard
4. `2b905c2` - Integrate buttons-warpper and baileys-shard modules
5. `b9875f0` - Add interactive button test feature to dashboard
6. `fa1c969` - Remove conflicting duplicate requestPairingCode function
7. `7b50f3e` - Fix pairing code endpoint and browser config
8. `5b1d2c2` - Fix pairing code connection reliability
9. `c22101e` - Add pairing code connection method
10. `6249899` - Add interactive button feature

### ✅ Testing
- Interactive buttons tested successfully
- Pairing code generation verified
- API endpoints functional
- Session persistence working
- No breaking changes

### 📚 Documentation
- Complete API documentation in README
- Interactive buttons usage examples
- Pairing code setup guide

### 🔐 Backward Compatibility
- ✅ All existing features remain functional
- ✅ No breaking changes
- ✅ New features are optional
- ✅ Existing API endpoints unchanged

---

**Repository:** https://github.com/yemobyte/wa-webhook  
**Date:** January 3, 2026  
**Author:** yemobyte
