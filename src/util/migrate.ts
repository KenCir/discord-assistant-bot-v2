import process from 'node:process';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from '../db/client.js';
import { logger } from './logger.js';

try {
	logger.info('Starting database migration.');
	await migrate(db, { migrationsFolder: './drizzle' });
	logger.info('Database migration completed.');
} catch (error) {
	logger.error({ error }, 'Database migration failed.');
	process.exitCode = 1;
} finally {
	await pool.end();
}
