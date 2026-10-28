import type { QuotaSnapshot, QuotaWindow } from './types.js';

const DEFAULT_USAGE_URL = 'https://opencode.ai/zen/go/v1/usage';

function parseWindow(raw: unknown): QuotaWindow | undefined {
    if (!raw || typeof raw !== 'object') {
        return undefined;
    }
    const w = raw as Record<string, unknown>;
    const percent = typeof w.percent === 'number' && Number.isFinite(w.percent) ? w.percent : null;
    if (percent == null) {
        return undefined;
    }
    return {
        status: typeof w.status === 'string' ? w.status : 'ok',
        percent,
        resetsAt: typeof w.resetsAt === 'string' ? w.resetsAt : undefined,
    };
}

/**
 * OpenCode Go 账号配额（rolling/weekly/monthly percent）。
 * **不是** per-run USD — 勿写入 cost_usd。
 */
export async function fetchOpenCodeGoQuota(options: {
    apiKey: string;
    fetchImpl?: typeof fetch;
    baseUrl?: string;
}): Promise<QuotaSnapshot> {
    const key = options.apiKey.trim();
    if (!key) {
        throw new Error('OPENCODE_GO_API_KEY required for quota');
    }
    const fetchFn = options.fetchImpl ?? fetch;
    const url = options.baseUrl?.trim() || DEFAULT_USAGE_URL;
    const resp = await fetchFn(url, {
        headers: {
            Authorization: `Bearer ${key}`,
            Accept: 'application/json',
        },
    });
    if (!resp.ok) {
        throw new Error(`opencode_go_usage_http_${resp.status}`);
    }
    const body = (await resp.json()) as { usage?: Record<string, unknown> };
    const usage = body.usage ?? {};
    return {
        rolling: parseWindow(usage.rolling),
        weekly: parseWindow(usage.weekly),
        monthly: parseWindow(usage.monthly),
    };
}
