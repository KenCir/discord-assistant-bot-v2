import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

const forceRefreshCustomIdPrefix = 'statuspage-force-refresh:';

export function createStatuspageForceRefreshCustomId(statusPageId: string): string {
	return `${forceRefreshCustomIdPrefix}${statusPageId}`;
}

export function parseStatuspageForceRefreshCustomId(customId: string): string | null {
	if (!customId.startsWith(forceRefreshCustomIdPrefix)) {
		return null;
	}

	const statusPageId = customId.slice(forceRefreshCustomIdPrefix.length);

	return statusPageId.length > 0 ? statusPageId : null;
}

export function createStatuspageStatusMessageComponents(statusPageId: string): ActionRowBuilder<ButtonBuilder>[] {
	return [
		new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId(createStatuspageForceRefreshCustomId(statusPageId))
				.setLabel('再取得')
				.setStyle(ButtonStyle.Secondary),
		),
	];
}
