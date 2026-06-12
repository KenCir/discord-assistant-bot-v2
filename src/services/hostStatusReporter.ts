import process from 'node:process';
import {
	AttachmentBuilder,
	ChannelType,
	EmbedBuilder,
	type Client,
	type GuildTextBasedChannel,
	type Message,
	type MessageCreateOptions,
	type MessageEditOptions,
} from 'discord.js';
import { logger } from '../util/logger.js';
import { formatBytesAsGigabytes, formatUptime, getHostStatusSnapshot, type HostStatusSnapshot } from './hostStatus.js';
import { renderHostStatusChart } from './hostStatusChart.js';
import { HostStatusMetricsHistory } from './hostStatusMetrics.js';

const defaultUpdateIntervalMs = 60_000;
const chartFileName = 'host-status.png';

export class HostStatusReporter {
	private intervalId: NodeJS.Timeout | null = null;

	private readonly metricsHistory = new HostStatusMetricsHistory();

	private message: Message | null = null;

	private running = false;

	private stopping = false;

	public constructor(private readonly client: Client<true>) {}

	public async start(): Promise<void> {
		if (this.running || process.env.HOST_STATUS_ENABLED !== 'true') {
			return;
		}

		const channelId = process.env.HOST_STATUS_CHANNEL_ID;

		if (!channelId) {
			logger.warn('HOST_STATUS_CHANNEL_ID is not set. Host status reporter is disabled.');
			return;
		}

		const channel = await this.fetchSendableChannel(channelId);

		if (!channel) {
			return;
		}

		this.running = true;

		try {
			await this.createMessage(channel);
		} catch (error) {
			this.running = false;
			logger.error({ error, channelId }, 'Failed to create host status message. Host status reporter is disabled.');
			return;
		}

		this.intervalId = setInterval(() => {
			void this.update(channel);
		}, this.getUpdateIntervalMs());

		logger.info({ channelId }, 'Host status reporter started.');
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

		if (!this.message) {
			return;
		}

		try {
			await this.message.delete();
			logger.info({ messageId: this.message.id }, 'Host status message deleted.');
		} catch (error) {
			logger.warn({ error, messageId: this.message.id }, 'Failed to delete host status message.');
		} finally {
			this.message = null;
		}
	}

	private async createMessage(channel: GuildTextBasedChannel): Promise<void> {
		this.message = await channel.send(await this.createMessagePayload());
	}

	private async update(channel: GuildTextBasedChannel): Promise<void> {
		if (!this.running) {
			return;
		}

		const payload = await this.createMessagePayload();

		if (!this.message) {
			await this.createMessage(channel);
			return;
		}

		try {
			this.message = await this.message.edit(payload);
		} catch (error) {
			logger.warn({ error, messageId: this.message.id }, 'Failed to edit host status message. Recreating it.');

			try {
				await this.createMessage(channel);
			} catch (createError) {
				logger.error({ error: createError }, 'Failed to recreate host status message.');
			}
		}
	}

	private async fetchSendableChannel(channelId: string): Promise<GuildTextBasedChannel | null> {
		const channel = await this.client.channels.fetch(channelId);

		if (!channel || !isGuildTextBasedChannel(channel)) {
			logger.warn({ channelId }, 'Host status channel was not found or is not a guild text channel.');
			return null;
		}

		if (!channel.isSendable()) {
			logger.warn({ channelId }, 'Host status channel is not sendable.');
			return null;
		}

		return channel;
	}

	private getUpdateIntervalMs(): number {
		const value = Number(process.env.HOST_STATUS_UPDATE_INTERVAL_MS ?? defaultUpdateIntervalMs);

		if (!Number.isFinite(value) || value <= 0) {
			logger.warn(
				{ value: process.env.HOST_STATUS_UPDATE_INTERVAL_MS },
				'HOST_STATUS_UPDATE_INTERVAL_MS is invalid. Falling back to default.',
			);
			return defaultUpdateIntervalMs;
		}

		return value;
	}

	private async createMessagePayload(): Promise<MessageCreateOptions & MessageEditOptions> {
		const now = new Date();
		const snapshot = getHostStatusSnapshot();
		this.metricsHistory.add(snapshot, now);

		try {
			const chartBuffer = await renderHostStatusChart(this.metricsHistory.getPoints());
			const attachment = new AttachmentBuilder(chartBuffer, { name: chartFileName });

			return {
				attachments: [],
				embeds: [createHostStatusEmbed(snapshot, now, true)],
				files: [attachment],
			};
		} catch (error) {
			logger.warn({ error }, 'Failed to render host status chart. Updating embed without chart.');

			return {
				attachments: [],
				embeds: [createHostStatusEmbed(snapshot, now, false)],
				files: [],
			};
		}
	}
}

function createHostStatusEmbed(snapshot: HostStatusSnapshot, now: Date, withChart: boolean): EmbedBuilder {
	const warning = snapshot.warnings.length > 0;

	const embed = new EmbedBuilder()
		.setTitle(warning ? '⚠️ Host Status Warning' : '🖥️ Host Status')
		.setDescription(warning ? snapshot.warnings.join('\n') : null)
		.setColor(warning ? 'Yellow' : 'Green')
		.addFields(
			{ name: 'Host', value: snapshot.hostname, inline: true },
			{ name: 'OS', value: `${snapshot.platform} ${snapshot.arch}`, inline: true },
			{ name: 'Uptime', value: formatUptime(snapshot.uptimeSeconds), inline: true },
			{ name: 'CPU', value: `${snapshot.cpuCores} cores`, inline: true },
			{
				name: 'Load Average',
				value: snapshot.loadAverage.map((load) => load.toFixed(2)).join(' / '),
				inline: true,
			},
			{ name: 'Load Usage', value: `${snapshot.loadUsagePercent.toFixed(1)}%`, inline: true },
			{
				name: 'Memory',
				value: `${formatBytesAsGigabytes(snapshot.usedMemoryBytes)} / ${formatBytesAsGigabytes(snapshot.totalMemoryBytes)}`,
				inline: true,
			},
			{ name: 'Memory Usage', value: `${snapshot.memoryUsagePercent.toFixed(1)}%`, inline: true },
			{ name: 'Last Updated', value: formatJstDateTime(now), inline: true },
		)
		.setTimestamp(now);

	if (withChart) {
		embed.setImage(`attachment://${chartFileName}`);
	}

	return embed;
}

function formatJstDateTime(date: Date): string {
	return new Intl.DateTimeFormat('sv-SE', {
		day: '2-digit',
		hour: '2-digit',
		hour12: false,
		minute: '2-digit',
		month: '2-digit',
		second: '2-digit',
		timeZone: 'Asia/Tokyo',
		year: 'numeric',
	}).format(date);
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
