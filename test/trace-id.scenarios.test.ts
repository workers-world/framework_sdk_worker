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
    normalizeSpanId,
    normalizeTraceId,
    parseTraceparent,
    TRACE_DOMAINS,
} from '../src/trace-id/index.js';

const TRACE = '5b8aa5a2d2c872e8321cf37308d69df2';
const SPAN = '00f067aa0ba902b7';
const LEGACY_UUID = '5b8aa5a2-d2c8-72e8-321c-f37308d69df2';

describe('故事 traceId', () => {
    it('新铸造是 32 位小写 hex，且本身不是 span', () => {
        const traceId = mintTraceId();
        expect(normalizeTraceId(`  ${traceId.toUpperCase()}  `)).toBe(traceId);
        expect(isTraceId(traceId)).toBe(true);
        expect(isSpanId(traceId)).toBe(false);
    });

    it('旧 UUID 收成同一条 32 hex，全 0 仍拒绝', () => {
        expect(normalizeTraceId(LEGACY_UUID.toUpperCase())).toBe(TRACE);
        expect(isTraceId(LEGACY_UUID)).toBe(true);
        expect(() => normalizeTraceId('00000000-0000-0000-0000-000000000000')).toThrow(
            InvalidTraceIdError,
        );
        expect(() => normalizeTraceId('0'.repeat(32))).toThrow(InvalidTraceIdError);
    });

    it.each([
        ['自造前缀', 'trc_desk_20260921_k7m2n9p4qx'],
        ['span 前缀', 'spn_desk_k7m2n9p4qx_a3f8c1d2'],
        ['sch 流水号', 'SCH20260911000007'],
        ['inv 流水号', 'INV20260921000001'],
        ['cfg 流水号', 'CFG20260812-000123'],
        ['质量 dedupKey', 'ops.error:quality-digest'],
        ['cf-ray', '8f3a1b2c3d4e5f6a-SJC'],
        ['空白', '   '],
    ])('%s 不是 traceId', (_label, raw) => {
        expect(isTraceId(raw)).toBe(false);
        expect(() => normalizeTraceId(raw)).toThrow(InvalidTraceIdError);
    });
});

describe('步骤 spanId', () => {
    it('新铸造是 16 hex，不把父 trace 编进字符串', () => {
        const traceId = mintTraceId();
        const spanId = mintSpanId();
        expect(spanId).toMatch(/^[0-9a-f]{16}$/);
        expect(spanId).not.toBe(traceId);
        expect(spanId.includes(traceId)).toBe(false);
        expect(isSpanId(spanId)).toBe(true);
        expect(isTraceId(spanId)).toBe(false);
        expect(normalizeSpanId(`  ${spanId.toUpperCase()}  `)).toBe(spanId);
    });

    it.each([
        ['整段 trace', TRACE],
        ['旧 UUID', LEGACY_UUID],
        ['全 0', '0'.repeat(16)],
        ['流水号', 'SCH20260911000007'],
    ])('%s 不是 spanId', (_label, raw) => {
        expect(isSpanId(raw)).toBe(false);
        expect(() => normalizeSpanId(raw)).toThrow(InvalidTraceIdError);
    });
});

describe('traceparent 传播', () => {
    it('同一 trace 下两个 span 只换 span-id', () => {
        const first = mintSpanId();
        const second = mintSpanId();
        const a = formatTraceparent(LEGACY_UUID, first);
        const b = formatTraceparent(TRACE, second, ' 00 ');
        expect(a).toBe(`00-${TRACE}-${first}-01`);
        expect(b).toBe(`00-${TRACE}-${second}-00`);
        expect(parseTraceparent(a).traceId).toBe(parseTraceparent(b).traceId);
        expect(parseTraceparent(a).spanId).not.toBe(parseTraceparent(b).spanId);
    });

    it.each([
        ['版本 ff', `ff-${TRACE}-${SPAN}-01`],
        ['版本 01', `01-${TRACE}-${SPAN}-01`],
        ['全 0 trace', `00-${'0'.repeat(32)}-${SPAN}-01`],
        ['全 0 span', `00-${TRACE}-${'0'.repeat(16)}-01`],
        ['自造前缀', 'trc_desk_20260921_k7m2n9p4qx'],
        ['缺段', `00-${TRACE}-01`],
    ])('拒绝 %s', (_label, raw) => {
        expect(() => parseTraceparent(raw)).toThrow(InvalidTraceIdError);
    });

    it('拒绝非法 flags', () => {
        expect(() => formatTraceparent(TRACE, SPAN, '1')).toThrow(InvalidTraceIdError);
        expect(() => formatTraceparent(TRACE, SPAN, 'gg')).toThrow(InvalidTraceIdError);
    });
});

describe('人读标签与领域', () => {
    it.each(TRACE_DOMAINS)('领域 %s 只出现在标签和 tracestate', (domain) => {
        expect(formatTraceRef({ domain, traceId: LEGACY_UUID })).toBe(`${domain} 5b8aa5a2d2c872e8`);
        expect(formatTracestate(domain)).toBe(`ww=${domain}`);
        expect(isTraceId(formatTraceRef({ domain, traceId: TRACE }))).toBe(false);
        expect(isTraceId(formatTracestate(domain))).toBe(false);
    });

    it('未知领域不能当标签', () => {
        expect(() => formatTraceRef({ domain: 'billing', traceId: TRACE })).toThrow(
            InvalidTraceIdError,
        );
        expect(() => formatTracestate('billing')).toThrow(InvalidTraceIdError);
    });
});
