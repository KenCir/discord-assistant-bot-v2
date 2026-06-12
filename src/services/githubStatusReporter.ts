import process from 'node:process';
import { ChannelType, EmbedBuilder, type Client, type GuildTextBasedChannel } from 'discord.js';
import type { GithubWatchedRepository } from '../db/schema.js';
import { logger } from '../util/logger.js';
import {
	fetchGithubStatus,
	type GithubCiStatus,
	type GithubRateLimitStatus,
	type GithubRepositoryStatus,
	type GithubStatusResult,
} from './githubStatus.js';
import { listGithubWatchedRepositories, updateGithubWatchedRepositoryMessageId } from './githubWatchRepository.js';

const defaultUpdateIntervalMs = 300_000;
const lowRateLimitRemaining = 500;

export class GithubStatusReporter {
	private intervalId: NodeJS.Timeout | null = null;

	private running = false;

	private stopping = false;

	public constructor(private readonly client: Client<true>) {}

	public async start(): Promise<void> {
		if (this.running || process.env.GITHUB_STATUS_ENABLED !== 'true') {
			return;
		}

		if (!process.env.GITHUB_TOKEN) {
			logger.warn('GITHUB_TOKEN is not set. GitHub status reporter is disabled.');
			return;
		}

		const channelId = process.env.GITHUB_STATUS_CHANNEL_ID;

		if (!channelId) {
			logger.warn('GITHUB_STATUS_CHANNEL_ID is not set. GitHub status reporter is disabled.');
			return;
		}

		const channel = await this.fetchSendableChannel(channelId);

		if (!channel) {
			return;
		}

		this.running = true;

		try {
			await this.update(channel);
		} catch (error) {
			this.running = false;
			logger.error(
				{ error, channelId },
				'Failed to create GitHub status messages. GitHub status reporter is disabled.',
			);
			return;
		}

		this.intervalId = setInterval(() => {
			void this.update(channel);
		}, this.getUpdateIntervalMs());

		logger.info({ channelId }, 'GitHub status reporter started.');
	}

	public async stop(): Promise<void> {
		if (this.stopping) {
			return;
		}

		this.stopping = true;
		this.running = false;

		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}

		const channelId = process.env.GITHUB_STATUS_CHANNEL_ID;

		if (!channelId) {
			return;
		}

		const channel = await this.fetchSendableChannel(channelId);

		if (!channel) {
			return;
		}

