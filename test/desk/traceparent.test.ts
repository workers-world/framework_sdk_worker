import { describe, expect, it } from 'vitest';
import {
    createDeskSignalTraceBundle,
    createTraceparent,
    injectTraceparent,
    readCfRequestId,
    readTraceparent,
    TRACEPARENT_HEADER,
    TRACESTATE_HEADER,
} from '../../src/desk/traceparent.js';

const TRACEPARENT_RE = /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/;

describe('createTraceparent', () => {
    it('emits W3C version-00 sampled traceparent', () => {
        const value = createTraceparent();
        expect(value).toMatch(TRACEPARENT_RE);
        expect(createTraceparent()).not.toBe(value);
    });
});

describe('injectTraceparent', () => {
    it('writes into a Headers instance without dropping existing keys', () => {
        const headers = new Headers({ 'x-existing': '1' });
        const injected = injectTraceparent(headers, '00-aa-bb-01');
        expect(injected.get(TRACEPARENT_HEADER)).toBe('00-aa-bb-01');
        expect(injected.get('x-existing')).toBe('1');
    });

    it('accepts a plain header init object', () => {
        const injected = injectTraceparent({ accept: 'application/json' }, '00-cc-dd-01');
        expect(injected.get(TRACEPARENT_HEADER)).toBe('00-cc-dd-01');
        expect(injected.get('accept')).toBe('application/json');
    });
});

describe('readTraceparent / readCfRequestId', () => {
    it('reads trimmed traceparent or undefined when blank', () => {
        const req = new Request('https://example.com', {
            headers: { [TRACEPARENT_HEADER]: '  00-ee-ff-01  ' },
        });
        expect(readTraceparent(req)).toBe('00-ee-ff-01');
        expect(readTraceparent(new Request('https://example.com'))).toBeUndefined();
        expect(
            readTraceparent(
                new Request('https://example.com', { headers: { [TRACEPARENT_HEADER]: '   ' } }),
            ),
        ).toBeUndefined();
    });

    it('reads cf-ray from response', () => {
        expect(readCfRequestId(new Response('', { headers: { 'cf-ray': '  ray-1  ' } }))).toBe(
            'ray-1',
        );
        expect(readCfRequestId(new Response(''))).toBeUndefined();
        expect(readCfRequestId(new Response('', { headers: { 'cf-ray': '  ' } }))).toBeUndefined();
    });
});

describe('createDeskSignalTraceBundle', () => {
    it('pairs UUID lineage with matching hex traceId in traceparent', () => {
        const bundle = createDeskSignalTraceBundle();
        expect(bundle.traceId).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );
        expect(bundle.traceparent).toMatch(TRACEPARENT_RE);
        const hexTrace = bundle.traceId.replace(/-/g, '');
        expect(bundle.traceparent).toContain(`-${hexTrace}-`);
        expect(TRACESTATE_HEADER).toBe('tracestate');
    });
});
