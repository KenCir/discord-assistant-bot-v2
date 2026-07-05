import {
	ActionRowBuilder,
	ApplicationCommandOptionType,
	ApplicationCommandType,
	ButtonBuilder,
	ButtonStyle,
	ComponentType,
	EmbedBuilder,
	PermissionFlagsBits,
	type ChatInputCommandInteraction,
	type InteractionEditReplyOptions,
} from 'discord.js';
import { getFixedStatuspageChannels } from '../statuspage/channels.js';
import { checkStatusPage } from '../statuspage/checker.js';
import {
	createSummaryUrl,
	fetchStatusSummary,
	normalizeStatuspageUrl,
	StatuspageFetchError,
} from '../statuspage/client.js';
import { formatUserError } from '../statuspage/errors.js';
import { formatStatusIndicator } from '../statuspage/formatter.js';
import {
	createStatusPage,
	disableStatusPage,
	findStatusPageByGuildAndBaseUrl,
	findStatusPageByTarget,
	listStatusPagesByGuild,
	reactivateStatusPage,
	updateStatusPageLastCheck,
	updateStatusPageSettings,
} from '../statuspage/repository.js';
import { StatusIndicatorSchema } from '../statuspage/schemas.js';
import type { Command } from './index.js';

const defaultCheckIntervalMinutes = 10;
const listPageSize = 5;
const minCheckIntervalMinutes = 5;
const paginationTimeoutMs = 120_000;
const refreshCooldownMs = 60_000;
const refreshCooldowns = new Map<string, number>();

export default {
	data: {
		name: 'statuspage',
		description: 'Statuspage の監視対象を管理します。',
		type: ApplicationCommandType.ChatInput,
		default_member_permissions: PermissionFlagsBits.ManageChannels.toString(),
		options: [
			{
				type: ApplicationCommandOptionType.Subcommand,
				name: 'add',
				description: 'Statuspage の監視対象を追加します。',
				options: [
					{
						type: ApplicationCommandOptionType.String,
						name: 'name',
						description: '表示名。例: VRChat',
						required: true,
					},
					{
						type: ApplicationCommandOptionType.String,
						name: 'url',
						description: 'Statuspage URL。例: https://status.vrchat.com',
						required: true,
					},
					{
						type: ApplicationCommandOptionType.Role,
						name: 'mention_role',
						description: '新規障害・重要更新時にメンションするロール。',
						required: false,
					},
					{
						type: ApplicationCommandOptionType.Integer,
						name: 'check_interval_minutes',
						description: 'チェック間隔。最小5分、未指定時は10分。',
						required: false,
						min_value: minCheckIntervalMinutes,
					},
				],
			},
			{
				type: ApplicationCommandOptionType.Subcommand,
				name: 'list',
				description: '登録済み Statuspage を一覧表示します。',
			},
			{
				type: ApplicationCommandOptionType.Subcommand,
				name: 'show',
				description: '登録済み Statuspage の詳細を表示します。',
				options: [
					{
						type: ApplicationCommandOptionType.String,
						name: 'target',
						description: '登録 ID、表示名、または URL。',
						required: true,
					},
				],
			},
			{
				type: ApplicationCommandOptionType.Subcommand,
				name: 'update',
				description: '登録済み Statuspage の設定を更新します。',
				options: [
					{
						type: ApplicationCommandOptionType.String,
						name: 'target',
						description: '登録 ID、表示名、または URL。',
						required: true,
					},
					{
						type: ApplicationCommandOptionType.String,
						name: 'name',
						description: '新しい表示名。',
						required: false,
					},
					{
						type: ApplicationCommandOptionType.Role,
						name: 'mention_role',
						description: '新しいメンションロール。',
						required: false,
					},
					{
						type: ApplicationCommandOptionType.Integer,
						name: 'check_interval_minutes',
						description: 'チェック間隔。最小5分。',
						required: false,
						min_value: minCheckIntervalMinutes,
					},
					{
						type: ApplicationCommandOptionType.Boolean,
						name: 'enabled',
						description: '監視の有効・無効。',
						required: false,
					},
				],
			},
			{
				type: ApplicationCommandOptionType.Subcommand,
				name: 'refresh',
				description: '指定した Statuspage を即時チェックします。',
				options: [
					{
						type: ApplicationCommandOptionType.String,
						name: 'target',
						description: '登録 ID、表示名、または URL。',
						required: true,
					},
				],
			},
			{
				type: ApplicationCommandOptionType.Subcommand,
				name: 'remove',
				description: 'Statuspage の監視対象を無効化します。',
				options: [
					{
						type: ApplicationCommandOptionType.String,
						name: 'target',
						description: '登録 ID、表示名、または URL。',
						required: true,
					},
				],
			},
		],
	},
	async execute(interaction) {
		if (!interaction.isChatInputCommand()) {
			await interaction.reply({
				content: 'このコマンドはチャット入力コマンドとして実行してください。',
			});
			return;
		}

		if (!interaction.guildId) {
			await interaction.reply({
				content: 'このコマンドはサーバー内でのみ使用できます。',
			});
			return;
		}

		await interaction.deferReply();

		const subcommand = interaction.options.getSubcommand();

		try {
			switch (subcommand) {
				case 'add':
					await handleAdd(interaction, interaction.guildId);
					return;
				case 'list':
					await handleList(interaction, interaction.guildId);
					return;
				case 'show':
					await handleShow(interaction, interaction.guildId);
					return;
				case 'update':
					await handleUpdate(interaction, interaction.guildId);
					return;
				case 'refresh':
					await handleRefresh(interaction, interaction.guildId);
					return;
				case 'remove':
					await handleRemove(interaction, interaction.guildId);
					return;
				default:
					await interaction.editReply(`未対応のサブコマンドです: ${subcommand}`);
			}
		} catch (error) {
			await interaction.editReply(formatCommandError(error, subcommand));
		}
	},
} satisfies Command;

