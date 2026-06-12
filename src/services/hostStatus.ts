import os from 'node:os';

export type HostStatusSnapshot = {
	arch: string;
	cpuCores: number;
	freeMemoryBytes: number;
	hostname: string;
	loadAverage: [number, number, number];
	loadUsagePercent: number;
	memoryUsagePercent: number;
	platform: string;
	totalMemoryBytes: number;
	uptimeSeconds: number;
	usedMemoryBytes: number;
	warnings: string[];
};

const highMemoryUsagePercent = 80;
const highLoadUsagePercent = 80;
const bytesPerGigabyte = 1_024 ** 3;
const secondsPerDay = 86_400;
const secondsPerHour = 3_600;
const secondsPerMinute = 60;

export function getHostStatusSnapshot(): HostStatusSnapshot {
	const totalMemoryBytes = os.totalmem();
	const freeMemoryBytes = os.freemem();
	const usedMemoryBytes = totalMemoryBytes - freeMemoryBytes;
	const cpuCores = os.cpus().length;
	const loadAverage = os.loadavg() as [number, number, number];
	const memoryUsagePercent = (usedMemoryBytes / totalMemoryBytes) * 100;
	const loadUsagePercent = cpuCores > 0 ? (loadAverage[0] / cpuCores) * 100 : 0;
	const warnings: string[] = [];

	if (memoryUsagePercent >= highMemoryUsagePercent) {
		warnings.push('Memory usage is high.');
	}

	if (loadUsagePercent >= highLoadUsagePercent) {
		warnings.push('Load average is high.');
	}

	// When running inside Docker, node:os may expose host-like values depending on the runtime and limits.
	return {
		arch: os.arch(),
		cpuCores,
		freeMemoryBytes,
		hostname: os.hostname(),
		loadAverage,
		loadUsagePercent,
		memoryUsagePercent,
		platform: os.platform(),
		totalMemoryBytes,
		uptimeSeconds: os.uptime(),
		usedMemoryBytes,
		warnings,
	};
}

export function formatBytesAsGigabytes(bytes: number): string {
	return `${(bytes / bytesPerGigabyte).toFixed(1)}GB`;
}

export function formatUptime(totalSeconds: number): string {
	const days = Math.floor(totalSeconds / secondsPerDay);
	const hours = Math.floor((totalSeconds % secondsPerDay) / secondsPerHour);
	const minutes = Math.floor((totalSeconds % secondsPerHour) / secondsPerMinute);

	return `${days}d ${hours}h ${minutes}m`;
}
