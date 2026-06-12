import { ApplicationCommandOptionType, ApplicationCommandType, codeBlock } from 'discord.js';
import { createVideoSession } from '../vrc/videoSession.js';
import type { Command } from './index.js';

export default {
	data: {
		name: 'vrc',
		description: 'VRChat 向けの補助コマンドです。',
		type: ApplicationCommandType.ChatInput,
		options: [
			{
				type: ApplicationCommandOptionType.Subcommand,
				name: 'session',
				description: '動画再生用のセッションURLを作成します。',
				options: [
					{
						type: ApplicationCommandOptionType.String,
						name: 'youtube_url',
						description: 'YouTube URL。',
						required: true,
					},
				],
			},
		],
	},
	async execute(interaction) {
		if (!interaction.isChatInputCommand()) {
			await interaction.reply('このコマンドはチャット入力コマンドとして実行してください。');
			return;
		}

		await interaction.deferReply();

		const subcommand = interaction.options.getSubcommand();

		if (subcommand !== 'session') {
			await interaction.editReply(`未対応のサブコマンドです: ${subcommand}`);
			return;
		}

		const youtubeUrl = interaction.options.getString('youtube_url', true);

		try {
			const session = await createVideoSession(youtubeUrl);

			await interaction.editReply(
				[
					`動画セッションを作成しました。`,
					`ID: ${session.id}`,
					'stream_url:',
					codeBlock(session.stream_url),
					session.note,
				].join('\n'),
			);
		} catch (error) {
			await interaction.editReply(
				[
					'動画セッションの作成に失敗しました。',
					`理由: ${error instanceof Error ? error.message : 'Unknown error'}`,
					'VRC_VIDEO_SERVER_URL と配信サーバーの状態を確認してください。',
				].join('\n'),
			);
		}
	},
} satisfies Command;