		await this.deleteStatusMessages(channel);
	}

	private async update(channel: GuildTextBasedChannel): Promise<void> {
		if (!this.running) {
			return;
		}

		const checkedAt = new Date();
		const repositories = await listGithubWatchedRepositories(channel.guildId);

		if (repositories.length === 0) {
			return;
		}

		let status: GithubStatusResult;

		try {
			status = await fetchGithubStatus(repositories);
		} catch (error) {
			logger.error({ error, guildId: channel.guildId }, 'Failed to fetch GitHub status.');
			status = {
				rateLimit: null,
				repositories: repositories.map((repository) => ({
					error: formatError(error),
					owner: repository.owner,
					repo: repository.repo,
					type: 'error',
				})),
			};
		}

		for (const repository of repositories) {
			const repositoryStatus = findRepositoryStatus(status, repository);
			const embed = createGithubRepositoryStatusEmbed(repositoryStatus, status.rateLimit, checkedAt);

			await this.upsertStatusMessage(channel, repository, embed);
		}
	}

	private async upsertStatusMessage(
		channel: GuildTextBasedChannel,
		repository: GithubWatchedRepository,
		embed: EmbedBuilder,
	): Promise<void> {
		if (repository.statusMessageId) {
			try {
				const message = await channel.messages.fetch(repository.statusMessageId);
				await message.edit({ embeds: [embed] });
				return;
			} catch (error) {
				logger.warn(
					{ error, messageId: repository.statusMessageId, owner: repository.owner, repo: repository.repo },
					'Failed to edit GitHub repository status message. Recreating it.',
				);
			}
		}

		const message = await channel.send({ embeds: [embed] });
		await updateGithubWatchedRepositoryMessageId(repository.id, message.id);
	}

	private async deleteStatusMessages(channel: GuildTextBasedChannel): Promise<void> {
		let repositories: GithubWatchedRepository[];

		try {
			repositories = await listGithubWatchedRepositories(channel.guildId);
		} catch (error) {
			logger.warn({ error, guildId: channel.guildId }, 'Failed to load GitHub status messages for deletion.');
			return;
		}

		for (const repository of repositories) {
			if (!repository.statusMessageId) {
				continue;
			}

			try {
				const message = await channel.messages.fetch(repository.statusMessageId);
				await message.delete();
				await updateGithubWatchedRepositoryMessageId(repository.id, null);
				logger.info(
					{ messageId: repository.statusMessageId, owner: repository.owner, repo: repository.repo },
					'GitHub repository status message deleted.',
				);
			} catch (error) {
				logger.warn(
					{ error, messageId: repository.statusMessageId, owner: repository.owner, repo: repository.repo },
					'Failed to delete GitHub repository status message.',
				);
			}
		}
	}

	private async fetchSendableChannel(channelId: string): Promise<GuildTextBasedChannel | null> {
		const channel = await this.client.channels.fetch(channelId);

		if (!channel || !isGuildTextBasedChannel(channel)) {
			logger.warn({ channelId }, 'GitHub status channel was not found or is not a guild text channel.');
			return null;
		}

		if (!channel.isSendable()) {
			logger.warn({ channelId }, 'GitHub status channel is not sendable.');
			return null;
		}

		return channel;
	}

	private getUpdateIntervalMs(): number {
		const value = Number(process.env.GITHUB_STATUS_UPDATE_INTERVAL_MS ?? defaultUpdateIntervalMs);

		if (!Number.isFinite(value) || value <= 0) {
			logger.warn(
				{ value: process.env.GITHUB_STATUS_UPDATE_INTERVAL_MS },
				'GITHUB_STATUS_UPDATE_INTERVAL_MS is invalid. Falling back to default.',
			);
			return defaultUpdateIntervalMs;
		}

		return value;
	}
}

export function createGithubStatusEmbed(status: GithubStatusResult, checkedAt: Date): EmbedBuilder {
	const rateLimitWarning = status.rateLimit ? status.rateLimit.remaining < lowRateLimitRemaining : false;
	const embed = new EmbedBuilder()
		.setTitle(rateLimitWarning ? '⚠️ GitHub Status Warning' : '🐙 GitHub Status')
		.setColor(rateLimitWarning ? 'Yellow' : 'Green')
		.setTimestamp(checkedAt);

	for (const repository of status.repositories.slice(0, 24)) {
		const repositoryEmbed = createGithubRepositoryStatusEmbed(repository, null, checkedAt);
		const field = repositoryEmbed.data.fields?.[0];

		if (field) {
			embed.addFields(field);
		}
	}

	if (status.repositories.length > 24) {
		embed.addFields({
			name: '表示省略',
			value: `Discord Embedの制限により、${status.repositories.length - 24}件を省略しました。`,
		});
	}

	embed.addFields({
		name: 'Rate Limit',
		value: formatRateLimit(status.rateLimit),
	});

	if (rateLimitWarning) {
		embed.setDescription('GitHub GraphQL API の rate limit remaining が少なくなっています。');
	}

	return embed;
}

