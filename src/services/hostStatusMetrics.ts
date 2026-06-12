import os from 'node:os';
import type { HostStatusSnapshot } from './hostStatus.js';

export type HostStatusMetricPoint = {
	cpuUsagePercent: number;
	loadUsagePercent: number;
	memoryUsagePercent: number;
	recordedAt: Date;
};

const maxHistoryPoints = 60;

type CpuTimes = {
	idle: number;
	total: number;
};

class CpuUsageSampler {
	private previousTimes: CpuTimes | null = null;

	public sample(): number {
		const currentTimes = readCpuTimes();

		if (!this.previousTimes) {
			this.previousTimes = currentTimes;
			return 0;
		}

		const totalDifference = currentTimes.total - this.previousTimes.total;
		const idleDifference = currentTimes.idle - this.previousTimes.idle;
		this.previousTimes = currentTimes;

		if (totalDifference <= 0) {
			return 0;
		}

		return clampPercent(((totalDifference - idleDifference) / totalDifference) * 100);
	}
}

export class HostStatusMetricsHistory {
	private readonly points: HostStatusMetricPoint[] = [];

	private readonly cpuUsageSampler = new CpuUsageSampler();

	public add(snapshot: HostStatusSnapshot, recordedAt: Date): void {
		this.points.push({
			cpuUsagePercent: this.cpuUsageSampler.sample(),
			loadUsagePercent: clampPercent(snapshot.loadUsagePercent),
			memoryUsagePercent: clampPercent(snapshot.memoryUsagePercent),
			recordedAt,
		});

		if (this.points.length > maxHistoryPoints) {
			this.points.splice(0, this.points.length - maxHistoryPoints);
		}
	}

	public getPoints(): readonly HostStatusMetricPoint[] {
		return this.points;
	}
}

function readCpuTimes(): CpuTimes {
	return os.cpus().reduce<CpuTimes>(
		(accumulator, cpu) => {
			const total = Object.values(cpu.times).reduce((sum, value) => sum + value, 0);

			return {
				idle: accumulator.idle + cpu.times.idle,
				total: accumulator.total + total,
			};
		},
		{ idle: 0, total: 0 },
	);
}

function clampPercent(value: number): number {
	return Math.min(100, Math.max(0, value));
}
