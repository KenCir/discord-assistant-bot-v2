import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
	githubWatchedRepositories,
	type GithubWatchedRepository,
	type NewGithubWatchedRepository,
} from '../db/schema.js';

export async function createGithubWatchedRepository(values: NewGithubWatchedRepository) {
	const [created] = await db.insert(githubWatchedRepositories).values(values).onConflictDoNothing().returning();

	return created ?? null;
}

export async function deleteGithubWatchedRepository(guildId: string, owner: string, repo: string) {
	const [deleted] = await db
		.delete(githubWatchedRepositories)
		.where(
			and(
				eq(githubWatchedRepositories.guildId, guildId),
				eq(githubWatchedRepositories.owner, owner),
				eq(githubWatchedRepositories.repo, repo),
			),
		)
		.returning();

	return deleted ?? null;
}

export async function findGithubWatchedRepository(guildId: string, owner: string, repo: string) {
	return db.query.githubWatchedRepositories.findFirst({
		where: and(
			eq(githubWatchedRepositories.guildId, guildId),
			eq(githubWatchedRepositories.owner, owner),
			eq(githubWatchedRepositories.repo, repo),
		),
	});
}

export async function listGithubWatchedRepositories(guildId: string): Promise<GithubWatchedRepository[]> {
	return db.query.githubWatchedRepositories.findMany({
		orderBy: (table, { asc }) => [asc(table.owner), asc(table.repo)],
		where: eq(githubWatchedRepositories.guildId, guildId),
	});
}

export async function updateGithubWatchedRepositoryMessageId(id: string, statusMessageId: string | null) {
	const [updated] = await db
		.update(githubWatchedRepositories)
		.set({ statusMessageId, updatedAt: new Date() })
		.where(eq(githubWatchedRepositories.id, id))
		.returning();

	if (!updated) {
		throw new Error('Failed to update GitHub watched repository message ID.');
	}

	return updated;
}
