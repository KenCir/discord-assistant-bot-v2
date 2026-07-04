---
name: drizzle-db-change
description: Project-specific workflow for Drizzle ORM database changes in discord-assistant-bot-v2. Use when Codex changes src/db/schema.ts, Drizzle migrations under drizzle, repository functions, database client behavior, PostgreSQL persistence, migration commands, or code that depends on DATABASE_URL.
---

# Drizzle DB Change

## Workflow

1. Read `AGENTS.md`, `docs/SPEC.md`, and `docs/TASKS.md` before implementation.
2. Inspect the current DB shape before editing:
   - `src/db/schema.ts`
   - `src/db/client.ts`
   - affected repository/service files
   - `drizzle.config.ts`
   - existing SQL and snapshots under `drizzle/`
3. Treat DB schema changes as important decisions. Confirm with the user before adding tables, columns, indexes, enums, constraints, or changing migration strategy.
4. Follow the repo's codebase-first Drizzle flow:
   - edit `src/db/schema.ts`
   - generate SQL with `pnpm db:generate`
   - review generated SQL and snapshots
   - do not use `drizzle-kit push` unless the user explicitly asks
5. Validate with `pnpm build` and `pnpm lint` after implementation.

## Project Constraints

- Do not edit `.env*`.
- Read `DATABASE_URL` from the execution environment only.
- Do not create a new `.pnpm-store`.
- Do not run `git commit` or `git push`.
- Keep repository APIs aligned with schema types from `src/db/schema.ts`.
- Avoid storing Discord channel IDs in DB when the feature specification says fixed environment variables should be used.

## Examples

- When adding a column to `github_watched_repositories`, update `src/db/schema.ts`, generate a migration, update the GitHub watch repository/service code, and verify build/lint.
- When changing `status_pages`, confirm the schema change first because it can affect Statuspage scheduling, message IDs, and duplicate-notification prevention.
