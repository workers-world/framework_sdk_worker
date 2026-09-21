import { describe, expect, it } from 'vitest';
import {
    formatTraceparent,
    formatTraceRef,
    formatTracestate,
    InvalidTraceIdError,
    isSpanId,
    isTraceId,
    mintSpanId,
    mintTraceId,
    normalizeTraceId,
    parseTraceparent,
} from '../src/trace-id/index.js';

const TRACEPARENT_RE = /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/;

describe('mintTraceId / mintSpanId', () => {
    it('mints lowercase hex and never all zeros', () => {
        const traceId = mintTraceId();
        const spanId = mintSpanId();
        expect(traceId).toMatch(/^[0-9a-f]{32}$/);
        expect(spanId).toMatch(/^[0-9a-f]{16}$/);
        expect(traceId).not.toMatch(/^0+$/);
        expect(spanId).not.toMatch(/^0+$/);
        expect(mintTraceId()).not.toBe(traceId);
        expect(isTraceId(traceId)).toBe(true);
        expect(isSpanId(spanId)).toBe(true);
    });
});

describe('normalizeTraceId', () => {
    it('accepts 32 hex and dashed UUID', () => {
        const hex = '5b8aa5a2d2c872e8321cf37308d69df2';
        expect(normalizeTraceId(hex)).toBe(hex);
        expect(normalizeTraceId('5B8AA5A2-D2C8-72E8-321C-F37308D69DF2')).toBe(hex);
    });

    it('rejects empty, short, and all-zero ids', () => {
        expect(() => normalizeTraceId('')).toThrow(InvalidTraceIdError);
        expect(() => normalizeTraceId('not-a-trace')).toThrow(InvalidTraceIdError);
        expect(() => normalizeTraceId('0'.repeat(32))).toThrow(InvalidTraceIdError);
        expect(isTraceId('desk_20260921')).toBe(false);
    });
});

describe('traceparent', () => {
    it('round-trips a minted pair', () => {
        const traceId = mintTraceId();
        const spanId = mintSpanId();
        const header = formatTraceparent(traceId, spanId);
        expect(header).toMatch(TRACEPARENT_RE);
        expect(parseTraceparent(`  ${header.toUpperCase()}  `)).toEqual({
            version: '00',
            traceId,
            spanId,
            flags: '01',
        });
    });

    it('rejects version ff and zero span', () => {
        const traceId = mintTraceId();
        expect(() => parseTraceparent(`ff-${traceId}-${'ab'.repeat(8)}-01`)).toThrow(
            InvalidTraceIdError,
        );
        expect(() => parseTraceparent(`00-${traceId}-${'0'.repeat(16)}-01`)).toThrow(
            InvalidTraceIdError,
        );
    });
});

describe('formatTraceRef / formatTracestate', () => {
    it('labels a trace without becoming the stored id', () => {
        const traceId = '5b8aa5a2d2c872e8321cf37308d69df2';
        expect(formatTraceRef({ domain: 'desk', traceId })).toBe('desk 5b8aa5a2d2c872e8');
        expect(formatTracestate('desk')).toBe('ww=desk');
        expect(formatTraceRef({ domain: 'desk', traceId })).not.toBe(traceId);
    });

    it('rejects an unknown domain', () => {
        expect(() => formatTraceRef({ domain: 'billing', traceId: mintTraceId() })).toThrow(
            InvalidTraceIdError,
        );
    });
});
