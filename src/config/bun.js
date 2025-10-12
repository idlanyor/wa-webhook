/**
 * Bun-specific configuration and optimizations
 */

export const bunConfig = {
    // Enable Bun's faster JSON parsing
    fastJSON: true,
    
    // Use Bun's optimized HTTP server features
    optimizeHTTP: true,
    
    // Enable hot reload in development
    hotReload: process.env.NODE_ENV === 'development',
    
    // Bun-specific database optimizations
    database: {
        connectionPooling: true,
        optimizedQueries: true,
        useNativeModules: true
    },
    
    // WebSocket optimizations
    websocket: {
        compression: true,
        binaryType: 'nodebuffer'
    },
    
    // File system optimizations
    filesystem: {
        useBunFS: true,
        asyncOperations: true
    },
    
    // Memory optimizations
    memory: {
        enableGC: true,
        optimizeStrings: true
    }
};

// Bun-specific utilities
export const bunUtils = {
    /**
     * Check if we're running on Bun
     */
    isBun() {
        return typeof Bun !== 'undefined';
    },
    
    /**
     * Get Bun version if available
     */
    getBunVersion() {
        return typeof Bun !== 'undefined' ? Bun.version : null;
    },
    
    /**
     * Use Bun's optimized JSON methods
     */
    parseJSON(str) {
        if (this.isBun() && bunConfig.fastJSON) {
            return JSON.parse(str); // Bun's JSON.parse is already optimized
        }
        return JSON.parse(str);
    },
    
    /**
     * Use Bun's optimized JSON stringify
     */
    stringifyJSON(obj) {
        if (this.isBun() && bunConfig.fastJSON) {
            return JSON.stringify(obj); // Bun's JSON.stringify is already optimized
        }
        return JSON.stringify(obj);
    },
    
    /**
     * Performance monitoring for Bun
     */
    measurePerformance(name, fn) {
        if (this.isBun()) {
            const start = Bun.nanoseconds();
            const result = fn();
            const end = Bun.nanoseconds();
            console.log(`⚡ [BUN] ${name}: ${(end - start) / 1000000}ms`);
            return result;
        } else {
            const start = performance.now();
            const result = fn();
            const end = performance.now();
            console.log(`🐢 [NODE] ${name}: ${end - start}ms`);
            return result;
        }
    }
};

