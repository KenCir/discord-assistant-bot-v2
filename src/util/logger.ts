import process from 'node:process';
import pino from 'pino';

let transport;
if (process.env.NODE_ENV === 'development') {
	transport = pino.transport({
		targets: [
			{
				target: 'pino-pretty',
				options: {
					colorize: true,
					translateTime: 'SYS:yyyy-mm-dd HH:MM:ss o', // JSTにする
					ignore: 'pid,hostname',
				},
				level: 'debug',
			},
		],
	});
}

export const logger = pino(
	{
		name: process.env.LOGGER_NAME,
		level: process.env.NODE_ENV === 'development' ? 'debug' : 'info',
	},
	transport,
);
