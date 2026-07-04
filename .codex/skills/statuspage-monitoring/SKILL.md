---
name: statuspage-monitoring
description: Project-specific workflow for maintaining the Atlassian Statuspage monitoring feature in discord-assistant-bot-v2. Use when Codex changes Statuspage API fetching, ETag or 304 behavior, notification deduplication, Discord status or incident message updates, scheduled checks, Statuspage commands, formatting, channels, or repository logic under src/statuspage.
---

# Statuspage Monitoring

## Workflow

1. Read `AGENTS.md`, `docs/SPEC.md`, and `docs/TASKS.md` before implementation.
2. Inspect the relevant Statuspage files before editing:
   - `src/statuspage/client.ts`
   - `src/statuspage/checker.ts`
   - `src/statuspage/formatter.ts`
   - `src/statuspage/repository.ts`
   - `src/statuspage/channels.ts`
   - `src/commands/statuspage.ts` when command behavior changes
3. Keep the existing persistence and notification guarantees intact:
   - use `{baseUrl}/api/v2/summary.json`
   - preserve `ETag` / `If-None-Match` handling
   - treat `304 Not Modified` as a successful check and update visible last-check time
   - do not duplicate incident or maintenance notifications
   - keep status messages edited in place when message IDs exist
   - store incident and maintenance Discord message IDs through repository logic
4. Ask before changing DB schema, adding external APIs, adding dependencies, or redesigning scheduler behavior.
5. Validate with `pnpm build` and `pnpm lint` after implementation.

## Change Guidance

- For notification text, colors, embed fields, or truncation, start in `formatter.ts`.
- For fetch behavior, URL normalization, response validation, or retryable API errors, start in `client.ts` and `schemas.ts`.
- For duplicate prevention, message recreation, resolved/completed handling, or last-check fields, start in `checker.ts` and `repository.ts`.
- For fixed Discord channel behavior and permissions, start in `channels.ts`.
- For slash command inputs and replies, use the `discord-command` skill as well.
- For schema or migration changes, use the `drizzle-db-change` skill as well.

## Examples

- When changing maintenance notification wording, update formatter behavior only unless timing or DB state must change.
- When changing when incidents are notified, inspect checker diff logic and repository event fields before editing so `lastUpdateId`, `messageId`, and resolved state remain consistent.
