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
    // SQLite database files
    database: {
        path: process.env.SQLITE_PATH || './data/wa-webhook.db',
        zapoSqlitePath: process.env.ZAPO_SQLITE_PATH || './data/wa-session.db',
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

// Validate required environment variables
export const MIN_NODE_MAJOR = 22;

export function validateConfig() {
    // Node 22+ is required: zapo-js needs the global WebSocket (unflagged since Node 22).
    if (!runtime.isBun) {
        const major = parseInt(process.versions.node.split('.')[0], 10);
        if (major < MIN_NODE_MAJOR) {
            throw new Error(
                `Node.js ${MIN_NODE_MAJOR}+ is required (running ${process.versions.node}). ` +
                'Upgrade Node.js or run with Bun.'
            );
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

