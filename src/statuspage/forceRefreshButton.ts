import { MessageFlags, PermissionFlagsBits, type ButtonInteraction } from 'discord.js';
import { parseStatuspageForceRefreshCustomId } from './buttons.js';
import { checkStatusPage } from './checker.js';
import { formatUserError } from './errors.js';
import { findStatusPageById } from './repository.js';

const forceRefreshCooldownMs = 60_000;
const forceRefreshCooldowns = new Map<string, number>();

export async function handleStatuspageForceRefreshButton(interaction: ButtonInteraction): Promise<boolean> {
	const statusPageId = parseStatuspageForceRefreshCustomId(interaction.customId);

	if (!statusPageId) {
		return false;
	}

	await interaction.deferReply({ flags: MessageFlags.Ephemeral });

	try {
		if (!interaction.inGuild() || !interaction.guildId) {
			await interaction.editReply('このボタンはサーバー内でのみ使用できます。');
			return true;
		}

		if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
			await interaction.editReply('このボタンを使用するには Manage Channels 権限が必要です。');
			return true;
		}

		const statusPage = await findStatusPageById(statusPageId);

		if (statusPage?.guildId !== interaction.guildId) {
			await interaction.editReply('この Statuspage 監視対象は見つかりませんでした。');
			return true;
		}

		if (!statusPage.enabled) {
			await interaction.editReply(`${statusPage.name} は無効です。有効化してから再取得してください。`);
			return true;
		}

		if (!statusPage.statusMessageId || statusPage.statusMessageId !== interaction.message.id) {
			await interaction.editReply('このステータスメッセージは現在の監視対象メッセージではありません。');
			return true;
		}

		const cooldownKey = `${interaction.guildId}:${statusPage.id}`;
		const now = Date.now();
		const lastRefreshAt = forceRefreshCooldowns.get(cooldownKey);

		if (lastRefreshAt && now - lastRefreshAt < forceRefreshCooldownMs) {
			const remainingSeconds = Math.ceil((forceRefreshCooldownMs - (now - lastRefreshAt)) / 1_000);
			await interaction.editReply(`この監視対象は直近で再取得済みです。${remainingSeconds}秒後に再実行してください。`);
			return true;
		}

		forceRefreshCooldowns.set(cooldownKey, now);
		const result = await checkStatusPage(interaction.client, statusPage, { forceRefresh: true });

		if (result.type === 'not_modified') {
			await interaction.editReply(
				[
					`${statusPage.name} を強制再取得しました。`,
					'Statuspage API は更新なしでした。',
					`最終確認: <t:${Math.floor(result.checkedAt.getTime() / 1_000)}:F>`,
				].join('\n'),
			);
			return true;
		}

		await interaction.editReply(
			[
				`${statusPage.name} を強制再取得し、status message を更新しました。`,
				`status message ID: ${result.statusMessageId}`,
				`障害・メンテ通知: ${result.incidentNotifications + result.maintenanceNotifications}件`,
				`最終確認: <t:${Math.floor(result.checkedAt.getTime() / 1_000)}:F>`,
			].join('\n'),
		);
	} catch (error) {
		await interaction.editReply(
			[
				'Statuspage の強制再取得に失敗しました。',
				`理由: ${formatUserError(error)}`,
				'詳細は /statuspage show の最終エラーも確認してください。',
			].join('\n'),
		);
	}

	return true;
}
