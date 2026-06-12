import process from 'node:process';
import { Events } from 'discord.js';
import { GithubStatusReporter } from '../services/githubStatusReporter.js';
import { HostStatusReporter } from '../services/hostStatusReporter.js';
import { StatuspageScheduler } from '../statuspage/scheduler.js';
import { logger } from '../util/logger.js';
import type { Event } from './index.js';

export default {
	name: Events.ClientReady,
	once: true,
	async execute(client) {
		logger.info({ userTag: client.user.tag }, 'Discord client is ready.');

		const scheduler = new StatuspageScheduler(client);
		scheduler.start();
		logger.info('Statuspage scheduler started.');

		const hostStatusReporter = new HostStatusReporter(client);
		await hostStatusReporter.start();

		const githubStatusReporter = new GithubStatusReporter(client);
		await githubStatusReporter.start();

		registerShutdownHooks([hostStatusReporter, githubStatusReporter]);
	},
} satisfies Event<Events.ClientReady>;

type StoppableReporter = {
	stop(): Promise<void>;
};

function registerShutdownHooks(reporters: StoppableReporter[]): void {
	let shutdownStarted = false;

	const shutdown = async (signal: string): Promise<void> => {
		if (shutdownStarted) {
			return;
		}

		shutdownStarted = true;
		logger.info({ signal }, 'Stopping status reporters.');
		await Promise.all(reporters.map(async (reporter) => reporter.stop()));

		if (signal !== 'beforeExit') {
			process.exit(0);
		}
	};

	process.once('SIGINT', () => {
		void shutdown('SIGINT');
	});
	process.once('SIGTERM', () => {
		void shutdown('SIGTERM');
	});
	process.once('beforeExit', () => {
		void shutdown('beforeExit');
	});
}
