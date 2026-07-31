import {describe, expect, it} from 'vitest';
import {parseFundGzJsonp} from './eastmoney-estimate.js';
import {isFundCode, normalizeFundCode} from './normalize-code.js';
import {computeNotifyTier, withinAlertBand} from '../monitor/threshold.js';
import {markPriceFromQuote} from './quote.js';

describe('normalizeFundCode', () => {
    it('accepts 6-digit code', () => {
        expect(normalizeFundCode('110022')).toBe('110022');
    });

    it('rejects invalid code', () => {
        expect(() => normalizeFundCode('AU9999')).toThrow();
    });
});

describe('isFundCode', () => {
    it('detects fund code', () => {
        expect(isFundCode('005827')).toBe(true);
        expect(isFundCode('AU9999')).toBe(false);
    });
});

describe('parseFundGzJsonp', () => {
    it('parses jsonp payload', () => {
        const payload = parseFundGzJsonp('jsonpgz({"fundcode":"110022","name":"测试","dwjz":"3.5000","jzrq":"2026-07-14","gsz":"3.5200","gszzl":"0.57","gztime":"2026-07-15 14:30"});');
        expect(payload.fundcode).toBe('110022');
        expect(payload.gsz).toBe('3.5200');
    });
});

describe('markPriceFromQuote', () => {
    it('prefers estimate', () => {
        expect(markPriceFromQuote({estimatedNav: 3.52, nav: 3.5})).toBe(3.52);
    });
});

describe('threshold helpers', () => {
    it('withinAlertBand for sell/take-profit', () => {
        expect(withinAlertBand('sell', -0.01, 0.02)).toBe(true);
        expect(withinAlertBand('sell', -0.03, 0.02)).toBe(false);
    });

    it('computeNotifyTier after target hit', () => {
        expect(computeNotifyTier('sell', 0.01, 0.005)).toBe(2);
    });
});
