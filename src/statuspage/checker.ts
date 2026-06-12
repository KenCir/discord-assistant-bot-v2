import { EmbedBuilder, type Client, type GuildTextBasedChannel } from 'discord.js';
import type { StatusPage } from '../db/schema.js';
import { getFixedStatuspageChannels } from './channels.js';
import { fetchStatusSummary } from './client.js';
import { formatStoredError } from './errors.js';
import { createIncidentEmbed, createMaintenanceEmbed, createStatusEmbed } from './formatter.js';
import { findStatusPageEvent, updateStatusPageLastCheck, upsertStatusPageEvent } from './repository.js';
import type { StatusIncident, StatusMaintenance } from './schemas.js';

export type StatusPageCheckResult =
	| {
			checkedAt: Date;
			incidentNotifications: number;
			maintenanceNotifications: number;
			statusMessageId: string;
			type: 'updated';
	  }
	| {
			checkedAt: Date;
			type: 'not_modified';
	  };

export async function checkStatusPage(client: Client, statusPage: StatusPage): Promise<StatusPageCheckResult> {
	const checkedAt = new Date();

	try {
		const { incidentChannel, statusChannel } = await getFixedStatuspageChannels(client);
		const etag = statusPage.statusMessageId ? statusPage.lastEtag : null;
		const result = await fetchStatusSummary(statusPage.baseUrl, etag);

		if (result.type === 'not_modified') {
			const statusMessageId = await updateStatusMessageCheckedAt(statusChannel, statusPage.statusMessageId, checkedAt);
			await updateStatusPageLastCheck(statusPage.id, {
				lastCheckedAt: checkedAt,
				lastError: null,
				lastSuccessAt: checkedAt,
				statusMessageId,
			});

			return { checkedAt, type: 'not_modified' };
		}

		const embed = createStatusEmbed(statusPage.name, statusPage.baseUrl, result.data, checkedAt);
		const statusMessageId = await upsertStatusMessage(statusChannel, statusPage.statusMessageId, embed);
		const incidentNotifications = await processIncidents(incidentChannel, statusPage, result.data.incidents);
		const maintenanceNotifications = await processMaintenances(
			incidentChannel,
			statusPage,
			result.data.scheduled_maintenances,
		);

		await updateStatusPageLastCheck(statusPage.id, {
			lastCheckedAt: checkedAt,
			lastError: null,
			lastEtag: result.etag,
			lastStatusIndicator: result.data.status.indicator,
			lastSuccessAt: checkedAt,
			statusMessageId,
		});

		return { checkedAt, incidentNotifications, maintenanceNotifications, statusMessageId, type: 'updated' };
	} catch (error) {
		await updateStatusPageLastCheck(statusPage.id, {
			lastCheckedAt: checkedAt,
			lastError: formatStoredError(error),
		});

		throw error;
	}
}

async function upsertStatusMessage(
	statusChannel: GuildTextBasedChannel,
	statusMessageId: string | null,
	embed: ReturnType<typeof createStatusEmbed>,
): Promise<string> {
	if (statusMessageId) {
		try {
			const message = await statusChannel.messages.fetch(statusMessageId);
			const updated = await message.edit({ embeds: [embed] });

			return updated.id;
		} catch {
			// If the saved message was deleted or cannot be fetched, create a new status message.
		}
	}

	const message = await statusChannel.send({ embeds: [embed] });

	return message.id;
}

async function updateStatusMessageCheckedAt(
	statusChannel: GuildTextBasedChannel,
	statusMessageId: string | null,
	checkedAt: Date,
): Promise<string | null> {
	if (!statusMessageId) {
		return null;
	}

	try {
		const message = await statusChannel.messages.fetch(statusMessageId);
		const currentEmbed = message.embeds[0];

		if (!currentEmbed) {
			return null;
		}

		const embed = EmbedBuilder.from(currentEmbed).setTimestamp(checkedAt);
		const fields = currentEmbed.fields.map((field) =>
			field.name === '最終確認' ? { ...field, value: `<t:${Math.floor(checkedAt.getTime() / 1_000)}:F>` } : field,
		);

		embed.setFields(fields);
		await message.edit({ embeds: [embed] });
		return statusMessageId;
	} catch {
		// If the message disappeared, the next modified response will recreate it.
		return null;
	}
}

