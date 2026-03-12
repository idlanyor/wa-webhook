import { GoogleGenAI } from "@google/genai";
import { getMany } from './SettingsService.js';
import Product from '../models/Product.js';
import ProductField from '../models/ProductField.js';
import { info, error as logError } from '../utils/logger.js';

class GeminiService {
    constructor() {
        this.client = null;
        this.modelName = "gemini-2.0-flash"; // Default model, can be made configurable
    }

    async getClient() {
        const settings = await getMany(['gemini_api_key', 'gemini_model']);
        const apiKey = settings.get('gemini_api_key');
        const model = settings.get('gemini_model');
        
        if (model) this.modelName = model;

        if (!apiKey) {
            throw new Error("Gemini API Key not found in settings");
        }

        // Singleton-like: Recreate only if key changes or doesn't exist (though key change handling is tricky here, simpler to just new it up if needed, but the SDK is lightweight)
        // For now, let's create a new instance to ensure we always use the latest key
        return new GoogleGenAI({ apiKey });
    }

    /**
     * Builds the system instruction including the persona and the product knowledge base.
     */
    async buildSystemInstruction() {
        const settings = await getMany(['gemini_system_instruction']);
        const baseInstruction = settings.get('gemini_system_instruction') || 
            `Kamu adalah Customer Service WhatsApp untuk layanan hosting dan VPS.

ATURAN WAJIB:
- SELALU gunakan Bahasa Indonesia.
- Jangan gunakan Bahasa Inggris atau campuran.
- Jawab HANYA berdasarkan data produk yang diberikan.
- Jangan mengarang spesifikasi, harga, atau arti teknis.
- Jangan menyebut kata AI, database, sistem, atau mongodb.
- Jika data tidak tersedia, katakan dengan sopan bahwa informasinya belum tersedia.

GAYA JAWABAN:
- Ramah
- Singkat
- Profesional
- Mudah dipahami

FITUR PEMESANAN OTOMATIS:
- Jika user menyatakan ingin MEMBELI atau MEMESAN produk yang ada di data (misal: "saya mau beli vps 2"), kamu wajib menyertakan sinyal order di paling akhir jawabanmu.
- Sinyal order harus dalam format: [ORDER_SIGNAL: {"product": "Nama Produk", "price": "Harga"}]
- Ganti "Nama Produk" dan "Harga" sesuai data di tabel.
- Jangan tampilkan sinyal ini kepada user secara mentah jika memungkinkan, tapi sistem akan menghapusnya nanti. Jawab saja seperti biasa, lalu tambahkan sinyal tersebut di baris baru paling bawah.`;

        // Fetch Product Fields (Columns)
        const fields = await ProductField.find({}).sort({ order: 1 }).lean();
        
        // Fetch Active Products
        const products = await Product.find({ isActive: true }).lean();

        if (products.length === 0) {
            return `${baseInstruction}\n\nCurrently, there is no product data available.`;
        }

        // Format Knowledge Base
        let knowledgeBase = "CURRENT PRODUCT DATA (Knowledge Base):\n";
        
        // Header
        const headers = ['Name', ...fields.map(f => f.label)];
        knowledgeBase += headers.join(" | ") + "\n";
        knowledgeBase += "-".repeat(50) + "\n";

        // Rows
        for (const p of products) {
            const row = [p.name];
            for (const f of fields) {
                // p.data is a Map in Mongoose, but .lean() might return it as object or we need to access it carefully
                // In lean(), 'data' might be a plain object if the schema defined it as Map. 
                // Let's handle both Map and Object access safely.
                let val = '';
                if (p.data && typeof p.data.get === 'function') {
                    val = p.data.get(f.key);
                } else if (p.data) {
                    val = p.data[f.key];
                }
                row.push(val !== undefined && val !== null ? val : '-');
            }
            knowledgeBase += row.join(" | ") + "\n";
        }

        return `${baseInstruction}\n\n${knowledgeBase}\n\nFORMAT JAWABAN WAJIB:

Jika produk ditemukan:
- Awali dengan konfirmasi singkat (misal: "Ada nih 😊")
- Tampilkan spesifikasi dalam bentuk poin:
> Nama Produk
  • CPU
  • RAM
  • Storage
  • Harga
- Akhiri dengan kalimat bantuan lanjutan (misal: "Mau dibantu order atau bandingin paket lain?")

Jika produk tidak ditemukan:
- Sampaikan dengan sopan
- Jangan menyarankan produk yang tidak ada di data
.`;
    }

    /**
     * Generate a response from Gemini
     * @param {string} userMessage - The current message from the user
     * @param {Array} history - Array of previous messages { role: 'user' | 'model', parts: [{ text: '...' }] }
     */
    async generateResponse(userMessage, history = []) {
        try {
            const client = await this.getClient();
            const systemInstruction = await this.buildSystemInstruction();

            const model = client.models;

            // Using the new @google/genai signature
            // https://github.com/google/google-genai-sdk-node
            // It seems the structure is client.models.generateContent({ model: '...', contents: ... })
            
            // Format history for the new SDK if necessary.
            // The SDK expects 'role' ('user' or 'model') and 'parts' ([{ text: '...' }]).
            // Our history input should already be close to this, but let's ensure.
            
            const contents = [
                ...history,
                {
                    role: 'user',
                    parts: [{ text: userMessage }]
                }
            ];

            const response = await client.models.generateContent({
                model: this.modelName,
                config: {
                    systemInstruction: {
                        parts: [{ text: systemInstruction }]
                    }
                },
                contents: contents
            });

            // Parse response
            if (response && response.candidates && response.candidates.length > 0) {
                // The structure might vary slightly, usually candidates[0].content.parts[0].text
                const candidate = response.candidates[0];
                if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
                    return candidate.content.parts[0].text;
                }
            }

            return null;

        } catch (error) {
            logError("Gemini API Error:", error);
            // Fallback or rethrow? 
            // Better to return null so the caller knows it failed
            return null;
        }
    }
}

export default new GeminiService();
