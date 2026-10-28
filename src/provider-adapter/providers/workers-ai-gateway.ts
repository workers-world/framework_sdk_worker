import {
    awaitAiGatewayCostUsd,
    buildReviewGatewayMetadata,
    resolveGatewayCostUsd,
} from '../ai-gateway-cost.js';
import { sumTokenMetricsFromMessages, usageSnapshotFromMetrics } from '../token-metrics.js';
import type {
    BillingQuery,
    BillingSnapshot,
    BindableSession,
    BindModelDeps,
    ProviderAdapter,
    UsageQuery,
    UsageSnapshot,
} from '../types.js';

export const workersAiGatewayAdapter: ProviderAdapter = {
    id: 'workers_ai_gateway',
    capabilities: {
        bindModel: true,
        usage: true,
        billing: true,
        quota: false,
    },

    async bindModel(session: BindableSession, deps: BindModelDeps): Promise<void> {
        if (!deps.ai) {
            throw new Error('workers_ai_gateway_requires_ai_binding');
        }
        const metadata = buildReviewGatewayMetadata({
            runId: deps.runId,
            owner: deps.owner,
            repo: deps.repo,
            pr: deps.pr,
        });
        await session.setModel(
            deps.ai(deps.modelId, {
                reasoningEffort: 'low',
                metadata,
            }),
        );
    },

    async resolveUsage(q: UsageQuery): Promise<UsageSnapshot> {
        const metrics = sumTokenMetricsFromMessages(q.messages, {
            operationId: q.operationId,
            sinceMs: q.sinceMs,
        });
        return usageSnapshotFromMetrics(metrics, q.operationId ?? q.runId ?? '');
    },

    async resolveBilling(q: BillingQuery): Promise<BillingSnapshot> {
        const gateway = await awaitAiGatewayCostUsd({
            accountId: q.accountId,
            apiToken: q.apiToken,
            gatewayId: q.gatewayId?.trim() || 'default',
            runId: q.runId,
            startedAtMs: q.startedAtMs,
            fetchImpl: q.fetchImpl,
            sleep: q.sleep,
            log: q.log,
        });
        return resolveGatewayCostUsd({
            gateway,
            messageCostUsd: q.usage.message_cost_usd,
        });
    },
};
