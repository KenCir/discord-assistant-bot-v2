import type { Client } from 'discord.js';
import type { StatusPage } from '../db/schema.js';
import { logger } from '../util/logger.js';
import { checkStatusPage } from './checker.js';
import { listEnabledStatusPages } from './repository.js';

const schedulerTickMs = 10_000;
const initialStaggerMs = 5_000;
const secondFailureBackoffMs = 20 * 60_000;
const repeatedFailureBackoffMs = 30 * 60_000;

export class StatuspageScheduler {
	private readonly failureCounts = new Map<string, number>();

	private readonly inProgress = new Set<string>();

	private intervalId: NodeJS.Timeout | null = null;

	private readonly nextCheckAt = new Map<string, number>();

	public constructor(private readonly client: Client<true>) {}

	public start(): void {
		if (this.intervalId) {
			return;
		}

		this.intervalId = setInterval(() => {
			void this.tick();
		}, schedulerTickMs);

		void this.tick();
	}

	public stop(): void {
		if (!this.intervalId) {
			return;
		}

		clearInterval(this.intervalId);
		this.intervalId = null;
	}

	private async tick(): Promise<void> {
		let statusPages: StatusPage[];

		try {
			statusPages = await listEnabledStatusPages();
		} catch (error) {
			logger.error(error, 'Failed to load enabled status pages.');
			return;
		}

		this.cleanupState(statusPages);

		const now = Date.now();

		for (const [index, statusPage] of statusPages.entries()) {
			if (!this.nextCheckAt.has(statusPage.id)) {
				this.nextCheckAt.set(statusPage.id, now + index * initialStaggerMs);
			}

			if (this.inProgress.has(statusPage.id)) {
				continue;
			}

			const dueAt = this.nextCheckAt.get(statusPage.id) ?? now;

			if (dueAt > now) {
				continue;
			}

			this.inProgress.add(statusPage.id);
			void this.check(statusPage);
		}
	}

	private async check(statusPage: StatusPage): Promise<void> {
		try {
			const result = await checkStatusPage(this.client, statusPage);
			this.failureCounts.set(statusPage.id, 0);
			this.nextCheckAt.set(statusPage.id, Date.now() + statusPage.checkIntervalSeconds * 1_000);

			if (result.type === 'updated') {
				logger.info(
					{
						baseUrl: statusPage.baseUrl,
						incidentNotifications: result.incidentNotifications,
						maintenanceNotifications: result.maintenanceNotifications,
						name: statusPage.name,
						statusPageId: statusPage.id,
					},
					'Statuspage updated.',
				);
			}
		} catch (error) {
			const failureCount = (this.failureCounts.get(statusPage.id) ?? 0) + 1;
			this.failureCounts.set(statusPage.id, failureCount);
			this.nextCheckAt.set(statusPage.id, Date.now() + this.getBackoffMs(statusPage, failureCount));
			logger.error(
				{
					baseUrl: statusPage.baseUrl,
					error,
					failureCount,
					name: statusPage.name,
					statusPageId: statusPage.id,
				},
				'Statuspage check failed.',
			);
		} finally {
			this.inProgress.delete(statusPage.id);
		}
	}

	private cleanupState(statusPages: StatusPage[]): void {
		const enabledIds = new Set(statusPages.map((statusPage) => statusPage.id));

		for (const statusPageId of this.nextCheckAt.keys()) {
			if (!enabledIds.has(statusPageId)) {
				this.nextCheckAt.delete(statusPageId);
				this.failureCounts.delete(statusPageId);
				this.inProgress.delete(statusPageId);
			}
		}
	}

	private getBackoffMs(statusPage: StatusPage, failureCount: number): number {
		if (failureCount >= 3) {
			return repeatedFailureBackoffMs;
		}

		if (failureCount === 2) {
			return secondFailureBackoffMs;
		}

		return statusPage.checkIntervalSeconds * 1_000;
	}
}
