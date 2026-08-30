import { describe, expect, it, vi } from 'vitest';
import { runChatDirect } from '../../src/ai/direct.js';

function fakeAi(response: unknown, impl?: (model: string) => Promise<unknown>): Ai {
    const run = vi.fn(async (model: string) => {
        if (impl) {
            return impl(model);
        }
        return response;
    });
    return { run } as unknown as Ai;
}

describe('runChatDirect', () => {
    it('returns ok with content from Workers AI {response} shape', async () => {
        const result = await runChatDirect(fakeAi({ response: ' 你好 ' }), {
            model: '@cf/meta/llama-4-scout-17b-16e-instruct',
            messages: [{ role: 'user', content: 'hi' }],
        });
        expect(result.ok).toBe(true);
        expect(result.content).toBe('你好');
    });

    it('extracts content from OpenAI {choices} shape', async () => {
        const ai = fakeAi({
            choices: [{ message: { role: 'assistant', content: 'answer' } }],
        });
        const result = await runChatDirect(ai, {
            model: '@cf/zai-org/glm-4.7-flash',
            messages: [{ role: 'user', content: 'hi' }],
        });
        expect(result.ok).toBe(true);
        expect(result.content).toBe('answer');
    });

    it('returns {ok:false} for empty AI binding and empty messages', async () => {
        expect(
            await runChatDirect(undefined, {
                model: 'm',
                messages: [{ role: 'user', content: 'x' }],
            }),
        ).toMatchObject({ ok: false });
        expect(
            await runChatDirect(fakeAi({ response: 'x' }), { model: 'm', messages: [] }),
        ).toMatchObject({ ok: false });
    });

    it('returns {ok:false} on upstream failure instead of throwing', async () => {
        const ai = fakeAi(undefined, async () => {
            throw new Error('model overloaded');
        });
        const result = await runChatDirect(ai, {
            model: '@cf/x',
            messages: [{ role: 'user', content: 'hi' }],
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('model overloaded');
    });

    it('abandons on timeout with {ok:false} (never hangs)', async () => {
        const ai = {
            run: () =>
                new Promise((_resolve, reject) => {
                    setTimeout(() => reject(new Error('should not surface')), 500);
                }),
        } as unknown as Ai;
        const result = await runChatDirect(
            ai,
            { model: '@cf/x', messages: [{ role: 'user', content: 'hi' }] },
            { timeoutMs: 20 },
        );
        expect(result.ok).toBe(false);
        expect(result.error).toContain('ai.direct chat');
    });

    it('drops non-finite temperature and non-positive max_tokens', async () => {
        let captured: Record<string, unknown> | undefined;
        const ai = {
            run: async (_model: string, inputs: Record<string, unknown>) => {
                captured = inputs;
                return { response: 'ok' };
            },
        } as unknown as Ai;
        await runChatDirect(ai, {
            model: '@cf/x',
            messages: [{ role: 'user', content: 'hi' }],
            temperature: Number.NaN,
            max_tokens: -5,
        });
        expect(captured).toEqual({ messages: [{ role: 'user', content: 'hi' }] });
    });
});
