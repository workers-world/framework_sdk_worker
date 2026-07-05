import { shanghaiYmdDash } from '../time/shanghai.js';

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

/** 判断 billable/usage 返回的记录是否属于 Workers AI（Neurons 计费） */
export function isWorkersAiMetric(record: BillableUsageRecord): boolean {
  const metric = (record.x_BillableMetricId || '').toLowerCase();
  const service = (record.ServiceName || '').toLowerCase();
  return metric.includes('neuron')
    || metric.includes('workers_ai')
    || metric.includes('workers-ai')
    || service.includes('workers ai');
}

/** 拉取当日 Workers AI Neurons 用量（Billable Usage API） */
export async function fetchTodayNeuronsUsed(
  accountId: string,
  apiToken: string,
  date: Date = new Date(),
): Promise<FetchNeuronsResult> {
  const today = shanghaiYmdDash(date);
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId.trim()}/billable/usage?from=${today}&to=${today}`;

  let resp: Response;
  try {
    resp = await fetch(url, {
      headers: { Authorization: `Bearer ${apiToken.trim()}` },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, used: 0, error: msg };
  }

  const data = await resp.json() as {
    success?: boolean;
    result?: BillableUsageRecord[];
    errors?: unknown[];
  };

  if (!resp.ok || !data.success) {
    return {
      ok: false,
      used: 0,
      error: `billable usage API failed: ${JSON.stringify(data.errors || resp.status)}`,
    };
  }

  let used = 0;
  for (const record of data.result || []) {
    if (isWorkersAiMetric(record)) {
      used += record.ConsumedQuantity || 0;
    }
  }

  return { ok: true, used };
}

/** 识别 Workers AI 日 Neurons 额度错误（4006 等） */
export function isNeuronQuotaError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('4006')
    || lower.includes('neuron_quota_exceeded')
    || lower.includes('daily free allocation')
    || (lower.includes('neurons') && lower.includes('upgrade'));
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