async function handleAdd(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
	const name = interaction.options.getString('name', true).trim();
	const rawUrl = interaction.options.getString('url', true);
	const mentionRole = interaction.options.getRole('mention_role');
	const checkIntervalMinutes = interaction.options.getInteger('check_interval_minutes') ?? defaultCheckIntervalMinutes;
	const checkIntervalSeconds = Math.max(checkIntervalMinutes, minCheckIntervalMinutes) * 60;

	if (!name) {
		await interaction.editReply('表示名は空にできません。');
		return;
	}

	let baseUrl: string;

	try {
		baseUrl = normalizeStatuspageUrl(rawUrl);
		await getFixedStatuspageChannels(interaction.client);

		const result = await fetchStatusSummary(baseUrl);

		if (result.type !== 'modified') {
			await interaction.editReply('Statuspage API を検証できませんでした。時間を置いて再度実行してください。');
			return;
		}

		const existing = await findStatusPageByGuildAndBaseUrl(guildId, baseUrl);
		const values = {
			name,
			mentionRoleId: mentionRole?.id ?? null,
			checkIntervalSeconds,
		};

		if (existing?.enabled) {
			await interaction.editReply(`既に登録されています。\nURL: ${baseUrl}`);
			return;
		}

		const statusPage = existing
			? await reactivateStatusPage(existing.id, values)
			: await createStatusPage({
					guildId,
					baseUrl,
					lastEtag: result.etag,
					lastStatusIndicator: result.data.status.indicator,
					lastCheckedAt: new Date(),
					lastSuccessAt: new Date(),
					...values,
				});

		if (existing) {
			await updateStatusPageLastCheck(statusPage.id, {
				lastCheckedAt: new Date(),
				lastSuccessAt: new Date(),
				lastError: null,
				lastEtag: result.etag,
				lastStatusIndicator: result.data.status.indicator,
			});
		}

		await interaction.editReply(
			[
				`${statusPage.name} を監視対象に${existing ? '再追加' : '追加'}しました。`,
				`URL: ${statusPage.baseUrl}`,
				`API: ${createSummaryUrl(statusPage.baseUrl)}`,
				`現在のステータス: ${formatStatusIndicator(result.data.status.indicator)}`,
				`チェック間隔: ${statusPage.checkIntervalSeconds / 60}分`,
				`メンションロール: ${mentionRole ? `<@&${mentionRole.id}>` : 'なし'}`,
			].join('\n'),
		);
	} catch (error) {
		await interaction.editReply(formatAddError(error, rawUrl));
	}
}

