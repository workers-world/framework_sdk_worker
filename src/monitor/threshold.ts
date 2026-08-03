/** 买入：价格接近或已低于触发；卖出/止盈：价格接近或已高于触发 */
export function withinAlertBand(
    direction: 'sell' | 'buy',
    diffPct: number,
    threshold: number,
): boolean {
    if (direction === 'buy') {
        return diffPct <= threshold;
    }
    return diffPct >= -threshold;
}

/** 止盈 diffPct = profitPct - target；穿过 target 后每 step 一档 */
export function computeNotifyTier(
    direction: 'sell' | 'buy',
    diffPct: number,
    stepPct: number,
): number {
    if (direction === 'buy') {
        if (diffPct > 0) {
            return 0;
        }
        return Math.ceil(Math.abs(diffPct) / stepPct);
    }
    if (diffPct < 0) {
        return 0;
    }
    return Math.ceil(diffPct / stepPct);
}

export function buildDedupKey(prefix: string, scope: string, today: string, tier: number): string {
    return `${prefix}:${scope}:${today}:t${tier}`;
}
