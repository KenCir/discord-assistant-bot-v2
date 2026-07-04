import {
	PermissionFlagsBits,
	type ChatInputCommandInteraction,
	type GuildMember,
	type PermissionResolvable,
	type User,
} from 'discord.js';

const maxTimeoutMs = 28 * 24 * 60 * 60 * 1_000;

export class ModerationError extends Error {
	public constructor(message: string) {
		super(message);
		this.name = 'ModerationError';
	}
}

export function formatModerationReason(interaction: ChatInputCommandInteraction, reason: string | null): string {
	const executor = `${interaction.user.tag} (${interaction.user.id})`;

	return reason ? `${reason} / 実行者: ${executor}` : `実行者: ${executor}`;
}

export function parseTimeoutDuration(minutes: number): number {
	const durationMs = minutes * 60 * 1_000;

	if (durationMs <= 0 || durationMs > maxTimeoutMs) {
		throw new ModerationError('timeout の期間は 1分以上、28日以内で指定してください。');
	}

	return durationMs;
}

export async function getTargetMember(interaction: ChatInputCommandInteraction, user: User): Promise<GuildMember> {
	if (!interaction.guild) {
		throw new ModerationError('このコマンドはサーバー内で実行してください。');
	}

	try {
		return await interaction.guild.members.fetch(user.id);
	} catch {
		throw new ModerationError('対象ユーザーはこのサーバーのメンバーではありません。');
	}
}

export async function assertModerationContext(
	interaction: ChatInputCommandInteraction,
	target: GuildMember | User,
	permission: PermissionResolvable,
): Promise<void> {
	if (!interaction.guild) {
		throw new ModerationError('このコマンドはサーバー内で実行してください。');
	}

	const executor = await interaction.guild.members.fetch(interaction.user.id);
	const me = interaction.guild.members.me ?? (await interaction.guild.members.fetchMe());

	if (!executor.permissions.has(permission)) {
		throw new ModerationError(`この操作には ${formatPermission(permission)} 権限が必要です。`);
	}

	if (!me.permissions.has(permission)) {
		throw new ModerationError(`Bot に ${formatPermission(permission)} 権限がありません。`);
	}

	if (target.id === interaction.user.id) {
		throw new ModerationError('自分自身を対象にはできません。');
	}

	if (target.id === me.id) {
		throw new ModerationError('Bot 自身を対象にはできません。');
	}

	if (target.id === interaction.guild.ownerId) {
		throw new ModerationError('サーバーオーナーは対象にできません。');
	}

	if ('roles' in target) {
		if (
			executor.id !== interaction.guild.ownerId &&
			target.roles.highest.comparePositionTo(executor.roles.highest) >= 0
		) {
			throw new ModerationError('自分以上のロールを持つメンバーは対象にできません。');
		}

		if (target.roles.highest.comparePositionTo(me.roles.highest) >= 0) {
			throw new ModerationError('Bot 以上のロールを持つメンバーは対象にできません。');
		}
	}
}

export function formatUserLabel(user: User): string {
	return `${user.tag} (${user.id})`;
}

function formatPermission(permission: PermissionResolvable): string {
	if (permission === PermissionFlagsBits.KickMembers) {
		return 'Kick Members';
	}

	if (permission === PermissionFlagsBits.BanMembers) {
		return 'Ban Members';
	}

	if (permission === PermissionFlagsBits.ModerateMembers) {
		return 'Moderate Members';
	}

	return String(permission);
}
