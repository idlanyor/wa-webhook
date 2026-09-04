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
        uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/whatsapp-webhook',
    },
    // Store backend for zapo-js session state (credentials + Signal state).
    // Defaults to the app's MongoDB URI and its database name.
    zapoStore: {
        uri: process.env.ZAPO_STORE_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/whatsapp-webhook',
        database: process.env.ZAPO_STORE_DB || extractDatabaseName(
            process.env.ZAPO_STORE_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/whatsapp-webhook'
        ),
    },
    session: {
        secret: process.env.SESSION_SECRET || 'default-secret',
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
    whatsapp: {
        keepAliveIntervalMs: 20000,      // Interval (ms) for keep-alive presence updates
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

/**
 * Extract the database name from a MongoDB connection string (the path segment).
 * @private
 */
function extractDatabaseName(uri) {
    try {
        const parsed = new URL(uri);
        const name = parsed.pathname?.replace(/^\//, '').split('/')[0] || '';
        return name || 'whatsapp-webhook';
    } catch {
        return 'whatsapp-webhook';
    }
}

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

    // Warn if using default session secret in production
    if (config.node_env === 'production' && config.session.secret === 'default-secret') {
        throw new Error('SESSION_SECRET must be set to a strong random value in production!');
    }
    
    // Log runtime information
    console.log(`🚀 Running on ${config.runtime.name} runtime`);
    if (config.runtime.isBun) {
        console.log('⚡ Bun optimizations enabled');
    }
}

