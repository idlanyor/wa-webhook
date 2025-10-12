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
    supabase: {
        url: process.env.SUPABASE_URL,
        serviceKey: process.env.SUPABASE_SERVICE_KEY,
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
    const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY'];
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
        throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
    
    // Log runtime information
    console.log(`🚀 Running on ${config.runtime.name} runtime`);
    if (config.runtime.isBun) {
        console.log('⚡ Bun optimizations enabled');
    }
}