async function handleList(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
	const statusPages = await listStatusPagesByGuild(guildId);

	if (statusPages.length === 0) {
		await interaction.editReply('登録済み Statuspage はありません。');
		return;
	}

	const pages = chunk(statusPages, listPageSize).map((page, pageIndex, allPages) => {
		const embed = new EmbedBuilder()
			.setTitle('登録済み Statuspage')
			.setFooter({ text: `${pageIndex + 1}/${allPages.length}` })
			.setTimestamp();

		for (const [index, statusPage] of page.entries()) {
			const status = formatStoredStatusIndicator(statusPage.lastStatusIndicator);
			const enabled = statusPage.enabled ? '有効' : '無効';
			const checkedAt = statusPage.lastCheckedAt
				? `<t:${Math.floor(statusPage.lastCheckedAt.getTime() / 1_000)}:R>`
				: '未確認';

			embed.addFields({
				name: `${pageIndex * listPageSize + index + 1}. ${statusPage.name}`,
				value: [
					`URL: ${statusPage.baseUrl}`,
					`状態: ${enabled}`,
					`現在ステータス: ${status}`,
					`最終確認: ${checkedAt}`,
				].join('\n'),
			});
		}

		return embed;
	});

	await sendPagedEmbeds(interaction, pages);
}

async function handleShow(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
	const target = interaction.options.getString('target', true);
	const statusPage = await findStatusPageByTarget({ guildId, target });

	if (!statusPage) {
		await interaction.editReply(`指定された Statuspage は見つかりませんでした。\n検索値: ${target}`);
		return;
	}

	await sendPagedEmbeds(interaction, [
		new EmbedBuilder()
			.setTitle(`${statusPage.name} の設定`)
			.setURL(statusPage.baseUrl)
			.addFields(
				{ name: 'DB ID', value: statusPage.id },
				{ name: 'URL', value: statusPage.baseUrl },
				{ name: '状態', value: statusPage.enabled ? '有効' : '無効', inline: true },
				{ name: 'チェック間隔', value: `${statusPage.checkIntervalSeconds / 60}分`, inline: true },
			)
			.setFooter({ text: '1/3' })
			.setTimestamp(),
		new EmbedBuilder()
			.setTitle(`${statusPage.name} の状態`)
			.setURL(statusPage.baseUrl)
			.addFields(
				{ name: '現在ステータス', value: formatStoredStatusIndicator(statusPage.lastStatusIndicator) },
				{
					name: 'メンションロール',
					value: statusPage.mentionRoleId ? `<@&${statusPage.mentionRoleId}>` : 'なし',
				},
				{
					name: '最終チェック',
					value: statusPage.lastCheckedAt
						? `<t:${Math.floor(statusPage.lastCheckedAt.getTime() / 1_000)}:F>`
						: '未確認',
				},
				{
					name: '最終成功',
					value: statusPage.lastSuccessAt
						? `<t:${Math.floor(statusPage.lastSuccessAt.getTime() / 1_000)}:F>`
						: '未成功',
				},
			)
			.setFooter({ text: '2/3' })
			.setTimestamp(),
		new EmbedBuilder()
			.setTitle(`${statusPage.name} のメッセージ/エラー`)
			.setURL(statusPage.baseUrl)
			.addFields(
				{ name: 'status message ID', value: statusPage.statusMessageId ?? '未作成' },
				{ name: '最終エラー', value: truncateEmbedValue(statusPage.lastError ?? 'なし') },
			)
			.setFooter({ text: '3/3' })
			.setTimestamp(),
	]);
}

async function handleRemove(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
	const target = interaction.options.getString('target', true);
	const statusPage = await findStatusPageByTarget({ guildId, target });

	if (!statusPage) {
		await interaction.editReply(`指定された Statuspage は見つかりませんでした。\n検索値: ${target}`);
		return;
	}

	if (!statusPage.enabled) {
		await interaction.editReply(`${statusPage.name} は既に無効です。`);
		return;
	}

	await disableStatusPage(statusPage.id);
	await interaction.editReply(
		[
			`${statusPage.name} の監視を無効化しました。`,
			`URL: ${statusPage.baseUrl}`,
			'既存の通知メッセージは削除していません。',
		].join('\n'),
	);
}

