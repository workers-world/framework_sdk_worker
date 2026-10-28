import type { TokenBuckets } from './types.js';

/**
 * USD per 1M tokens（估计）。
 * OpenCode Go 是订阅制，无官方 per-request 发票；本价目仅用于 PR/D1 估计，
 * `cost_source=rate_card`，以控制台配额为准。
 */
export interface RateCardRates {
    inputPer1M: number;
    outputPer1M: number;
    reasoningPer1M: number;
    cacheReadPer1M: number;
    cacheWritePer1M: number;
}

/** kimi-k2.7-code 估计档（对齐常见 coding 模型量级，非官方价） */
export const OPENCODE_GO_KIMI_K27_CODE_RATES: RateCardRates = {
    inputPer1M: 0.6,
    outputPer1M: 2.5,
    reasoningPer1M: 2.5,
    cacheReadPer1M: 0.15,
    cacheWritePer1M: 0.75,
};

const RATE_CARDS: Record<string, RateCardRates> = {
    'kimi-k2.7-code': OPENCODE_GO_KIMI_K27_CODE_RATES,
    'opencode-go/kimi-k2.7-code': OPENCODE_GO_KIMI_K27_CODE_RATES,
};

export function resolveRateCard(modelId: string | undefined): RateCardRates | null {
    if (!modelId?.trim()) {
        return OPENCODE_GO_KIMI_K27_CODE_RATES;
    }
    const id = modelId.trim();
    if (RATE_CARDS[id]) {
        return RATE_CARDS[id];
    }
    const slash = id.indexOf('/');
    if (slash > 0) {
        const bare = id.slice(slash + 1);
        if (RATE_CARDS[bare]) {
            return RATE_CARDS[bare];
        }
    }
    // 未知 Go 模型：仍用默认估计，避免 none
    if (id.startsWith('opencode-go/')) {
        return OPENCODE_GO_KIMI_K27_CODE_RATES;
    }
    return null;
}

export function estimateCostUsdFromRateCard(tokens: TokenBuckets, rates: RateCardRates): number {
    const usd =
        (tokens.tokens_input / 1_000_000) * rates.inputPer1M +
        (tokens.tokens_output / 1_000_000) * rates.outputPer1M +
        (tokens.tokens_reasoning / 1_000_000) * rates.reasoningPer1M +
        (tokens.tokens_cache_read / 1_000_000) * rates.cacheReadPer1M +
        (tokens.tokens_cache_write / 1_000_000) * rates.cacheWritePer1M;
    return Number.isFinite(usd) ? usd : 0;
}
