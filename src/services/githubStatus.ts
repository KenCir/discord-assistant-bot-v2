import process from 'node:process';
import type { GithubWatchedRepository } from '../db/schema.js';

export type GithubCiStatus = 'failed' | 'running' | 'success' | 'unknown';

export type GithubRepositoryStatus =
	| {
			ciStatus: GithubCiStatus;
			dependabotPullRequests: number;
			issues: number;
			lastPushAt: Date | null;
			latestRelease: string | null;
			owner: string;
			pullRequests: number;
			renovatePullRequests: number;
			repo: string;
			type: 'ok';
	  }
	| {
			error: string;
			owner: string;
			repo: string;
			type: 'error';
	  };

export type GithubRateLimitStatus = {
	cost: number;
	remaining: number;
	resetAt: Date;
};

export type GithubStatusResult = {
	rateLimit: GithubRateLimitStatus | null;
	repositories: GithubRepositoryStatus[];
};

type GraphqlRepository = {
	defaultBranchRef?: {
		target?: {
			statusCheckRollup?: {
				state?: string;
			} | null;
		} | null;
	} | null;
	issues?: {
		totalCount?: number;
	} | null;
	latestRelease?: {
		tagName?: string;
	} | null;
	name?: string;
	owner?: {
		login?: string;
	};
	pullRequests?: {
		totalCount?: number;
	} | null;
	pushedAt?: string | null;
};

type GraphqlRateLimit = {
	cost?: number;
	remaining?: number;
	resetAt?: string;
};

type GraphqlResponse = {
	data?: Record<string, unknown> & {
		rateLimit?: GraphqlRateLimit;
	};
	errors?: {
		message?: string;
		path?: string[];
	}[];
};

const githubGraphqlEndpoint = 'https://api.github.com/graphql';

export class GithubStatusError extends Error {
	public constructor(message: string) {
		super(message);
		this.name = 'GithubStatusError';
	}
}

export async function fetchGithubStatus(repositories: GithubWatchedRepository[]): Promise<GithubStatusResult> {
	const token = process.env.GITHUB_TOKEN;

	if (!token) {
		throw new GithubStatusError('GITHUB_TOKEN is not set.');
	}

	if (repositories.length === 0) {
		return { rateLimit: null, repositories: [] };
	}

	const { query, variables } = createGithubStatusQuery(repositories);
	const response = await fetch(githubGraphqlEndpoint, {
		body: JSON.stringify({ query, variables }),
		headers: {
			accept: 'application/vnd.github+json',
			authorization: `Bearer ${token}`,
			'content-type': 'application/json',
			'user-agent': 'discord-assistant-bot-v2',
		},
		method: 'POST',
	});

	if (!response.ok) {
		throw new GithubStatusError(`GitHub GraphQL API request failed: ${response.status} ${response.statusText}`);
	}

	const body = (await response.json()) as GraphqlResponse;

	return {
		rateLimit: parseRateLimit(body.data?.rateLimit),
		repositories: repositories.map((repository, index) => parseRepositoryStatus(repository, index, body)),
	};
}

export async function verifyGithubRepository(owner: string, repo: string): Promise<void> {
	const token = process.env.GITHUB_TOKEN;

	if (!token) {
		throw new GithubStatusError('GITHUB_TOKEN is not set.');
	}

	const response = await fetch(githubGraphqlEndpoint, {
		body: JSON.stringify({
			query: `
				query VerifyRepository($owner: String!, $repo: String!) {
					repository(owner: $owner, name: $repo) {
						id
					}
				}
			`,
			variables: { owner, repo },
		}),
		headers: {
			accept: 'application/vnd.github+json',
			authorization: `Bearer ${token}`,
			'content-type': 'application/json',
			'user-agent': 'discord-assistant-bot-v2',
		},
		method: 'POST',
	});

	if (!response.ok) {
		throw new GithubStatusError(`GitHub GraphQL API request failed: ${response.status} ${response.statusText}`);
	}

	const body = (await response.json()) as GraphqlResponse;

	if (body.errors?.length) {
		throw new GithubStatusError(body.errors.map((error) => error.message).join(', '));
	}

	if (!body.data?.repository) {
		throw new GithubStatusError('Repository was not found or is not accessible.');
	}
}

