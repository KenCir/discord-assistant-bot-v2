import { and, eq, isNull, or } from 'drizzle-orm';
import { db } from '../db/client.js';
import { type NewStatusPage, type NewStatusPageEvent, statusPageEvents, statusPages } from '../db/schema.js';

const uuidPattern = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

export type StatusPageTarget = {
	guildId: string;
	target: string;
};

export async function findStatusPageByGuildAndBaseUrl(guildId: string, baseUrl: string) {
	return db.query.statusPages.findFirst({
		where: and(eq(statusPages.guildId, guildId), eq(statusPages.baseUrl, baseUrl)),
	});
}

export async function findStatusPageByTarget({ guildId, target }: StatusPageTarget) {
	const targetConditions = [eq(statusPages.name, target), eq(statusPages.baseUrl, target)];

	if (uuidPattern.test(target)) {
		targetConditions.push(eq(statusPages.id, target));
	}

	return db.query.statusPages.findFirst({
		where: and(eq(statusPages.guildId, guildId), or(...targetConditions)),
	});
}

export async function listStatusPagesByGuild(guildId: string) {
	return db.query.statusPages.findMany({
		where: eq(statusPages.guildId, guildId),
		orderBy: (table, { asc }) => [asc(table.name)],
	});
}

export async function listEnabledStatusPages() {
	return db.query.statusPages.findMany({
		where: eq(statusPages.enabled, true),
		orderBy: (table, { asc }) => [asc(table.createdAt)],
	});
}

export async function createStatusPage(values: NewStatusPage) {
	const [created] = await db.insert(statusPages).values(values).returning();

	if (!created) {
		throw new Error('Failed to create status page.');
	}

	return created;
}

export async function reactivateStatusPage(
	id: string,
	values: Pick<NewStatusPage, 'checkIntervalSeconds' | 'mentionRoleId' | 'name'>,
) {
	const [updated] = await db
		.update(statusPages)
		.set({
			...values,
			enabled: true,
			lastError: null,
			updatedAt: new Date(),
		})
		.where(eq(statusPages.id, id))
		.returning();

	if (!updated) {
		throw new Error('Failed to reactivate status page.');
	}

	return updated;
}

export async function disableStatusPage(id: string) {
	const [updated] = await db
		.update(statusPages)
		.set({ enabled: false, updatedAt: new Date() })
		.where(eq(statusPages.id, id))
		.returning();

	if (!updated) {
		throw new Error('Failed to disable status page.');
	}

	return updated;
}

export async function updateStatusPageSettings(
	id: string,
	values: Partial<Pick<NewStatusPage, 'checkIntervalSeconds' | 'enabled' | 'mentionRoleId' | 'name'>>,
) {
	const [updated] = await db
		.update(statusPages)
		.set({ ...values, updatedAt: new Date() })
		.where(eq(statusPages.id, id))
		.returning();

	if (!updated) {
		throw new Error('Failed to update status page settings.');
	}

	return updated;
}

export async function updateStatusPageLastCheck(
	id: string,
	values: {
		lastCheckedAt: Date;
		lastError?: string | null;
		lastEtag?: string | null;
		lastStatusIndicator?: string | null;
		lastSuccessAt?: Date;
		statusMessageId?: string | null;
	},
) {
	const [updated] = await db
		.update(statusPages)
		.set({ ...values, updatedAt: new Date() })
		.where(eq(statusPages.id, id))
		.returning();

	if (!updated) {
		throw new Error('Failed to update status page check state.');
	}

	return updated;
}

export async function findStatusPageEvent(
	statusPageId: string,
	eventType: 'incident' | 'maintenance',
	externalId: string,
) {
	return db.query.statusPageEvents.findFirst({
		where: and(
			eq(statusPageEvents.statusPageId, statusPageId),
			eq(statusPageEvents.eventType, eventType),
			eq(statusPageEvents.externalId, externalId),
		),
	});
}

export async function listUnresolvedStatusPageEvents(statusPageId: string, eventType: 'incident' | 'maintenance') {
	return db.query.statusPageEvents.findMany({
		where: and(
			eq(statusPageEvents.statusPageId, statusPageId),
			eq(statusPageEvents.eventType, eventType),
			isNull(statusPageEvents.resolvedAt),
		),
	});
}

export async function resolveStatusPageEvent(id: string, values: { resolvedAt: Date; status: string }) {
	const [event] = await db
		.update(statusPageEvents)
		.set({
			resolvedAt: values.resolvedAt,
			status: values.status,
			updatedAt: new Date(),
		})
		.where(eq(statusPageEvents.id, id))
		.returning();

	if (!event) {
		throw new Error('Failed to resolve status page event.');
	}

	return event;
}

export async function upsertStatusPageEvent(values: NewStatusPageEvent) {
	const [event] = await db
		.insert(statusPageEvents)
		.values(values)
		.onConflictDoUpdate({
			target: [statusPageEvents.statusPageId, statusPageEvents.eventType, statusPageEvents.externalId],
			set: {
				name: values.name,
				status: values.status,
				impact: values.impact,
				shortlink: values.shortlink,
				messageId: values.messageId,
				lastUpdateId: values.lastUpdateId,
				lastUpdatedAt: values.lastUpdatedAt,
				resolvedAt: values.resolvedAt,
				updatedAt: new Date(),
			},
		})
		.returning();

	if (!event) {
		throw new Error('Failed to upsert status page event.');
	}

	return event;
}
