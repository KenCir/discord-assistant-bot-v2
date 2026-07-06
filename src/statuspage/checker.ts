import { EmbedBuilder, type Client, type GuildTextBasedChannel } from 'discord.js';
import type { StatusPage } from '../db/schema.js';
import { createStatuspageStatusMessageComponents } from './buttons.js';
import { getFixedStatuspageChannels } from './channels.js';
import { fetchStatusSummary } from './client.js';
import { formatStoredError } from './errors.js';
import { createIncidentEmbed, createMaintenanceEmbed, createStatusEmbed } from './formatter.js';
import {
	findStatusPageById,
	findStatusPageEvent,
	listUnresolvedStatusPageEvents,
	resolveStatusPageEvent,
	updateStatusPageLastCheck,
	upsertStatusPageEvent,
} from './repository.js';
import type { StatusIncident, StatusMaintenance, StatusSummary } from './schemas.js';

type StatusPageIgnoredInconsistentCheckResult = {
	checkedAt: Date;
	reason: 'maintenance_without_events';
	type: 'ignored_inconsistent';
};

type StatusPageNotModifiedCheckResult = {
	checkedAt: Date;
	type: 'not_modified';
};

type StatusPageStaleCheckResult = {
	checkedAt: Date;
	type: 'stale';
};

type StatusPageUpdatedCheckResult = {
	checkedAt: Date;
	incidentNotifications: number;
	maintenanceNotifications: number;
	statusMessageId: string;
	type: 'updated';
};

export type StatusPageCheckResult =
	| StatusPageIgnoredInconsistentCheckResult
	| StatusPageNotModifiedCheckResult
	| StatusPageStaleCheckResult
	| StatusPageUpdatedCheckResult;

export type StatusPageCheckOptions = {
	forceRefresh?: boolean;
};

