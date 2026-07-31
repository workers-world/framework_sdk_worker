import {describe, expect, it} from 'vitest';
import {
    normalizeUnderlyingKey,
    newSignalTraceId,
    resolveInvestEventUnderlying,
} from './resolve-underlying.js';

describe('resolve-underlying', () => {
    it('normalizes tickers to uppercase', () => {
        expect(normalizeUnderlyingKey('  aapl ')).toBe('AAPL');
        expect(normalizeUnderlyingKey('600519')).toBe('600519');
    });

    it('prefers explicit over symbols and tags', () => {
        expect(resolveInvestEventUnderlying({
            explicit: 'MSFT',
            symbols: ['AAPL'],
            tags: ['600519'],
        })).toBe('MSFT');
    });

    it('uses symbols before tags', () => {
        expect(resolveInvestEventUnderlying({
            symbols: ['goog'],
            tags: ['600519', 'META'],
        })).toBe('GOOG');
    });

    it('prefers 6-digit tag over ticker tag', () => {
        expect(resolveInvestEventUnderlying({
            tags: ['科技', '600519', 'AAPL'],
        })).toBe('600519');
    });

    it('falls back to ticker-like tag', () => {
        expect(resolveInvestEventUnderlying({
            tags: ['宏观', 'nvda'],
        })).toBe('NVDA');
    });

    it('returns null when no candidate', () => {
        expect(resolveInvestEventUnderlying({tags: ['宏观', '政策']})).toBeNull();
    });

    it('generates uuid trace ids', () => {
        const a = newSignalTraceId();
        const b = newSignalTraceId();
        expect(a).toMatch(/^[0-9a-f-]{36}$/i);
        expect(a).not.toBe(b);
    });
});
