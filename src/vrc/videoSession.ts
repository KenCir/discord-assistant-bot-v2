import process from 'node:process';
import { z } from 'zod';

const VideoSessionResponseSchema = z.object({
	id: z.string().uuid(),
	note: z.string(),
	stream_url: z.url(),
});

export type VideoSessionResponse = z.infer<typeof VideoSessionResponseSchema>;

export class VideoSessionError extends Error {
	public constructor(
		message: string,
		public readonly details?: unknown,
	) {
		super(message);
		this.name = 'VideoSessionError';
	}
}

export async function createVideoSession(youtubeUrl: string): Promise<VideoSessionResponse> {
	const baseUrl = process.env.VRC_VIDEO_SERVER_URL;

	if (!baseUrl) {
		throw new VideoSessionError('VRC_VIDEO_SERVER_URL is required.');
	}

	const response = await fetch(`${normalizeBaseUrl(baseUrl)}/sessions`, {
		body: JSON.stringify({ youtube_url: youtubeUrl }),
		headers: { 'content-type': 'application/json' },
		method: 'POST',
	});

	if (!response.ok) {
		throw new VideoSessionError(`動画セッションの作成に失敗しました: ${response.status} ${response.statusText}`);
	}

	const rawData: unknown = await response.json();
	const result = VideoSessionResponseSchema.safeParse(rawData);

	if (!result.success) {
		throw new VideoSessionError('動画セッションAPIのレスポンス形式が不正です。', z.treeifyError(result.error));
	}

	return result.data;
}

function normalizeBaseUrl(baseUrl: string): string {
	try {
		const url = new URL(baseUrl);
		url.hash = '';
		url.search = '';

		return url.toString().replace(/\/$/, '');
	} catch {
		throw new VideoSessionError('VRC_VIDEO_SERVER_URL がURLとして不正です。');
	}
}
