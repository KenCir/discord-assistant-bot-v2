import { z } from 'zod';

const DateTimeOffset = z.iso.datetime({ offset: true });

export const KnownStatusIndicatorSchema = z.enum(['none', 'minor', 'major', 'critical']);
export const StatusIndicatorSchema = z.union([KnownStatusIndicatorSchema, z.string().min(1)]);

export const ComponentStatusSchema = z.enum([
	'operational',
	'degraded_performance',
	'partial_outage',
	'major_outage',
	'under_maintenance',
]);

export const IncidentUpdateSchema = z.object({
	id: z.string(),
	incident_id: z.string(),
	status: z.string(),
	body: z.string().nullable().optional(),
	created_at: DateTimeOffset,
	updated_at: DateTimeOffset,
	display_at: DateTimeOffset,
});

export const ComponentSchema = z.object({
	id: z.string(),
	name: z.string(),
	status: ComponentStatusSchema,
	description: z.string().nullable(),
	position: z.number(),
	updated_at: DateTimeOffset,
});

export const IncidentSchema = z.object({
	id: z.string(),
	name: z.string(),
	status: z.string(),
	impact: StatusIndicatorSchema,
	shortlink: z.url(),
	incident_updates: z.array(IncidentUpdateSchema),
	created_at: DateTimeOffset,
	updated_at: DateTimeOffset,
	monitoring_at: DateTimeOffset.nullable(),
	resolved_at: DateTimeOffset.nullable(),
});

export const MaintenanceSchema = IncidentSchema.extend({
	impact: z.string().nullable(),
	scheduled_for: DateTimeOffset,
	scheduled_until: DateTimeOffset,
});

export const StatusSummarySchema = z.object({
	page: z.object({
		id: z.string(),
		name: z.string(),
		url: z.url(),
		updated_at: z.coerce.date(),
	}),
	status: z.object({
		indicator: StatusIndicatorSchema,
		description: z.string(),
	}),
	components: z.array(ComponentSchema),
	incidents: z.array(IncidentSchema),
	scheduled_maintenances: z.array(MaintenanceSchema),
});

export type StatusIndicator = z.infer<typeof StatusIndicatorSchema>;
export type ComponentStatus = z.infer<typeof ComponentStatusSchema>;
export type StatusSummary = z.infer<typeof StatusSummarySchema>;
export type StatusIncident = z.infer<typeof IncidentSchema>;
export type StatusMaintenance = z.infer<typeof MaintenanceSchema>;