export function createGithubRepositoryStatusEmbed(
	repository: GithubRepositoryStatus,
	rateLimit: GithubRateLimitStatus | null,
	checkedAt: Date,
): EmbedBuilder {
	const rateLimitWarning = rateLimit ? rateLimit.remaining < lowRateLimitRemaining : false;
	const warning = repository.type === 'error' || rateLimitWarning;
	const embed = new EmbedBuilder()
		.setTitle(warning ? '⚠️ GitHub Repository Status Warning' : '🐙 GitHub Repository Status')
		.setColor(warning ? 'Yellow' : 'Green')
		.setTimestamp(checkedAt);

	if (repository.type === 'error') {
		embed.addFields(
			{
				name: `${repository.owner}/${repository.repo}`,
				value: `Error: ${truncate(repository.error, 900)}`,
			},
			{
				name: 'Rate Limit',
				value: formatRateLimit(rateLimit),
			},
		);
		return embed;
	}

	embed.addFields(
		{
			name: `${repository.owner}/${repository.repo}`,
			value: [
				`Issues: ${repository.issues}`,
				`PRs: ${repository.pullRequests}`,
				`Renovate: ${repository.renovatePullRequests}`,
				`Dependabot: ${repository.dependabotPullRequests}`,
				'',
				`CI: ${formatCiStatus(repository.ciStatus)}`,
				'',
				`Latest Release: ${repository.latestRelease ?? 'N/A'}`,
				`Last Push: ${repository.lastPushAt ? formatRelativeTime(repository.lastPushAt, checkedAt) : 'N/A'}`,
			].join('\n'),
		},
		{
			name: 'Rate Limit',
			value: formatRateLimit(rateLimit),
		},
	);

	if (rateLimitWarning) {
		embed.setDescription('GitHub GraphQL API の rate limit remaining が少なくなっています。');
	}

	return embed;
}

export function formatCiStatus(status: GithubCiStatus): string {
	switch (status) {
		case 'success':
			return '🟢 success';
		case 'failed':
			return '🔴 failed';
		case 'running':
			return '🟡 running';
		case 'unknown':
			return 'N/A';
	}
}

function findRepositoryStatus(status: GithubStatusResult, repository: GithubWatchedRepository): GithubRepositoryStatus {
	return (
		status.repositories.find(
			(repositoryStatus) =>
				repositoryStatus.owner.toLowerCase() === repository.owner.toLowerCase() &&
				repositoryStatus.repo.toLowerCase() === repository.repo.toLowerCase(),
		) ?? {
			error: 'Repository status was not returned by GitHub API.',
			owner: repository.owner,
			repo: repository.repo,
			type: 'error',
		}
	);
}

function formatRateLimit(rateLimit: GithubRateLimitStatus | null): string {
	return rateLimit
		? [
				`Cost: ${rateLimit.cost}`,
				`Remaining: ${rateLimit.remaining}`,
				`Reset: ${formatJstDateTime(rateLimit.resetAt)}`,
			].join('\n')
		: 'N/A';
}

function formatRelativeTime(date: Date, now: Date): string {
	const differenceSeconds = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1_000));
	const days = Math.floor(differenceSeconds / 86_400);
	const hours = Math.floor(differenceSeconds / 3_600);
	const minutes = Math.floor(differenceSeconds / 60);

	if (days > 0) {
		return `${days}d ago`;
	}

	if (hours > 0) {
		return `${hours}h ago`;
	}

	if (minutes > 0) {
		return `${minutes}m ago`;
	}

	return 'just now';
}

function formatJstDateTime(date: Date): string {
	return new Intl.DateTimeFormat('sv-SE', {
		day: '2-digit',
		hour: '2-digit',
		hour12: false,
		minute: '2-digit',
		month: '2-digit',
		timeZone: 'Asia/Tokyo',
		year: 'numeric',
	}).format(date);
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function truncate(value: string, maxLength: number): string {
	if (value.length <= maxLength) {
		return value;
	}

	return `${value.slice(0, maxLength - 3)}...`;
}

function isGuildTextBasedChannel(channel: unknown): channel is GuildTextBasedChannel {
	return (
		typeof channel === 'object' &&
		channel !== null &&
		'type' in channel &&
		(channel.type === ChannelType.GuildText ||
			channel.type === ChannelType.GuildAnnouncement ||
			channel.type === ChannelType.PublicThread ||
			channel.type === ChannelType.PrivateThread ||
			channel.type === ChannelType.AnnouncementThread)
	);
}
