---
name: discord-command
description: Project-specific workflow for adding or modifying Discord slash commands in discord-assistant-bot-v2. Use when Codex works on files under src/commands, command registration, discord.js ChatInputCommandInteraction handling, slash command permissions, subcommands, or command replies for this TypeScript Discord bot.
---

# Discord Command

## Workflow

1. Read `AGENTS.md`, `docs/SPEC.md`, and `docs/TASKS.md` before implementation.
2. Inspect the existing command shape before editing:
   - `src/commands/index.ts`
   - the target file in `src/commands/`
   - `src/events/interactionCreate.ts` when dispatch behavior may matter
3. Match the local command pattern:
   - export a `Command` object with `data` and `execute`
   - use discord.js v14 types already used in the repo
   - split large subcommand behavior into local handler functions
   - keep user-facing command text in Japanese
4. Do not add dependencies, external APIs, large refactors, or new persistent state without user confirmation.
5. Validate with `pnpm build` and `pnpm lint` unless the requested change is documentation-only.

## Command Rules

- For guild-only behavior, check `interaction.guildId` and return a concrete Japanese error message when absent.
- Prefer the existing `deferReply()` then `editReply()` flow for commands that may perform I/O.
- Keep replies as normal messages unless the surrounding command already uses ephemeral replies or the user explicitly requests ephemeral behavior.
- Preserve Discord permission policy. For administrative commands, follow existing `default_member_permissions` examples such as `PermissionFlagsBits.ManageChannels.toString()`.
- When adding a command file, confirm it is exported or loaded by the existing command loader.

## Examples

- When adding `/github-watch status`, inspect the existing `githubWatch.ts` command object, reuse its subcommand switch style, and add a local handler rather than introducing a new dispatcher.
- When changing `/statuspage refresh`, preserve the existing cooldown behavior, `deferReply()` usage, and concrete Japanese success/failure messages.
