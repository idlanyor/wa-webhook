import mongoose from 'mongoose';
import { config } from './index.js';
import { info, error as _error } from '../utils/logger.js';

let isConnected = false;

async function initializeDatabase() {
    if (isConnected) return;

    try {
        const db = await mongoose.connect(config.mongodb.uri);
        isConnected = !!db.connections[0].readyState;
        
        info('🚀 MongoDB connected successfully');
        
        // Handle connection errors after initial connection
        mongoose.connection.on('error', (err) => {
            _error('MongoDB connection error:', err);
        });

        mongoose.connection.on('disconnected', () => {
            info('MongoDB disconnected');
            isConnected = false;
        });

    } catch (err) {
        _error('Failed to connect to MongoDB:', err);
        throw err;
    }
}

function getDatabase() {
    return mongoose.connection;
}

// Mock optimizedQuery for compatibility with existing code
function optimizedQuery(queryFn) {
    return queryFn();
}

// Mock createScopedClient for compatibility (not needed for MongoDB/Mongoose)
function createScopedClient() {
    return null;
}

export { initializeDatabase, getDatabase, optimizedQuery, createScopedClient };