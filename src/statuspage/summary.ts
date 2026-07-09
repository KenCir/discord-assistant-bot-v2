import type { StatusSummary } from './schemas.js';

export function isInconsistentMaintenanceOnlySummary(summary: StatusSummary): boolean {
	if (summary.status.indicator !== 'maintenance') {
		return false;
	}

	if (summary.incidents.length > 0 || summary.scheduled_maintenances.length > 0) {
		return false;
	}

	const affectedComponents = summary.components.filter((component) => component.status !== 'operational');

	return affectedComponents.every((component) => component.status === 'under_maintenance');
}
