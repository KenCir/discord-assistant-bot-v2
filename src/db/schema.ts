import { relations } from 'drizzle-orm';
import { boolean, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const statusPageEventType = pgEnum('status_page_event_type', ['incident', 'maintenance']);

export const statusPages = pgTable(
	'status_pages',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		guildId: text('guild_id').notNull(),
		name: text('name').notNull(),
		baseUrl: text('base_url').notNull(),
		mentionRoleId: text('mention_role_id'),
		checkIntervalSeconds: integer('check_interval_seconds').notNull().default(600),
		enabled: boolean('enabled').notNull().default(true),
		lastEtag: text('last_etag'),
		lastStatusIndicator: text('last_status_indicator'),
		lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
		lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
		lastError: text('last_error'),
		statusMessageId: text('status_message_id'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [uniqueIndex('status_pages_guild_id_base_url_unique').on(table.guildId, table.baseUrl)],
);

export const statusPageEvents = pgTable(
	'status_page_events',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		statusPageId: uuid('status_page_id')
			.notNull()
			.references(() => statusPages.id, { onDelete: 'cascade' }),
		externalId: text('external_id').notNull(),
		eventType: statusPageEventType('event_type').notNull(),
		name: text('name').notNull(),
		status: text('status').notNull(),
		impact: text('impact'),
		shortlink: text('shortlink'),
		messageId: text('message_id'),
		lastUpdateId: text('last_update_id'),
		lastUpdatedAt: timestamp('last_updated_at', { withTimezone: true }),
		resolvedAt: timestamp('resolved_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		uniqueIndex('status_page_events_status_page_id_event_type_external_id_unique').on(
			table.statusPageId,
			table.eventType,
			table.externalId,
		),
	],
);

export const githubWatchedRepositories = pgTable(
	'github_watched_repositories',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		guildId: text('guild_id').notNull(),
		owner: text('owner').notNull(),
		repo: text('repo').notNull(),
		statusMessageId: text('status_message_id'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		uniqueIndex('github_watched_repositories_guild_id_owner_repo_unique').on(table.guildId, table.owner, table.repo),
	],
);

export const statusPagesRelations = relations(statusPages, ({ many }) => ({
	events: many(statusPageEvents),
}));

export const statusPageEventsRelations = relations(statusPageEvents, ({ one }) => ({
	statusPage: one(statusPages, {
		fields: [statusPageEvents.statusPageId],
		references: [statusPages.id],
	}),
}));

export type StatusPage = typeof statusPages.$inferSelect;
export type NewStatusPage = typeof statusPages.$inferInsert;
export type StatusPageEvent = typeof statusPageEvents.$inferSelect;
export type NewStatusPageEvent = typeof statusPageEvents.$inferInsert;
export type GithubWatchedRepository = typeof githubWatchedRepositories.$inferSelect;
export type NewGithubWatchedRepository = typeof githubWatchedRepositories.$inferInsert;