async function handleUpdate(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
	const target = interaction.options.getString('target', true);
	const statusPage = await findStatusPageByTarget({ guildId, target });

	if (!statusPage) {
		await interaction.editReply(`指定された Statuspage は見つかりませんでした。\n検索値: ${target}`);
		return;
	}

	const name = interaction.options.getString('name')?.trim();
	const mentionRole = interaction.options.getRole('mention_role');
	const checkIntervalMinutes = interaction.options.getInteger('check_interval_minutes');
	const enabled = interaction.options.getBoolean('enabled');
	const values: Parameters<typeof updateStatusPageSettings>[1] = {};
	const changes: string[] = [];

	if (name !== undefined) {
		if (!name) {
			await interaction.editReply('表示名は空にできません。');
			return;
		}

		values.name = name;
		changes.push(`表示名: ${statusPage.name} -> ${name}`);
	}

	if (mentionRole) {
		values.mentionRoleId = mentionRole.id;
		changes.push(`メンションロール: <@&${mentionRole.id}>`);
	}

	if (checkIntervalMinutes !== null) {
		values.checkIntervalSeconds = Math.max(checkIntervalMinutes, minCheckIntervalMinutes) * 60;
		changes.push(`チェック間隔: ${values.checkIntervalSeconds / 60}分`);
	}

	if (enabled !== null) {
		values.enabled = enabled;
		changes.push(`状態: ${enabled ? '有効' : '無効'}`);
	}

	if (changes.length === 0) {
		await interaction.editReply('更新する項目が指定されていません。');
		return;
	}

	const updated = await updateStatusPageSettings(statusPage.id, values);

	await interaction.editReply([`${updated.name} の設定を更新しました。`, ...changes].join('\n'));
}

async function handleRefresh(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
	const target = interaction.options.getString('target', true);
	const statusPage = await findStatusPageByTarget({ guildId, target });

	if (!statusPage) {
		await interaction.editReply(`指定された Statuspage は見つかりませんでした。\n検索値: ${target}`);
		return;
	}

	if (!statusPage.enabled) {
		await interaction.editReply(`${statusPage.name} は無効です。有効化してから refresh してください。`);
		return;
	}

	const cooldownKey = `${guildId}:${statusPage.id}`;
	const now = Date.now();
	const lastRefreshAt = refreshCooldowns.get(cooldownKey);

	if (lastRefreshAt && now - lastRefreshAt < refreshCooldownMs) {
		const remainingSeconds = Math.ceil((refreshCooldownMs - (now - lastRefreshAt)) / 1_000);
		await interaction.editReply(`この監視対象は直近で refresh 済みです。${remainingSeconds}秒後に再実行してください。`);
		return;
	}

	refreshCooldowns.set(cooldownKey, now);

	try {
		const result = await checkStatusPage(interaction.client, statusPage);

		if (result.type === 'stale') {
			await interaction.editReply(
				[
					`${statusPage.name} の refresh 結果は反映しませんでした。`,
					'この確認より新しいチェック結果が既に保存されています。',
					`確認開始: <t:${Math.floor(result.checkedAt.getTime() / 1_000)}:F>`,
				].join('\n'),
			);
			return;
		}

		if (result.type === 'not_modified') {
			await interaction.editReply(
				[
					`${statusPage.name} を確認しました。`,
					'Statuspage API は更新なしでした。',
					`最終確認: <t:${Math.floor(result.checkedAt.getTime() / 1_000)}:F>`,
				].join('\n'),
			);
			return;
		}

		await interaction.editReply(
			[
				`${statusPage.name} を確認し、status message を更新しました。`,
				`status message ID: ${result.statusMessageId}`,
				`障害・メンテ通知: ${result.incidentNotifications + result.maintenanceNotifications}件`,
				`最終確認: <t:${Math.floor(result.checkedAt.getTime() / 1_000)}:F>`,
			].join('\n'),
		);
	} catch (error) {
		await interaction.editReply(
			[
				`${statusPage.name} の refresh に失敗しました。`,
				`理由: ${formatUserError(error)}`,
				'詳細は /statuspage show の最終エラーも確認してください。',
			].join('\n'),
		);
	}
}