async function processIncidents(
	incidentChannel: GuildTextBasedChannel,
	statusPage: StatusPage,
	incidents: StatusIncident[],
): Promise<number> {
	let notificationCount = 0;

	for (const incident of incidents) {
		const previousEvent = await findStatusPageEvent(statusPage.id, 'incident', incident.id);
		const latestUpdateId = incident.incident_updates[0]?.id ?? null;
		const embed = createIncidentEmbed(incident);
		const messageId = await upsertEventMessage({
			channel: incidentChannel,
			content: previousEvent ? undefined : createMentionContent(statusPage.mentionRoleId),
			embed,
			messageId: previousEvent?.messageId ?? null,
		});
		const shouldReplyUpdate =
			previousEvent &&
			latestUpdateId &&
			previousEvent.lastUpdateId &&
			latestUpdateId !== previousEvent.lastUpdateId &&
			incident.status !== 'resolved';
		const shouldReplyResolved = previousEvent && previousEvent.status !== 'resolved' && incident.status === 'resolved';

		if (shouldReplyUpdate) {
			await replyToEventMessage(
				incidentChannel,
				messageId,
				createMentionContent(statusPage.mentionRoleId, 'インシデント情報が更新されました。'),
				statusPage.mentionRoleId,
			);
			notificationCount += 1;
		}

		if (shouldReplyResolved) {
			await replyToEventMessage(
				incidentChannel,
				messageId,
				createMentionContent(statusPage.mentionRoleId, 'インシデントは解決されました。'),
				statusPage.mentionRoleId,
			);
			notificationCount += 1;
		}

		if (!previousEvent) {
			notificationCount += 1;
		}

		await upsertStatusPageEvent({
			eventType: 'incident',
			externalId: incident.id,
			impact: incident.impact,
			lastUpdateId: latestUpdateId,
			lastUpdatedAt: new Date(incident.updated_at),
			messageId,
			name: incident.name,
			resolvedAt: incident.resolved_at ? new Date(incident.resolved_at) : null,
			shortlink: incident.shortlink,
			status: incident.status,
			statusPageId: statusPage.id,
		});
	}

	return notificationCount;
}

async function processMaintenances(
	incidentChannel: GuildTextBasedChannel,
	statusPage: StatusPage,
	maintenances: StatusMaintenance[],
): Promise<number> {
	let notificationCount = 0;

	for (const maintenance of maintenances) {
		const previousEvent = await findStatusPageEvent(statusPage.id, 'maintenance', maintenance.id);
		const latestUpdateId = maintenance.incident_updates[0]?.id ?? null;
		const embed = createMaintenanceEmbed(maintenance);
		const messageId = await upsertEventMessage({
			channel: incidentChannel,
			content: previousEvent ? undefined : createMentionContent(statusPage.mentionRoleId),
			embed,
			messageId: previousEvent?.messageId ?? null,
		});
		const shouldReplyStarted =
			previousEvent && previousEvent.status !== 'in_progress' && maintenance.status === 'in_progress';
		const shouldReplyCompleted =
			previousEvent && previousEvent.status !== 'completed' && maintenance.status === 'completed';
		const shouldReplyRescheduled =
			previousEvent &&
			latestUpdateId &&
			previousEvent.lastUpdateId &&
			latestUpdateId !== previousEvent.lastUpdateId &&
			maintenance.status === 'scheduled';

		if (shouldReplyStarted) {
			await replyToEventMessage(
				incidentChannel,
				messageId,
				createMentionContent(statusPage.mentionRoleId, 'メンテナンスが開始されました。'),
				statusPage.mentionRoleId,
			);
			notificationCount += 1;
		}

		if (shouldReplyCompleted) {
			await replyToEventMessage(incidentChannel, messageId, 'メンテナンスは完了しました。', null);
			notificationCount += 1;
		}

		if (shouldReplyRescheduled) {
			await replyToEventMessage(incidentChannel, messageId, 'メンテナンス予定が更新されました。', null);
			notificationCount += 1;
		}

		if (!previousEvent) {
			notificationCount += 1;
		}

		await upsertStatusPageEvent({
			eventType: 'maintenance',
			externalId: maintenance.id,
			impact: maintenance.impact,
			lastUpdateId: latestUpdateId,
			lastUpdatedAt: new Date(maintenance.updated_at),
			messageId,
			name: maintenance.name,
			resolvedAt: maintenance.status === 'completed' ? new Date(maintenance.updated_at) : null,
			shortlink: maintenance.shortlink,
			status: maintenance.status,
			statusPageId: statusPage.id,
		});
	}

	return notificationCount;
}

async function upsertEventMessage({
	channel,
	content,
	embed,
	messageId,
}: {
	channel: GuildTextBasedChannel;
	content?: string;
	embed: EmbedBuilder;
	messageId: string | null;
}): Promise<string> {
	if (messageId) {
		try {
			const message = await channel.messages.fetch(messageId);
			const updated = await message.edit({ embeds: [embed] });

			return updated.id;
		} catch {
			// If the saved event message disappeared, create it again and persist the new id.
		}
	}

	const message = await channel.send({
		allowedMentions: createAllowedMentions(content ? extractRoleId(content) : null),
		content,
		embeds: [embed],
	});

	return message.id;
}

function createMentionContent(roleId: string | null, message?: string): string | undefined {
	const mention = roleId ? `<@&${roleId}>` : undefined;

	if (mention && message) {
		return `${mention} ${message}`;
	}

	return mention ?? message;
}

function createAllowedMentions(roleId: string | null) {
	return roleId ? { roles: [roleId] } : { parse: [] };
}

async function replyToEventMessage(
	channel: GuildTextBasedChannel,
	messageId: string,
	content: string | undefined,
	roleId: string | null,
): Promise<void> {
	const message = await channel.messages.fetch(messageId);

	await message.reply({
		allowedMentions: createAllowedMentions(roleId),
		content,
	});
}

function extractRoleId(content: string): string | null {
	const match = /^<@&(?<roleId>\d+)>/.exec(content);

	return match?.groups?.roleId ?? null;
}
