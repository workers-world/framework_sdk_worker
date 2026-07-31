export type FundQuoteSource = 'estimate' | 'nav';

export interface FundNav {
    code: string;
    name: string;
    nav: number;
    accNav: number | null;
    changePct: number | null;
    navDate: string;
    source: 'tencent';
}

export interface FundEstimate {
    code: string;
    name: string;
    nav: number;
    navDate: string;
    estimatedNav: number;
    estimatedChangePct: number;
    estimateTime: string;
    source: 'eastmoney';
}

export interface FundQuote {
    fundCode: string;
    fundName: string;
    nav: number | null;
    navDate: string | null;
    estimatedNav: number | null;
    estimatedChangePct: number | null;
    quoteTime: string;
    source: FundQuoteSource;
}
