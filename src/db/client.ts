import process from 'node:process';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
	throw new Error('DATABASE_URL is required.');
}

export const pool = new Pool({
	connectionString: databaseUrl,
	options: '-c timezone=Asia/Tokyo',
});
export const db = drizzle(pool, { schema });
