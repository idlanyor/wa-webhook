import { MongoMemoryServer } from 'mongodb-memory-server';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

(async () => {
    try {
        const dbPath = join(__dirname, 'data', 'db');
        if (!existsSync(dbPath)) {
            mkdirSync(dbPath, { recursive: true });
        }

        console.log('Starting MongoDB Memory Server with persistence...');
        const mongod = await MongoMemoryServer.create({
            instance: {
                dbPath: dbPath,
                storageEngine: 'wiredTiger'
            }
        });

        const uri = mongod.getUri();
        console.log(`MongoDB Memory Server started at ${uri}`);

        // Override environment variable
        process.env.MONGODB_URI = uri;

        // Import and run original app
        console.log('Starting Application...');
        await import('./app.js');
    } catch (error) {
        console.error('Failed to start local server:', error);
        process.exit(1);
    }
})();
