import { existsSync } from 'node:fs';
import process from 'node:process';
import { defineConfig } from 'drizzle-kit';

if (!process.env.DATABASE_URL && existsSync('.env')) {
	process.loadEnvFile('.env');
}

export default defineConfig({
	schema: './src/db/schema.ts',
	out: './drizzle',
	dialect: 'postgresql',
	dbCredentials: {
		url: process.env.DATABASE_URL ?? '',
	},
});
