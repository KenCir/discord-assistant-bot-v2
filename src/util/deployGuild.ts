import process from 'node:process';
import { API } from '@discordjs/core/http-only';
import { ApplicationCommandType, REST } from 'discord.js';
import { loadCommands } from './loaders.js';

const commands = await loadCommands(new URL('../commands/', import.meta.url));
const commandData = [...commands.values()]
	.map((command) => command.data)
	.filter((data) => data.type !== ApplicationCommandType.PrimaryEntryPoint);

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN!);
const api = new API(rest);

const result = await api.applicationCommands.bulkOverwriteGuildCommands(
	process.env.APPLICATION_ID!,
	process.env.GUILD_ID!,
	commandData,
);

console.log(`Successfully registered ${result.length} commands.`);
