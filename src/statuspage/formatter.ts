import { EmbedBuilder } from 'discord.js';
import type { ComponentStatus, StatusIncident, StatusIndicator, StatusMaintenance, StatusSummary } from './schemas.js';

const maxEmbedFieldValueLength = 1_024;
const maxDisplayedComponents = 10;

const componentPriority: Record<ComponentStatus, number> = {
	major_outage: 0,
	partial_outage: 1,
	degraded_performance: 2,
	under_maintenance: 3,
	operational: 4,
};

export function formatStatusIndicator(indicator: StatusIndicator): string {
	switch (indicator) {
		case 'none':
			return '全てのシステムが稼働中';
		case 'minor':
			return '部分的なシステム障害が発生中';
		case 'major':
			return '大規模なシステム障害が発生中';
		case 'critical':
			return 'システム全体の停止が発生中';
		default:
			return `未対応のステータス (${indicator})`;
	}
}

export function formatIncidentStatus(status: string): string {
	switch (status) {
		case 'investigating':
			return '調査中';
		case 'identified':
			return '特定済み';
		case 'monitoring':
			return '監視中';
		case 'resolved':
			return '解決済み';
		case 'postmortem':
			return '事後分析';
		default:
			return status;
	}
}

export function formatMaintenanceStatus(status: string): string {
	switch (status) {
		case 'scheduled':
			return '予定';
		case 'in_progress':
			return '実施中';
		case 'verifying':
			return '確認中';
		case 'completed':
			return '完了';
		default:
			return formatIncidentStatus(status);
	}
}

export function formatComponentStatus(status: ComponentStatus): string {
	switch (status) {
		case 'operational':
			return '正常';
		case 'degraded_performance':
			return '性能低下';
		case 'partial_outage':
			return '部分停止';
		case 'major_outage':
			return '大規模停止';
		case 'under_maintenance':
			return 'メンテナンス中';
	}
}

export function createStatusEmbed(
	serviceName: string,
	baseUrl: string,
	summary: StatusSummary,
	checkedAt = new Date(),
): EmbedBuilder {
	const affectedComponents = summary.components
		.filter((component) => component.status !== 'operational')
		.sort((a, b) => {
			const priorityDiff = componentPriority[a.status] - componentPriority[b.status];

			if (priorityDiff !== 0) {
				return priorityDiff;
			}

			return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
		})
		.slice(0, maxDisplayedComponents);

	const embed = new EmbedBuilder()
		.setTitle(`${serviceName} Status`)
		.setURL(baseUrl)
		.setDescription(
			[
				`現在のステータス: **${formatStatusIndicator(summary.status.indicator)}**`,
				`発生中のインシデント: **${summary.incidents.length}件**`,
				`予定メンテナンス: **${summary.scheduled_maintenances.length}件**`,
			].join('\n'),
		)
		.setColor(indicatorToColor(summary.status.indicator))
		.setTimestamp(checkedAt);

	if (affectedComponents.length > 0) {
		embed.addFields({
			name: '影響のあるコンポーネント',
			value: truncateFieldValue(
				affectedComponents
					.map((component) => `- ${component.name}: **${formatComponentStatus(component.status)}**`)
					.join('\n'),
			),
		});
	}

	embed.addFields({
		name: '最終確認',
		value: `<t:${Math.floor(checkedAt.getTime() / 1_000)}:F>`,
	});

	return embed;
}

export function createIncidentEmbed(serviceName: string, baseUrl: string, incident: StatusIncident): EmbedBuilder {
	const embed = new EmbedBuilder()
		.setAuthor({ name: `${serviceName} Status`, url: baseUrl })
		.setTitle(`${incident.status === 'resolved' ? '[解決済み] ' : ''}[${serviceName}] ${incident.name}`)
		.setURL(incident.shortlink)
		.setDescription(
			[
				`ステータス: **${formatIncidentStatus(incident.status)}**`,
				`影響範囲: **${incident.impact}**`,
				`最終更新: <t:${Math.floor(new Date(incident.updated_at).getTime() / 1_000)}:R>`,
			].join('\n'),
		)
		.setColor(incident.status === 'resolved' ? 'Green' : 'Orange')
		.setTimestamp(new Date(incident.updated_at));

	for (const update of incident.incident_updates.slice(0, 10)) {
		embed.addFields({
			name: `<t:${Math.floor(new Date(update.created_at).getTime() / 1_000)}:F> - ${formatIncidentStatus(update.status)}`,
			value: truncateFieldValue(update.body ?? '内容なし'),
		});
	}

	return embed;
}

export function createMaintenanceEmbed(
	serviceName: string,
	baseUrl: string,
	maintenance: StatusMaintenance,
): EmbedBuilder {
	return new EmbedBuilder()
		.setAuthor({ name: `${serviceName} Status`, url: baseUrl })
		.setTitle(`${maintenance.status === 'completed' ? '[完了] ' : ''}[${serviceName}] ${maintenance.name}`)
		.setURL(maintenance.shortlink)
		.setDescription(
			[
				`ステータス: **${formatMaintenanceStatus(maintenance.status)}**`,
				`開始予定: <t:${Math.floor(new Date(maintenance.scheduled_for).getTime() / 1_000)}:F>`,
				`終了予定: <t:${Math.floor(new Date(maintenance.scheduled_until).getTime() / 1_000)}:F>`,
				`最終更新: <t:${Math.floor(new Date(maintenance.updated_at).getTime() / 1_000)}:R>`,
			].join('\n'),
		)
		.setColor(maintenance.status === 'completed' ? 'Green' : 'Blue')
		.setTimestamp(new Date(maintenance.updated_at));
}

function indicatorToColor(indicator: StatusIndicator): 'Green' | 'Grey' | 'Orange' | 'Red' | 'Yellow' {
	switch (indicator) {
		case 'none':
			return 'Green';
		case 'minor':
			return 'Yellow';
		case 'major':
			return 'Orange';
		case 'critical':
			return 'Red';
		default:
			return 'Grey';
	}
}

function truncateFieldValue(value: string): string {
	if (value.length <= maxEmbedFieldValueLength) {
		return value;
	}

	return `${value.slice(0, maxEmbedFieldValueLength - 3)}...`;
}
