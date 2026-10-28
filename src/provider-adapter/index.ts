import { ensureDefaultProviderAdapters } from './install-defaults.js';
import {
    getProviderAdapter as getRegistered,
    listProviderAdapterIds as listIds,
    registerProviderAdapter,
    tryGetProviderAdapter as tryGet,
} from './registry.js';
import type { ProviderAdapter, ProviderAdapterId } from './types.js';

ensureDefaultProviderAdapters();

export function getProviderAdapter(id: ProviderAdapterId): ProviderAdapter {
    ensureDefaultProviderAdapters();
    return getRegistered(id);
}

export function tryGetProviderAdapter(id: ProviderAdapterId): ProviderAdapter | undefined {
    ensureDefaultProviderAdapters();
    return tryGet(id);
}

export function listProviderAdapterIds(): ProviderAdapterId[] {
    ensureDefaultProviderAdapters();
    return listIds();
}

export {
    AI_GATEWAY_LOGS_PER_PAGE,
    type AiGatewayCostLogFn,
    type AwaitAiGatewayCostResult,
    awaitAiGatewayCostUsd,
    buildReviewGatewayMetadata,
    type FetchAiGatewayCostOnceResult,
    fetchAiGatewayCostOnce,
    type ReviewGatewayMetadata,
    resolveGatewayCostUsd,
    resolveReviewCostUsd,
    sumAiGatewayCostUsd,
} from './ai-gateway-cost.js';
export { resetDefaultProviderAdaptersForTest } from './install-defaults.js';
export { fetchOpenCodeGoQuota } from './opencode-go-quota.js';
export { cursorUsageAdapter } from './providers/cursor.js';
export { opencodeGoAdapter, parseOpenCodeGoModelId } from './providers/opencode-go.js';
export { workersAiGatewayAdapter } from './providers/workers-ai-gateway.js';

export {
    estimateCostUsdFromRateCard,
    OPENCODE_GO_KIMI_K27_CODE_RATES,
    type RateCardRates,
    resolveRateCard,
} from './rate-card.js';
export { clearProviderAdaptersForTest } from './registry.js';
export {
    emptyTokenMetrics,
    filterMessagesForRun,
    type SumTokenMetricsOptions,
    sumTokenMetricsFromMessages,
    type TokenMetrics,
    totalTokens,
    usageSnapshotFromMetrics,
} from './token-metrics.js';
export type {
    BillingQuery,
    BillingSnapshot,
    BindableSession,
    BindModelDeps,
    CostSource,
    ProviderAdapter,
    ProviderAdapterCapabilities,
    ProviderAdapterId,
    QuotaQuery,
    QuotaSnapshot,
    QuotaWindow,
    TokenBuckets,
    UsageQuery,
    UsageSnapshot,
} from './types.js';
export { registerProviderAdapter };
