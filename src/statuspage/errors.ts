import { DiscordAPIError } from 'discord.js';
import { StatuspageFetchError } from './client.js';

const maxStoredErrorLength = 500;

export function formatStoredError(error: unknown): string {
	const message = formatErrorMessage(error);

	if (message.length <= maxStoredErrorLength) {
		return message;
	}

	return `${message.slice(0, maxStoredErrorLength - 3)}...`;
}

export function formatUserError(error: unknown): string {
	if (error instanceof StatuspageFetchError) {
		return `Statuspage API エラー: ${error.message}`;
	}

	if (error instanceof DiscordAPIError) {
		return `Discord API エラー: ${error.message}`;
	}

	if (error instanceof Error) {
		return error.message;
	}

	return 'Unknown error';
}

function formatErrorMessage(error: unknown): string {
	if (error instanceof StatuspageFetchError) {
		return `Statuspage API error: ${error.message}`;
	}

	if (error instanceof DiscordAPIError) {
		return `Discord API error: ${error.code} ${error.message}`;
	}

	if (error instanceof Error) {
		return `${error.name}: ${error.message}`;
	}

	return 'Unknown error';
}
