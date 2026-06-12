import type { Buffer } from 'node:buffer';
import type { ChartConfiguration } from 'chart.js';
import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import type { HostStatusMetricPoint } from './hostStatusMetrics.js';

const width = 900;
const height = 360;

const chart = new ChartJSNodeCanvas({
	backgroundColour: '#111827',
	height,
	width,
});

export async function renderHostStatusChart(points: readonly HostStatusMetricPoint[]): Promise<Buffer> {
	const configuration: ChartConfiguration<'line'> = {
		data: {
			datasets: [
				{
					borderColor: '#60a5fa',
					data: points.map((point) => point.cpuUsagePercent),
					label: 'CPU Usage %',
					pointRadius: 0,
					tension: 0.25,
				},
				{
					borderColor: '#34d399',
					data: points.map((point) => point.memoryUsagePercent),
					label: 'Memory Usage %',
					pointRadius: 0,
					tension: 0.25,
				},
				{
					borderColor: '#f59e0b',
					data: points.map((point) => point.loadUsagePercent),
					label: 'Load Usage %',
					pointRadius: 0,
					tension: 0.25,
				},
			],
			labels: points.map((point) => formatTime(point.recordedAt)),
		},
		options: {
			animation: false,
			devicePixelRatio: 1,
			maintainAspectRatio: false,
			plugins: {
				legend: {
					labels: {
						color: '#e5e7eb',
					},
				},
				title: {
					color: '#f9fafb',
					display: true,
					text: 'Host Metrics History',
				},
			},
			scales: {
				x: {
					grid: {
						color: '#374151',
					},
					ticks: {
						color: '#d1d5db',
						maxRotation: 0,
					},
				},
				y: {
					beginAtZero: true,
					grid: {
						color: '#374151',
					},
					max: 100,
					min: 0,
					ticks: {
						callback: (value) => `${value}%`,
						color: '#d1d5db',
					},
				},
			},
		},
		type: 'line',
	};

	return chart.renderToBuffer(configuration, 'image/png');
}

function formatTime(date: Date): string {
	return new Intl.DateTimeFormat('ja-JP', {
		hour: '2-digit',
		hour12: false,
		minute: '2-digit',
		timeZone: 'Asia/Tokyo',
	}).format(date);
}
