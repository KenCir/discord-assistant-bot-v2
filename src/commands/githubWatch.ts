import process from 'node:process';
import {
	ApplicationCommandOptionType,
	ApplicationCommandType,
	ChannelType,
	EmbedBuilder,
	PermissionFlagsBits,
	type ChatInputCommandInteraction,
} from 'discord.js';
import { fetchGithubStatus, verifyGithubRepository } from '../services/githubStatus.js';
import { createGithubStatusEmbed } from '../services/githubStatusReporter.js';
import {
	createGithubWatchedRepository,
	deleteGithubWatchedRepository,
	findGithubWatchedRepository,
	listGithubWatchedRepositories,
} from '../services/githubWatchRepository.js';
import { logger } from '../util/logger.js';
import type { Command } from './index.js';

const ownerRepoPattern = /^[\w.-]+$/;

export default {
	data: {
		name: 'github-watch',
		description: 'GitHubリポジトリ監視を管理します。',
		type: ApplicationCommandType.ChatInput,
		default_member_permissions: PermissionFlagsBits.ManageChannels.toString(),
		options: [
			{
				type: ApplicationCommandOptionType.Subcommand,
				name: 'add',
				description: 'GitHubリポジトリを監視対象に追加します。',
				options: [
					{
						type: ApplicationCommandOptionType.String,
						name: 'owner',
						description: 'リポジトリの owner。例: KenCir',
						required: true,
					},
					{
						type: ApplicationCommandOptionType.String,
						name: 'repo',
						description: 'リポジトリ名。例: discord-assistant-bot-v2',
						required: true,
					},
				],
			},
			{
				type: ApplicationCommandOptionType.Subcommand,
				name: 'remove',
				description: 'GitHubリポジトリを監視対象から削除します。',
				options: [
					{
						type: ApplicationCommandOptionType.String,
						name: 'owner',
						description: 'リポジトリの owner。',
						required: true,
					},
					{
						type: ApplicationCommandOptionType.String,
						name: 'repo',
						description: 'リポジトリ名。',
						required: true,
					},
				],
			},
			{
				type: ApplicationCommandOptionType.Subcommand,
				name: 'list',
				description: 'GitHub監視対象リポジトリを一覧表示します。',
			},
			{
				type: ApplicationCommandOptionType.Subcommand,
				name: 'status',
				description: 'GitHub監視対象リポジトリの状態を即時取得します。',
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
				case 'remove':
					await handleRemove(interaction, interaction.guildId);
					return;
				case 'list':
					await handleList(interaction, interaction.guildId);
					return;
				case 'status':
					await handleStatus(interaction, interaction.guildId);
					return;
				default:
					await interaction.editReply(`未対応のサブコマンドです: ${subcommand}`);
			}
		} catch (error) {
			await interaction.editReply(
				[`/github-watch ${subcommand} の実行に失敗しました。`, `理由: ${formatError(error)}`].join('\n'),
			);
		}
	},
} satisfies Command;

async function handleAdd(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
	const { owner, repo } = getOwnerRepo(interaction);

	if (!isValidOwnerRepo(owner) || !isValidOwnerRepo(repo)) {
		await interaction.editReply('owner / repo に使用できない文字が含まれています。');
		return;
	}

	const existing = await findGithubWatchedRepository(guildId, owner, repo);

	if (existing) {
		await interaction.editReply(`${owner}/${repo} は既に監視対象に登録されています。`);
		return;
	}

	await verifyGithubRepository(owner, repo);

	const created = await createGithubWatchedRepository({
		guildId,
		owner,
		repo,
	});

	if (!created) {
		await interaction.editReply(`${owner}/${repo} は既に監視対象に登録されています。`);
		return;
	}

	await interaction.editReply(`${created.owner}/${created.repo} をGitHub監視対象に追加しました。`);
}

async function handleRemove(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
	const { owner, repo } = getOwnerRepo(interaction);
	const deleted = await deleteGithubWatchedRepository(guildId, owner, repo);

	if (!deleted) {
		await interaction.editReply(`${owner}/${repo} は監視対象に登録されていません。`);
		return;
	}

	const messageDeleted = await deleteStatusMessage(interaction, deleted.statusMessageId);

	await interaction.editReply(
		[
			`${deleted.owner}/${deleted.repo} をGitHub監視対象から削除しました。`,
			`ステータスメッセージ: ${messageDeleted ? '削除済み' : '未削除または未作成'}`,
		].join('\n'),
	);
}

async function handleList(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
	const repositories = await listGithubWatchedRepositories(guildId);

	if (repositories.length === 0) {
		await interaction.editReply('登録済みのGitHub監視対象はありません。');
		return;
	}

	const embed = new EmbedBuilder()
		.setTitle('GitHub監視対象リポジトリ')
		.setDescription(
			repositories
				.map((repository, index) =>
					[
						`${index + 1}. ${repository.owner}/${repository.repo}`,
						`   messageId: ${repository.statusMessageId ?? '未作成'}`,
					].join('\n'),
				)
				.join('\n'),
		)
		.setTimestamp();

	await interaction.editReply({ embeds: [embed] });
}

async function handleStatus(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
	const repositories = await listGithubWatchedRepositories(guildId);

	if (repositories.length === 0) {
		await interaction.editReply('登録済みのGitHub監視対象はありません。');
		return;
	}

	const status = await fetchGithubStatus(repositories);

	await interaction.editReply({ embeds: [createGithubStatusEmbed(status, new Date())] });
}

function getOwnerRepo(interaction: ChatInputCommandInteraction): { owner: string; repo: string } {
	return {
		owner: interaction.options.getString('owner', true).trim().toLowerCase(),
		repo: interaction.options.getString('repo', true).trim().toLowerCase(),
	};
}

function isValidOwnerRepo(value: string): boolean {
	return ownerRepoPattern.test(value);
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function deleteStatusMessage(
	interaction: ChatInputCommandInteraction,
	statusMessageId: string | null,
): Promise<boolean> {
	const channelId = process.env.GITHUB_STATUS_CHANNEL_ID;

	if (!channelId || !statusMessageId) {
		return false;
	}

	try {
		const channel = await interaction.client.channels.fetch(channelId);

		if (
			!channel ||
			!(
				channel.type === ChannelType.GuildText ||
				channel.type === ChannelType.GuildAnnouncement ||
				channel.type === ChannelType.PublicThread ||
				channel.type === ChannelType.PrivateThread ||
				channel.type === ChannelType.AnnouncementThread
			)
		) {
			return false;
		}

		const message = await channel.messages.fetch(statusMessageId);
		await message.delete();
		return true;
	} catch (error) {
		logger.warn({ error, statusMessageId }, 'Failed to delete GitHub repository status message on remove.');
		return false;
	}
}
