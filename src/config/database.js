import { config } from './index.js';
import { info } from '../utils/logger.js';
import { initDb, closeDb, db, driverName } from '../db/index.js';

/**
 * Open the SQLite database and apply pending migrations.
 */
async function initializeDatabase() {
    if (db) return;
    await initDb(config.database.path);
    info(`🗄️ SQLite database ready at ${config.database.path} (driver: ${driverName})`);
}

function getDatabase() {
    return db;
}

export { initializeDatabase, getDatabase, closeDb };
