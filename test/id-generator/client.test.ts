import { describe, expect, it } from 'vitest';
import { generateId } from '../../src/id-generator/client.js';
import { makeFakeFetcher } from '../../src/test/fake-bindings.js';

describe('generateId', () => {
    it('errors when binding missing', async () => {
        await expect(generateId(undefined, 'tok', 'CMB')).resolves.toEqual({
            ok: false,
            error: 'SVC_COUNTER service binding not configured',
        });
    });

    it('errors when token missing', async () => {
        await expect(generateId(makeFakeFetcher(), undefined, 'CMB')).resolves.toEqual({
            ok: false,
            error: 'COUNTER_AUTH_TOKEN not configured',
        });
    });

    it('returns id on success', async () => {
        const counter = makeFakeFetcher((_url, init) => {
            expect(init?.method).toBe('POST');
            expect(JSON.parse(String(init?.body))).toEqual({ prefix: 'CMB' });
            return new Response(JSON.stringify({ ok: true, id: 'CMB20260101000001' }), {
                status: 200,
            });
        });
        await expect(generateId(counter, 'tok', 'CMB')).resolves.toEqual({
            ok: true,
            id: 'CMB20260101000001',
        });
    });

    it('maps HTTP error body', async () => {
        const counter = makeFakeFetcher(
            () =>
                new Response(JSON.stringify({ error: 'bad prefix', code: 'INVALID' }), {
                    status: 400,
                    statusText: 'Bad Request',
                }),
        );
        await expect(generateId(counter, 'tok', '??')).resolves.toEqual({
            ok: false,
            error: 'bad prefix',
            status: 400,
            code: 'INVALID',
        });
    });

    it('maps HTTP error without JSON', async () => {
        const counter = makeFakeFetcher(
            () => new Response('nope', { status: 502, statusText: 'Bad Gateway' }),
        );
        const result = await generateId(counter, 'tok', 'CMB');
        expect(result.ok).toBe(false);
        expect(result.status).toBe(502);
        expect(result.error).toBe('Bad Gateway');
    });

    it('maps 200 with ok:false', async () => {
        const counter = makeFakeFetcher(
            () =>
                new Response(JSON.stringify({ ok: false, error: 'overflow', code: 'OVF' }), {
                    status: 200,
                }),
        );
        await expect(generateId(counter, 'tok', 'CMB')).resolves.toMatchObject({
            ok: false,
            error: 'overflow',
            status: 200,
            code: 'OVF',
        });
    });

    it('maps 200 with empty JSON as 响应异常', async () => {
        const counter = makeFakeFetcher(() => new Response('null', { status: 200 }));
        const result = await generateId(counter, 'tok', 'CMB');
        expect(result.ok).toBe(false);
        expect(result.error).toContain('counter 响应异常');
    });

    it('catches fetch throw', async () => {
        const counter = makeFakeFetcher(() => {
            throw new Error('timeout');
        });
        await expect(generateId(counter, 'tok', 'CMB')).resolves.toEqual({
            ok: false,
            error: 'timeout',
        });

        const counter2 = makeFakeFetcher(() => {
            throw 'raw';
        });
        await expect(generateId(counter2, 'tok', 'CMB')).resolves.toEqual({
            ok: false,
            error: 'raw',
        });
    });
});
