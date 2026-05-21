import mongoose from 'mongoose';
import { config } from './index.js';
import { info, error as _error } from '../utils/logger.js';

let isConnected = false;

async function initializeDatabase() {
    if (isConnected) return;

    try {
        const db = await mongoose.connect(config.mongodb.uri, {
            maxPoolSize: 10,          // Max simultaneous connections
            minPoolSize: 2,           // Keep at least 2 connections warm
            socketTimeoutMS: 45000,   // Close sockets after 45s of inactivity
            serverSelectionTimeoutMS: 5000, // Fail fast if no server found
            heartbeatFrequencyMS: 10000,    // Check server health every 10s
        });
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

        mongoose.connection.on('reconnected', () => {
            info('MongoDB reconnected');
            isConnected = true;
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