import { fetchOpenCodeGoQuota } from '../opencode-go-quota.js';
import { estimateCostUsdFromRateCard, resolveRateCard } from '../rate-card.js';
import { sumTokenMetricsFromMessages, usageSnapshotFromMetrics } from '../token-metrics.js';
import type {
    BillingQuery,
    BillingSnapshot,
    BindableSession,
    BindModelDeps,
    ProviderAdapter,
    QuotaQuery,
    QuotaSnapshot,
    UsageQuery,
    UsageSnapshot,
} from '../types.js';

/** `opencode-go/kimi-k2.7-code` → { providerID, id } */
export function parseOpenCodeGoModelId(modelId: string): { providerID: string; id: string } | null {
    const slash = modelId.indexOf('/');
    if (slash <= 0) {
        return null;
    }
    const providerID = modelId.slice(0, slash);
    const id = modelId.slice(slash + 1);
    if (providerID !== 'opencode-go' || !id) {
        return null;
    }
    return { providerID, id };
}

export const opencodeGoAdapter: ProviderAdapter = {
    id: 'opencode_go',
    capabilities: {
        bindModel: true,
        usage: true,
        billing: true,
        quota: true,
    },

    async bindModel(session: BindableSession, deps: BindModelDeps): Promise<void> {
        const parsed = parseOpenCodeGoModelId(deps.modelId);
        if (!parsed) {
            throw new Error(`invalid_opencode_go_model:${deps.modelId}`);
        }
        await session.setModel(parsed);
    },

    async resolveUsage(q: UsageQuery): Promise<UsageSnapshot> {
        const metrics = sumTokenMetricsFromMessages(q.messages, {
            operationId: q.operationId,
            sinceMs: q.sinceMs,
        });
        return usageSnapshotFromMetrics(metrics, q.operationId ?? q.runId ?? '');
    },

    async resolveBilling(q: BillingQuery): Promise<BillingSnapshot> {
        if (q.usage.message_cost_usd > 0) {
            return { costUsd: q.usage.message_cost_usd, source: 'provider_reported' };
        }
        const rates = resolveRateCard(q.modelId);
        if (!rates) {
            return { costUsd: 0, source: 'none' };
        }
        const costUsd = estimateCostUsdFromRateCard(q.usage, rates);
        if (costUsd <= 0) {
            // tokens 全 0 时仍标 rate_card（SoT 明确），避免长期 none
            const anyTokens =
                q.usage.tokens_input +
                    q.usage.tokens_output +
                    q.usage.tokens_reasoning +
                    q.usage.tokens_cache_read +
                    q.usage.tokens_cache_write >
                0;
            return { costUsd: 0, source: anyTokens ? 'rate_card' : 'none' };
        }
        return { costUsd, source: 'rate_card' };
    },

    async snapshotQuota(q: QuotaQuery): Promise<QuotaSnapshot> {
        const key = q.apiKey?.trim();
        if (!key) {
            throw new Error('OPENCODE_GO_API_KEY required for quota');
        }
        return fetchOpenCodeGoQuota({
            apiKey: key,
            fetchImpl: q.fetchImpl,
            baseUrl: q.baseUrl,
        });
    },
};
