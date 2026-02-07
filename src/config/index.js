import 'dotenv/config';

// Runtime detection
const runtime = {
    isBun: typeof Bun !== 'undefined',
    isNode: typeof process !== 'undefined' && process.versions && process.versions.node,
    name: typeof Bun !== 'undefined' ? 'bun' : 'node'
};

export const config = {
    runtime,
    port: process.env.PORT || 8181,
    node_env: process.env.NODE_ENV || 'development',
    mongodb: {
        uri: process.env.MONGODB_URI || 'mongodb+srv://Vercel-Admin-database-didiwww:60zqjCetLtkWGgcf@database-didiwww.6bg22pr.mongodb.net/?retryWrites=true&w=majority',
    },
    session: {
        secret: process.env.SESSION_SECRET || 'default-secret',
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
    whatsapp: {
        keepAliveInterval: 25000,
        keepAliveIntervalMs: 20000,
        markOnlineOnConnect: false,
        // Bun-specific optimizations
        ...(runtime.isBun && {
            enableFastRefresh: true,
            optimizedSocketIO: true
        })
    },
    upload: {
        allowedExtensions: ['.vcf', '.csv'],
        allowedMimeTypes: [
            'text/vcard', 
            'text/x-vcard', 
            'text/csv', 
            'application/vnd.ms-excel'
        ],
    },
    pagination: {
        defaultPageSize: 15,
    },
    performance: {
        // Bun has better performance characteristics
        enableCaching: runtime.isBun,
        useNativeModules: runtime.isBun,
        optimizedJSON: runtime.isBun
    }
};

// Validate required environment variables
export function validateConfig() {
    const required = ['MONGODB_URI'];
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
        // Fallback for local development if not provided
        if (config.node_env === 'development') {
            console.warn(`⚠️ MONGODB_URI not found in .env, using default: ${config.mongodb.uri}`);
        } else {
            throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
        }
    }
    
    // Log runtime information
    console.log(`🚀 Running on ${config.runtime.name} runtime`);
    if (config.runtime.isBun) {
        console.log('⚡ Bun optimizations enabled');
    }
}