function formatAddError(error: unknown, rawUrl: string): string {
	if (error instanceof StatuspageFetchError) {
		return [
			'指定された URL から Statuspage API を取得できませんでした。',
			`確認した URL: ${safeSummaryUrl(rawUrl)}`,
			`理由: ${error.message}`,
		].join('\n');
	}

	return ['Statuspage の追加に失敗しました。', `理由: ${formatUserError(error)}`].join('\n');
}

function safeSummaryUrl(rawUrl: string): string {
	try {
		return createSummaryUrl(rawUrl);
	} catch {
		return rawUrl;
	}
}

function formatStoredStatusIndicator(indicator: string | null): string {
	const result = StatusIndicatorSchema.safeParse(indicator);

	if (!result.success) {
		return '未取得';
	}

	return formatStatusIndicator(result.data);
}

function formatCommandError(error: unknown, subcommand: string): string {
	return [
		`/statuspage ${subcommand} の実行に失敗しました。`,
		`理由: ${formatUserError(error)}`,
		'設定済みの監視対象は /statuspage show で最終エラーを確認できます。',
	].join('\n');
}

async function sendPagedEmbeds(interaction: ChatInputCommandInteraction, embeds: EmbedBuilder[]): Promise<void> {
	if (embeds.length === 1) {
		await interaction.editReply({ embeds });
		return;
	}

	let selectedIndex = 0;
	const components = createPaginationComponents(selectedIndex, embeds.length, false);
	const message = await interaction.editReply({
		components,
		embeds: [embeds[selectedIndex]],
	} satisfies InteractionEditReplyOptions);
	const collector = message.createMessageComponentCollector({
		componentType: ComponentType.Button,
		filter: (componentInteraction) => componentInteraction.user.id === interaction.user.id,
		time: paginationTimeoutMs,
	});

	collector.on('collect', async (componentInteraction) => {
		if (componentInteraction.customId === 'statuspage-page-left') {
			selectedIndex = Math.max(0, selectedIndex - 1);
		} else if (componentInteraction.customId === 'statuspage-page-right') {
			selectedIndex = Math.min(embeds.length - 1, selectedIndex + 1);
		} else if (componentInteraction.customId === 'statuspage-page-stop') {
			collector.stop('stopped');
			await componentInteraction.update({
				components: createPaginationComponents(selectedIndex, embeds.length, true),
				embeds: [embeds[selectedIndex]],
			});
			return;
		}

		await componentInteraction.update({
			components: createPaginationComponents(selectedIndex, embeds.length, false),
			embeds: [embeds[selectedIndex]],
		});
	});

	collector.on('end', async () => {
		try {
			await message.edit({
				components: createPaginationComponents(selectedIndex, embeds.length, true),
				embeds: [embeds[selectedIndex]],
			});
		} catch {
			// The interaction response may have expired or been deleted.
		}
	});
}

function createPaginationComponents(pageIndex: number, pageCount: number, disabled: boolean) {
	return [
		new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId('statuspage-page-left')
				.setLabel('戻る')
				.setStyle(ButtonStyle.Primary)
				.setDisabled(disabled || pageIndex === 0),
			new ButtonBuilder()
				.setCustomId('statuspage-page-right')
				.setLabel('次へ')
				.setStyle(ButtonStyle.Primary)
				.setDisabled(disabled || pageIndex >= pageCount - 1),
			new ButtonBuilder()
				.setCustomId('statuspage-page-stop')
				.setLabel('停止')
				.setStyle(ButtonStyle.Danger)
				.setDisabled(disabled),
		),
	];
}

function chunk<Item>(items: Item[], size: number): Item[][] {
	const chunks: Item[][] = [];

	for (let index = 0; index < items.length; index += size) {
		chunks.push(items.slice(index, index + size));
	}

	return chunks;
}

function truncateEmbedValue(value: string): string {
	if (value.length <= 1_024) {
		return value;
	}

	return `${value.slice(0, 1_021)}...`;
}