export async function checkStatusPage(
	client: Client,
	statusPage: StatusPage,
	options: StatusPageCheckOptions = {},
): Promise<StatusPageCheckResult> {
	const checkedAt = new Date();

	try {
		const { incidentChannel, statusChannel } = await getFixedStatuspageChannels(client);
		const etag = options.forceRefresh ? null : statusPage.statusMessageId ? statusPage.lastEtag : null;
		const result = await fetchStatusSummary(statusPage.baseUrl, etag);
		const latestStatusPage = await findStatusPageById(statusPage.id);

		if (!latestStatusPage || isStaleStatusPageCheck(latestStatusPage, checkedAt)) {
			return { checkedAt, type: 'stale' };
		}

		if (result.type === 'not_modified') {
			const statusMessageId = await updateStatusMessageCheckedAt(
				statusChannel,
				statusPage.statusMessageId,
				statusPage.id,
				checkedAt,
			);
			await updateStatusPageLastCheck(statusPage.id, {
				lastCheckedAt: checkedAt,
				lastError: null,
				lastSuccessAt: checkedAt,
				statusMessageId,
			});

			return { checkedAt, type: 'not_modified' };
		}

		if (isInconsistentMaintenanceOnlySummary(latestStatusPage, result.data)) {
			const statusMessageId = await updateStatusMessageCheckedAt(
				statusChannel,
				statusPage.statusMessageId,
				statusPage.id,
				checkedAt,
			);
			await updateStatusPageLastCheck(statusPage.id, {
				lastCheckedAt: checkedAt,
				lastError: null,
				lastSuccessAt: checkedAt,
				statusMessageId,
			});

			return { checkedAt, reason: 'maintenance_without_events', type: 'ignored_inconsistent' };
		}

		const embed = createStatusEmbed(statusPage.name, statusPage.baseUrl, result.data, checkedAt);
		const statusMessageId = await upsertStatusMessage(statusChannel, statusPage.statusMessageId, statusPage.id, embed);
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

function isStaleStatusPageCheck(latestStatusPage: StatusPage, checkedAt: Date): boolean {
	return latestStatusPage.lastCheckedAt !== null && latestStatusPage.lastCheckedAt.getTime() > checkedAt.getTime();
}

function isInconsistentMaintenanceOnlySummary(statusPage: StatusPage, summary: StatusSummary): boolean {
	if (statusPage.lastStatusIndicator !== 'none' || summary.status.indicator !== 'maintenance') {
		return false;
	}

	if (summary.incidents.length > 0 || summary.scheduled_maintenances.length > 0) {
		return false;
	}

	const affectedComponents = summary.components.filter((component) => component.status !== 'operational');

	return affectedComponents.every((component) => component.status === 'under_maintenance');
}

async function upsertStatusMessage(
	statusChannel: GuildTextBasedChannel,
	statusMessageId: string | null,
	statusPageId: string,
	embed: ReturnType<typeof createStatusEmbed>,
): Promise<string> {
	const components = createStatuspageStatusMessageComponents(statusPageId);

	if (statusMessageId) {
		try {
			const message = await statusChannel.messages.fetch(statusMessageId);
			const updated = await message.edit({ components, embeds: [embed] });

			return updated.id;
		} catch {
			// If the saved message was deleted or cannot be fetched, create a new status message.
		}
	}

	const message = await statusChannel.send({ components, embeds: [embed] });

	return message.id;
}

async function updateStatusMessageCheckedAt(
	statusChannel: GuildTextBasedChannel,
	statusMessageId: string | null,
	statusPageId: string,
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
		await message.edit({ components: createStatuspageStatusMessageComponents(statusPageId), embeds: [embed] });
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
	const currentIncidentIds = new Set(incidents.map((incident) => incident.id));

	for (const incident of incidents) {
		const previousEvent = await findStatusPageEvent(statusPage.id, 'incident', incident.id);
		const latestUpdateId = incident.incident_updates[0]?.id ?? null;
		const embed = createIncidentEmbed(statusPage.name, statusPage.baseUrl, incident);
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

	notificationCount += await processRemovedEvents({
		channel: incidentChannel,
		currentExternalIds: currentIncidentIds,
		eventType: 'incident',
		message: createMentionContent(statusPage.mentionRoleId, 'インシデントは解決されました。'),
		roleId: statusPage.mentionRoleId,
		status: 'resolved',
		statusLabel: '解決済み',
		statusPageId: statusPage.id,
		titlePrefix: '[解決済み] ',
	});

	return notificationCount;
}

async function processMaintenances(
	incidentChannel: GuildTextBasedChannel,
	statusPage: StatusPage,
	maintenances: StatusMaintenance[],
): Promise<number> {
	let notificationCount = 0;
	const currentMaintenanceIds = new Set(maintenances.map((maintenance) => maintenance.id));

	for (const maintenance of maintenances) {
		const previousEvent = await findStatusPageEvent(statusPage.id, 'maintenance', maintenance.id);
		const latestUpdateId = maintenance.incident_updates[0]?.id ?? null;
		const embed = createMaintenanceEmbed(statusPage.name, statusPage.baseUrl, maintenance);
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

	notificationCount += await processRemovedEvents({
		channel: incidentChannel,
		currentExternalIds: currentMaintenanceIds,
		eventType: 'maintenance',
		message: 'メンテナンスは完了しました。',
		roleId: null,
		status: 'completed',
		statusLabel: '完了',
		statusPageId: statusPage.id,
		titlePrefix: '[完了] ',
	});

	return notificationCount;
}

async function processRemovedEvents({
	channel,
	currentExternalIds,
	eventType,
	message,
	roleId,
	status,
	statusLabel,
	statusPageId,
	titlePrefix,
}: {
	channel: GuildTextBasedChannel;
	currentExternalIds: Set<string>;
	eventType: 'incident' | 'maintenance';
	message: string | undefined;
	roleId: string | null;
	status: 'completed' | 'resolved';
	statusLabel: string;
	statusPageId: string;
	titlePrefix: string;
}): Promise<number> {
	const unresolvedEvents = await listUnresolvedStatusPageEvents(statusPageId, eventType);
	let notificationCount = 0;

	for (const event of unresolvedEvents) {
		if (currentExternalIds.has(event.externalId)) {
			continue;
		}

		const resolvedAt = new Date();

		if (event.messageId) {
			const notified = await notifyRemovedEvent(
				channel,
				event.messageId,
				message,
				roleId,
				titlePrefix,
				statusLabel,
				resolvedAt,
			);

			if (notified) {
				notificationCount += 1;
			}
		}

		await resolveStatusPageEvent(event.id, { resolvedAt, status });
	}

	return notificationCount;
}

async function notifyRemovedEvent(
	channel: GuildTextBasedChannel,
	messageId: string,
	message: string | undefined,
	roleId: string | null,
	titlePrefix: string,
	statusLabel: string,
	resolvedAt: Date,
): Promise<boolean> {
	try {
		await markEventMessageClosed(channel, messageId, titlePrefix, statusLabel, resolvedAt);
		await replyToEventMessage(channel, messageId, message, roleId);
		return true;
	} catch {
		// The event was still closed in Statuspage even if the Discord message no longer exists.
		return false;
	}
}

async function markEventMessageClosed(
	channel: GuildTextBasedChannel,
	messageId: string,
	titlePrefix: string,
	statusLabel: string,
	resolvedAt: Date,
): Promise<void> {
	const message = await channel.messages.fetch(messageId);
	const currentEmbed = message.embeds[0];

	if (!currentEmbed) {
		return;
	}

	const embed = EmbedBuilder.from(currentEmbed).setColor('Green').setTimestamp(resolvedAt);
	const title = currentEmbed.title;
	const description = currentEmbed.description;

	if (title && !title.startsWith(titlePrefix)) {
		embed.setTitle(`${titlePrefix}${title}`);
	}

	if (description) {
		embed.setDescription(updateClosedEmbedDescription(description, statusLabel));
	}

	if (currentEmbed.fields.length > 0) {
		embed.setFields(
			currentEmbed.fields.map((field, index) =>
				index === 0 ? { ...field, name: updateClosedEmbedFieldName(field.name, statusLabel) } : field,
			),
		);
	}

	await message.edit({ embeds: [embed] });
}

function updateClosedEmbedDescription(description: string, statusLabel: string): string {
	return description.replace(/^ステータス: (?:\*\*)?.+?(?:\*\*)?$/m, `ステータス: **${statusLabel}**`);
}

function updateClosedEmbedFieldName(name: string, statusLabel: string): string {
	return name.replace(/ - .+$/, ` - ${statusLabel}`);
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
