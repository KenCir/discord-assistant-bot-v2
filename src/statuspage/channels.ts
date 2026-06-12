import process from 'node:process';
import { ChannelType, PermissionFlagsBits, type Client, type GuildTextBasedChannel } from 'discord.js';

type FixedStatuspageChannels = {
	incidentChannel: GuildTextBasedChannel;
	statusChannel: GuildTextBasedChannel;
};

export async function getFixedStatuspageChannels(client: Client): Promise<FixedStatuspageChannels> {
	const statusChannelId = process.env.STATUS_CHANNEL_ID;
	const incidentChannelId = process.env.INCIDENT_CHANNEL_ID;

	if (!statusChannelId) {
		throw new Error('STATUS_CHANNEL_ID is required.');
	}

	if (!incidentChannelId) {
		throw new Error('INCIDENT_CHANNEL_ID is required.');
	}

	const [statusChannel, incidentChannel] = await Promise.all([
		fetchWritableTextChannel(client, statusChannelId, 'STATUS_CHANNEL_ID'),
		fetchWritableTextChannel(client, incidentChannelId, 'INCIDENT_CHANNEL_ID'),
	]);

	return { statusChannel, incidentChannel };
}

async function fetchWritableTextChannel(
	client: Client,
	channelId: string,
	envName: string,
): Promise<GuildTextBasedChannel> {
	if (!client.user) {
		throw new Error('Discord client is not ready.');
	}

	const channel = await client.channels.fetch(channelId);

	if (!channel || !isGuildTextBasedChannel(channel)) {
		throw new Error(`${envName} のチャンネルが見つからないか、テキスト系チャンネルではありません。`);
	}

	if (!channel.isSendable()) {
		throw new Error(`${envName} のチャンネルへ送信できません。`);
	}

	const permissions = channel.permissionsFor(client.user);

	if (
		!permissions?.has([
			PermissionFlagsBits.ViewChannel,
			PermissionFlagsBits.SendMessages,
			PermissionFlagsBits.EmbedLinks,
		])
	) {
		throw new Error(`${envName} のチャンネルに必要な権限がありません。`);
	}

	return channel;
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
