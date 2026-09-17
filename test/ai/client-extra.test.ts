import { describe, expect, it } from 'vitest';
import { chatGeneral, chatInvest, checkNeuronQuota } from '../../src/ai/client.js';
import { makeFakeFetcher } from '../../src/test/fake-bindings.js';

const params = { model: 'm', messages: [{ role: 'user', content: 'hi' }] };

describe('chatAt extra branches', () => {
    it('chatInvest posts to invest path', async () => {
        let url = '';
        const gw = makeFakeFetcher((u) => {
            url = u;
            return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
                status: 200,
                headers: { 'cf-ray': ' ray-9 ' },
            });
        });
        const result = await chatInvest(
            { SVC_LLM_GATEWAY: gw, LLM_GATEWAY_AUTH_TOKEN: 'tok' },
            params,
        );
        expect(url).toBe('https://llm/v1/chat/invest');
        expect(result.cfRequestId).toBe('ray-9');
        expect(result.ok).toBe(true);
    });

    it('maps HTTP error, empty content, and throw', async () => {
        const http = makeFakeFetcher(
            () =>
                new Response(JSON.stringify({ detail: 'nope' }), {
                    status: 502,
                    statusText: 'Bad Gateway',
                }),
        );
        await expect(
            chatGeneral({ SVC_LLM_GATEWAY: http, LLM_GATEWAY_AUTH_TOKEN: 't' }, params),
        ).resolves.toMatchObject({ ok: false, status: 502, error: 'nope' });

        const empty = makeFakeFetcher(
            () =>
                new Response(JSON.stringify({ choices: [{ message: { content: '  ' } }] }), {
                    status: 200,
                }),
        );
        await expect(
            chatGeneral({ SVC_LLM_GATEWAY: empty, LLM_GATEWAY_AUTH_TOKEN: 't' }, params),
        ).resolves.toMatchObject({ ok: false, error: 'LLM 返回空内容' });

        const boom = makeFakeFetcher(() => {
            throw new Error('timeout');
        });
        await expect(
            chatGeneral({ SVC_LLM_GATEWAY: boom, LLM_GATEWAY_AUTH_TOKEN: 't' }, params),
        ).resolves.toEqual({ ok: false, status: 0, error: 'timeout' });

        const raw = makeFakeFetcher(() => {
            throw 'net';
        });
        await expect(
            chatGeneral({ SVC_LLM_GATEWAY: raw, LLM_GATEWAY_AUTH_TOKEN: 't' }, params),
        ).resolves.toEqual({ ok: false, status: 0, error: 'net' });

        const statusOnly = makeFakeFetcher(
            () => new Response('{}', { status: 503, statusText: 'Gateway Timeout' }),
        );
        await expect(
            chatGeneral({ SVC_LLM_GATEWAY: statusOnly, LLM_GATEWAY_AUTH_TOKEN: 't' }, params),
        ).resolves.toMatchObject({ ok: false, status: 503, error: 'Gateway Timeout' });
    });
});

describe('checkNeuronQuota', () => {
    it('unavailable without binding or token', async () => {
        await expect(checkNeuronQuota({})).resolves.toMatchObject({
            checked: false,
            error: 'SVC_LLM_GATEWAY 未配置',
            remaining: 10_000,
        });
        await expect(
            checkNeuronQuota({ SVC_LLM_GATEWAY: makeFakeFetcher() }, 5),
        ).resolves.toMatchObject({ error: 'LLM_GATEWAY_AUTH_TOKEN 未配置', limit: 5 });
    });

    it('maps success, HTTP error, and throw', async () => {
        const ok = makeFakeFetcher(
            () =>
                new Response(
                    JSON.stringify({
                        ok: true,
                        checked: true,
                        exceeded: true,
                        used: 9,
                        limit: 10,
                        remaining: 1,
                        latched: true,
                    }),
                    { status: 200 },
                ),
        );
        await expect(
            checkNeuronQuota({ SVC_LLM_GATEWAY: ok, LLM_GATEWAY_AUTH_TOKEN: 't' }),
        ).resolves.toEqual({
            ok: true,
            checked: true,
            exceeded: true,
            used: 9,
            limit: 10,
            remaining: 1,
            error: undefined,
            latched: true,
        });

        const http = makeFakeFetcher(
            () => new Response(JSON.stringify({ error: 'no' }), { status: 500 }),
        );
        await expect(
            checkNeuronQuota({ SVC_LLM_GATEWAY: http, LLM_GATEWAY_AUTH_TOKEN: 't' }),
        ).resolves.toMatchObject({ checked: false, error: 'no' });

        const boom = makeFakeFetcher(() => {
            throw new Error('down');
        });
        await expect(
            checkNeuronQuota({ SVC_LLM_GATEWAY: boom, LLM_GATEWAY_AUTH_TOKEN: 't' }),
        ).resolves.toMatchObject({ error: 'down' });
    });

    it('maps default snapshot fields and HTTP fallback text', async () => {
        const empty = makeFakeFetcher(() => new Response('{}', { status: 200 }));
        await expect(
            checkNeuronQuota({ SVC_LLM_GATEWAY: empty, LLM_GATEWAY_AUTH_TOKEN: 't' }, 8),
        ).resolves.toEqual({
            ok: true,
            checked: false,
            exceeded: false,
            used: 0,
            limit: 8,
            remaining: 8,
            error: undefined,
            latched: false,
        });

        const http = makeFakeFetcher(() => new Response('{}', { status: 418 }));
        await expect(
            checkNeuronQuota({ SVC_LLM_GATEWAY: http, LLM_GATEWAY_AUTH_TOKEN: 't' }),
        ).resolves.toMatchObject({ error: 'usage neurons HTTP 418' });

        const boom = makeFakeFetcher(() => {
            throw 'raw';
        });
        await expect(
            checkNeuronQuota({ SVC_LLM_GATEWAY: boom, LLM_GATEWAY_AUTH_TOKEN: 't' }),
        ).resolves.toMatchObject({ error: 'raw' });
    });
});
