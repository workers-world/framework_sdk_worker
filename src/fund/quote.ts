import {fetchEastmoneyEstimateWithRetry} from './eastmoney-estimate.js';
import {normalizeFundCode} from './normalize-code.js';
import {fetchTencentNavWithRetry} from './tencent-nav.js';
import type {FundQuote} from './types.js';

export function markPriceFromQuote(quote: Pick<FundQuote, 'estimatedNav' | 'nav'>): number | null {
    const estimate = quote.estimatedNav;
    if (estimate != null && estimate > 0) {
        return estimate;
    }
    const nav = quote.nav;
    if (nav != null && nav > 0) {
        return nav;
    }
    return null;
}

export async function fetchFundQuoteEstimate(code: string, quoteTime: string): Promise<FundQuote> {
    const fundCode = normalizeFundCode(code);
    const estimate = await fetchEastmoneyEstimateWithRetry(fundCode);
    return {
        fundCode,
        fundName: estimate.name,
        nav: estimate.nav,
        navDate: estimate.navDate,
        estimatedNav: estimate.estimatedNav,
        estimatedChangePct: estimate.estimatedChangePct,
        quoteTime,
        source: 'estimate',
    };
}

export async function fetchFundQuoteNav(code: string, quoteTime: string): Promise<FundQuote> {
    const fundCode = normalizeFundCode(code);
    const nav = await fetchTencentNavWithRetry(fundCode);
    return {
        fundCode,
        fundName: nav.name,
        nav: nav.nav,
        navDate: nav.navDate,
        estimatedNav: null,
        estimatedChangePct: nav.changePct,
        quoteTime,
        source: 'nav',
    };
}