function createGithubStatusQuery(repositories: GithubWatchedRepository[]) {
	const variables: Record<string, string> = {};
	const selections = repositories.map((repository, index) => {
		variables[`owner${index}`] = repository.owner;
		variables[`repo${index}`] = repository.repo;
		variables[`renovateQuery${index}`] =
			`repo:${repository.owner}/${repository.repo} is:pr is:open author:renovate[bot]`;
		variables[`dependabotQuery${index}`] =
			`repo:${repository.owner}/${repository.repo} is:pr is:open author:dependabot[bot]`;

		return `
			repo${index}: repository(owner: $owner${index}, name: $repo${index}) {
				owner {
					login
				}
				name
				issues(states: OPEN) {
					totalCount
				}
				pullRequests(states: OPEN) {
					totalCount
				}
				defaultBranchRef {
					target {
						... on Commit {
							statusCheckRollup {
								state
							}
						}
					}
				}
				latestRelease {
					tagName
				}
				pushedAt
			}
			renovate${index}: search(type: ISSUE, query: $renovateQuery${index}) {
				issueCount
			}
			dependabot${index}: search(type: ISSUE, query: $dependabotQuery${index}) {
				issueCount
			}
		`;
	});
	const variableDefinitions = repositories
		.flatMap((_repository, index) => [
			`$owner${index}: String!`,
			`$repo${index}: String!`,
			`$renovateQuery${index}: String!`,
			`$dependabotQuery${index}: String!`,
		])
		.join(', ');

	return {
		query: `
			query GithubStatus(${variableDefinitions}) {
				${selections.join('\n')}
				rateLimit {
					cost
					remaining
					resetAt
				}
			}
		`,
		variables,
	};
}

function parseRepositoryStatus(
	repository: GithubWatchedRepository,
	index: number,
	body: GraphqlResponse,
): GithubRepositoryStatus {
	const error = body.errors?.find((entry) => entry.path?.[0] === `repo${index}`);

	if (error) {
		return {
			error: error.message ?? 'Failed to fetch repository.',
			owner: repository.owner,
			repo: repository.repo,
			type: 'error',
		};
	}

	const rawRepository = body.data?.[`repo${index}`] as GraphqlRepository | null | undefined;

	if (!rawRepository) {
		return {
			error: 'Repository was not found or is not accessible.',
			owner: repository.owner,
			repo: repository.repo,
			type: 'error',
		};
	}

	return {
		ciStatus: mapCiStatus(rawRepository.defaultBranchRef?.target?.statusCheckRollup?.state),
		dependabotPullRequests: readSearchCount(body.data?.[`dependabot${index}`]),
		issues: rawRepository.issues?.totalCount ?? 0,
		lastPushAt: rawRepository.pushedAt ? new Date(rawRepository.pushedAt) : null,
		latestRelease: rawRepository.latestRelease?.tagName ?? null,
		owner: rawRepository.owner?.login ?? repository.owner,
		pullRequests: rawRepository.pullRequests?.totalCount ?? 0,
		renovatePullRequests: readSearchCount(body.data?.[`renovate${index}`]),
		repo: rawRepository.name ?? repository.repo,
		type: 'ok',
	};
}

function parseRateLimit(rateLimit: GraphqlRateLimit | undefined): GithubRateLimitStatus | null {
	if (!rateLimit?.resetAt || rateLimit.cost === undefined || rateLimit.remaining === undefined) {
		return null;
	}

	return {
		cost: rateLimit.cost,
		remaining: rateLimit.remaining,
		resetAt: new Date(rateLimit.resetAt),
	};
}

function readSearchCount(value: unknown): number {
	if (typeof value === 'object' && value !== null && 'issueCount' in value && typeof value.issueCount === 'number') {
		return value.issueCount;
	}

	return 0;
}

function mapCiStatus(status: string | undefined): GithubCiStatus {
	if (status === 'SUCCESS') {
		return 'success';
	}

	if (status === 'ERROR' || status === 'FAILURE') {
		return 'failed';
	}

	if (status === 'EXPECTED' || status === 'PENDING') {
		return 'running';
	}

	return 'unknown';
}
