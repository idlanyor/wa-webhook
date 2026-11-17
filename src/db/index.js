/**
 * SQLite database (Drizzle ORM).
 *
 * Driver: `bun:sqlite` under Bun, `better-sqlite3` under Node. Pending
 * migrations from ./drizzle are applied on startup.
 */
import { mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import * as schema from './schema.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle');

/** Drizzle database instance; set by initDb(). */
export let db = null;
/** Underlying driver connection; set by initDb(). */
export let sqlite = null;
export let driverName = null;

/**
 * Open the database and apply migrations.
 * @param {string} path - File path, or ':memory:'
 */
export async function initDb(path) {
    if (db) return db;
    const file = path === ':memory:' ? path : resolve(path);
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });

    let migrate;
    if (typeof Bun !== 'undefined') {
        const { Database } = await import('bun:sqlite');
        const { drizzle } = await import('drizzle-orm/bun-sqlite');
        ({ migrate } = await import('drizzle-orm/bun-sqlite/migrator'));
        sqlite = new Database(file, { create: true });
        db = drizzle({ client: sqlite, schema });
        driverName = 'bun:sqlite';
    } else {
        const { default: Database } = await import('better-sqlite3');
        const { drizzle } = await import('drizzle-orm/better-sqlite3');
        ({ migrate } = await import('drizzle-orm/better-sqlite3/migrator'));
        sqlite = new Database(file);
        db = drizzle({ client: sqlite, schema });
        driverName = 'better-sqlite3';
    }

    sqlite.exec('PRAGMA journal_mode = WAL');
    sqlite.exec('PRAGMA synchronous = NORMAL');
    sqlite.exec('PRAGMA busy_timeout = 5000');
    sqlite.exec('PRAGMA foreign_keys = ON');

    migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    return db;
}

export function closeDb() {
    if (sqlite) sqlite.close();
    db = null;
    sqlite = null;
}

export { schema };
