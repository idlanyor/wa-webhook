const { createClient } = require('@supabase/supabase-js');
const { config } = require('./index');
const { bunUtils } = require('./bun');

let supabase = null;

function initializeDatabase() {
    if (!config.supabase.url || !config.supabase.serviceKey) {
        throw new Error('Supabase URL and Service Key are required. Please check your .env file.');
    }

    // Bun-specific optimizations for database client
    const clientOptions = {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    };

    // Add Bun-specific optimizations if available
    if (config.runtime.isBun && config.performance.useNativeModules) {
        clientOptions.db = {
            schema: 'public'
        };
        clientOptions.global = {
            headers: {
                'X-Runtime': 'bun'
            }
        };
    }

    supabase = createClient(config.supabase.url, config.supabase.serviceKey, clientOptions);

    // Log database initialization with runtime info
    if (config.runtime.isBun) {
        console.log('⚡ Database client initialized with Bun optimizations');
    } else {
        console.log('🔧 Database client initialized with Node.js');
    }

    return supabase;
}

function getDatabase() {
    if (!supabase) {
        return initializeDatabase();
    }
    return supabase;
}

// Optimized query wrapper for Bun
function optimizedQuery(queryFn) {
    if (config.runtime.isBun && config.performance.optimizedJSON) {
        return bunUtils.measurePerformance('Database Query', queryFn);
    }
    return queryFn();
}

module.exports = { initializeDatabase, getDatabase, optimizedQuery };

// Create a scoped client with Authorization header for per-request RLS context
function createScopedClient(accessToken) {
    return createClient(config.supabase.url, config.supabase.serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { headers: { Authorization: `Bearer ${accessToken}` } }
    });
}

module.exports.createScopedClient = createScopedClient;
