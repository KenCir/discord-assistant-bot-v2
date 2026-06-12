import { z } from 'zod';
import { StatusSummarySchema, type StatusSummary } from './schemas.js';

export type StatuspageFetchResult =
	| {
			data: StatusSummary;
			etag: string | null;
			type: 'modified';
	  }
	| {
			etag: string | null;
			type: 'not_modified';
	  };

export class StatuspageFetchError extends Error {
	public constructor(
		message: string,
		public readonly details?: unknown,
	) {
		super(message);
		this.name = 'StatuspageFetchError';
	}
}

export function normalizeStatuspageUrl(input: string): string {
	let url: URL;

	try {
		url = new URL(input);
	} catch {
		throw new StatuspageFetchError(`URL が不正です: ${input}`);
	}

	if (url.protocol !== 'https:' && url.protocol !== 'http:') {
		throw new StatuspageFetchError('Statuspage URL は http または https で指定してください。');
	}

	url.hash = '';
	url.search = '';

	return url.toString().replace(/\/$/, '');
}

export function createSummaryUrl(baseUrl: string): string {
	return `${normalizeStatuspageUrl(baseUrl)}/api/v2/summary.json`;
}

export async function fetchStatusSummary(baseUrl: string, etag?: string | null): Promise<StatuspageFetchResult> {
	const response = await fetch(createSummaryUrl(baseUrl), {
		headers: etag ? { 'If-None-Match': etag } : {},
	});

	const nextEtag = response.headers.get('etag');

	if (response.status === 304) {
		return { type: 'not_modified', etag: nextEtag };
	}

	if (!response.ok) {
		throw new StatuspageFetchError(`Statuspage API の取得に失敗しました: ${response.status} ${response.statusText}`);
	}

	const rawData: unknown = await response.json();
	const result = StatusSummarySchema.safeParse(rawData);

	if (!result.success) {
		throw new StatuspageFetchError('Statuspage API のレスポンス形式が不正です。', z.treeifyError(result.error));
	}

	return {
		type: 'modified',
		etag: nextEtag,
		data: result.data,
	};
}
