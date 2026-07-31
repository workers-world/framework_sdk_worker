export interface BillableUsageRecord {
    ConsumedQuantity?: number;
    x_BillableMetricId?: string;
    ServiceName?: string;
}

export interface FetchNeuronsResult {
    ok: boolean;
    used: number;
    error?: string;
}

/** UTC 当日 YYYY-MM-DD（Workers AI 日配额按 UTC 00:00 重置） */
export function utcYmdDash(date: Date = new Date()): string {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/** UTC 自然日 [start, end) ISO 8601，用于 GraphQL datetime 过滤 */
export function utcDayRangeIso(date: Date = new Date()): { start: string; end: string } {
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth();
    const d = date.getUTCDate();
    const start = new Date(Date.UTC(y, m, d, 0, 0, 0));
    const end = new Date(Date.UTC(y, m, d + 1, 0, 0, 0));
    return {
        start: start.toISOString().replace(/\.\d{3}Z$/, 'Z'),
        end: end.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    };
}

/** 距 UTC 次日 00:05 秒数（Workers AI Neurons 日配额按 UTC 00:00 重置） */
export function secondsUntilNextUtcDay(now: Date = new Date(), bufferSec = 5 * 60): number {
    const {end} = utcDayRangeIso(now);
    const endMs = new Date(end).getTime();
    return Math.max(1, Math.ceil((endMs - now.getTime()) / 1000) + bufferSec);
}

/** 判断 billable/usage 返回的记录是否属于 Workers AI（Neurons 计费） */
export function isWorkersAiMetric(record: BillableUsageRecord): boolean {
    const metric = (record.x_BillableMetricId || '').toLowerCase();
    const service = (record.ServiceName || '').toLowerCase();
    return metric.includes('neuron')
        || metric.includes('workers_ai')
        || metric.includes('workers-ai')
        || service.includes('workers ai');
}

/** 拉取 UTC 当日 Workers AI Neurons 用量（GraphQL aiInferenceAdaptiveGroups） */
export async function fetchTodayNeuronsUsed(
    accountId: string,
    apiToken: string,
    date: Date = new Date(),
): Promise<FetchNeuronsResult> {
    const {start, end} = utcDayRangeIso(date);
    const query = `
    query NeuronsUsedToday($accountId: String!, $start: Time!, $end: Time!) {
      viewer {
        accounts(filter: { accountTag: $accountId }) {
          aiInferenceAdaptiveGroups(
            filter: { datetime_geq: $start, datetime_lt: $end }
            limit: 10000
          ) {
            sum { totalNeurons }
          }
        }
      }
    }
  `;

    let resp: Response;
    try {
        resp = await fetch('https://api.cloudflare.com/client/v4/graphql', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiToken.trim()}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                query,
                variables: {
                    accountId: accountId.trim(),
                    start,
                    end,
                },
            }),
        });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return {ok: false, used: 0, error: msg};
    }

    const data = await resp.json() as {
        data?: {
            viewer?: {
                accounts?: Array<{
                    aiInferenceAdaptiveGroups?: Array<{ sum?: { totalNeurons?: number } }>;
                }>;
            };
        };
        errors?: unknown[];
    };

    if (!resp.ok) {
        return {
            ok: false,
            used: 0,
            error: `graphql neurons query failed: HTTP ${resp.status}`,
        };
    }

    if (data.errors?.length) {
        return {
            ok: false,
            used: 0,
            error: `graphql neurons query failed: ${JSON.stringify(data.errors)}`,
        };
    }

    const groups = data.data?.viewer?.accounts?.[0]?.aiInferenceAdaptiveGroups ?? [];
    let used = 0;
    for (const group of groups) {
        used += group.sum?.totalNeurons ?? 0;
    }

    return {ok: true, used};
}

/** 从 Error / AiError 对象 / 字符串提取可匹配的错误文案 */
export function extractAiErrorMessage(value: unknown): string {
    if (value == null) {
        return '';
    }
    if (typeof value === 'string') {
        return value;
    }
    if (value instanceof Error) {
        return value.message;
    }
    if (typeof value === 'object') {
        const record = value as Record<string, unknown>;
        if (typeof record.message === 'string' && record.message.trim()) {
            return record.message;
        }
        if (typeof record.description === 'string' && record.description.trim()) {
            return record.description;
        }
        if (record.internalCode === 4006) {
            return JSON.stringify(record);
        }
        try {
            return JSON.stringify(record);
        } catch {
            return String(value);
        }
    }
    return String(value);
}

function isNeuronQuotaMessage(message: string): boolean {
    const lower = message.toLowerCase();
    return lower.includes('4006')
        || lower.includes('neuron_quota_exceeded')
        || lower.includes('daily free allocation')
        || (lower.includes('neurons') && lower.includes('upgrade'));
}

/** 识别 Workers AI 日 Neurons 额度错误（4006 等） */
export function isNeuronQuotaError(value: unknown): boolean {
    if (typeof value === 'object' && value != null && !Array.isArray(value)) {
        const record = value as Record<string, unknown>;
        if (record.internalCode === 4006) {
            return true;
        }
    }
    return isNeuronQuotaMessage(extractAiErrorMessage(value));
}

export function hasNeuronQuotaRemaining(
    used: number,
    limit = 10_000,
    reserve = 500,
): boolean {
    return used + reserve <= limit;
}

export function neuronQuotaStatus(
    used: number,
    limit = 10_000,
    reserve = 500,
): { remaining: number; exceeded: boolean } {
    const remaining = Math.max(0, limit - used);
    return {
        remaining,
        exceeded: !hasNeuronQuotaRemaining(used, limit, reserve),
    };
}
