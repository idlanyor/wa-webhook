import { defineConfig } from 'drizzle-kit';

export default defineConfig({
    dialect: 'sqlite',
    schema: './src/db/schema.js',
    out: './drizzle',
    dbCredentials: {
        url: process.env.SQLITE_PATH || './data/wa-webhook.db'
    }
});
