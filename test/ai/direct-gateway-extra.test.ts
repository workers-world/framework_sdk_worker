import { describe, expect, it } from 'vitest';
import { runChatDirect } from '../../src/ai/direct.js';
import {
    aiGatewayRunOptions,
    buildAiGatewayConfig,
    callAiModel,
    isPrunaModel,
    resolveGatewayId,
    shouldUseAiGateway,
} from '../../src/ai/gateway.js';

function fakeAi(response: unknown): Ai {
    return {
        run: async () => response,
    } as unknown as Ai;
}

describe('runChatDirect content extraction', () => {
    it('accepts raw string, nested result.response, and clamps temperature', async () => {
        await expect(
            runChatDirect(fakeAi('  hello  '), {
                model: 'm',
                messages: [{ role: 'user', content: 'x' }],
            }),
        ).resolves.toMatchObject({ ok: true, content: 'hello' });

        await expect(
            runChatDirect(fakeAi({ result: { response: ' nested ' } }), {
                model: 'm',
                messages: [{ role: 'user', content: 'x' }],
                temperature: 2,
                max_tokens: 3.9,
            }),
        ).resolves.toMatchObject({ ok: true, content: 'nested' });

        await expect(
            runChatDirect(fakeAi({}), {
                model: 'm',
                messages: [{ role: 'user', content: 'x' }],
            }),
        ).resolves.toMatchObject({ ok: false, error: 'AI 返回空内容' });

        await expect(
            runChatDirect(fakeAi('   '), {
                model: 'm',
                messages: [{ role: 'user', content: 'x' }],
            }),
        ).resolves.toMatchObject({ ok: false });

        await expect(
            runChatDirect(fakeAi(12), {
                model: 'm',
                messages: [{ role: 'user', content: 'x' }],
            }),
        ).resolves.toMatchObject({ ok: false });
    });

    it('maps non-Error throw', async () => {
        const ai = {
            run: async () => {
                throw 'raw';
            },
        } as unknown as Ai;
        await expect(
            runChatDirect(ai, { model: 'm', messages: [{ role: 'user', content: 'x' }] }),
        ).resolves.toEqual({ ok: false, error: 'raw' });
    });
});

describe('gateway helpers extra', () => {
    it('resolveGatewayId / build config / pruna / headers', () => {
        expect(resolveGatewayId()).toBe('default');
        expect(resolveGatewayId('  gw  ')).toBe('gw');
        expect(
            buildAiGatewayConfig({ AI_GATEWAY_ID: 'g', AIG_AUTH_TOKEN: 't', AIG_BYOK_ALIAS: 'a' }),
        ).toEqual({
            gatewayId: 'g',
            authToken: 't',
            byokAlias: 'a',
        });
        expect(isPrunaModel('pruna/x')).toBe(true);
        expect(isPrunaModel('@cf/x')).toBe(false);
        expect(shouldUseAiGateway('pruna/x', { prompt: 'p' })).toBe(true);
        expect(shouldUseAiGateway('@cf/x', { prompt: 'p' })).toBe(false);
        expect(shouldUseAiGateway('openai/gpt', { prompt: 'p' })).toBe(true);

        const opts = aiGatewayRunOptions({
            gatewayId: 'g',
            authToken: 'tok',
            byokAlias: 'alias',
        });
        expect(opts.gateway.id).toBe('g');
        expect(opts.extraHeaders?.['cf-aig-authorization']).toBe('Bearer tok');
        expect(opts.extraHeaders?.['cf-aig-byok-alias']).toBe('alias');

        const already = aiGatewayRunOptions({ authToken: 'Bearer abc' });
        expect(already.extraHeaders?.['cf-aig-authorization']).toBe('Bearer abc');
        expect(aiGatewayRunOptions().extraHeaders).toBeUndefined();
    });

    it('callAiModel with FormData skips gateway id', async () => {
        const fd = new FormData();
        fd.append('f', '1');
        let options: unknown;
        const ai = {
            run: async (_m: string, _i: unknown, opts?: unknown) => {
                options = opts;
                return { response: 'ok' };
            },
        } as unknown as Ai;
        await callAiModel(ai, '@cf/x', { multipart: { body: fd } }, { authToken: 't' });
        expect(options).toMatchObject({ extraHeaders: { 'cf-aig-authorization': 'Bearer t' } });
    });

    it('skips gateway for ReadableStream inputs', async () => {
        const stream = new ReadableStream();
        expect(shouldUseAiGateway('m', { body: stream })).toBe(false);
        expect(shouldUseAiGateway('@cf/x', { messages: [{ role: 'user', content: 'x' }] })).toBe(
            true,
        );
        expect(shouldUseAiGateway('@cf/x', {})).toBe(false);
        expect(isPrunaModel('pruna/fast')).toBe(true);
        expect(resolveGatewayId('  ')).toBe('default');
        expect(buildAiGatewayConfig({})).toEqual({
            gatewayId: undefined,
            authToken: undefined,
            byokAlias: undefined,
        });
    });
});
