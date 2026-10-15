import { describe, expect, it } from 'vitest';
import { CLEF_FLASH_MODEL, clefNoulAnswer, runClefNoul } from '../../src/ai/clef.js';

describe('clefNoulAnswer', () => {
    it('maps probability to boolean at 0.5 threshold', () => {
        expect(clefNoulAnswer({ q: { noul: 0.8 } }, 'q')).toBe(true);
        expect(clefNoulAnswer({ q: { noul: 0.2 } }, 'q')).toBe(false);
        expect(clefNoulAnswer({ q: { noul: 0.5 } }, 'q')).toBe(true);
        expect(clefNoulAnswer({}, 'q')).toBeNull();
        expect(clefNoulAnswer({ q: { noul: 0.4 } }, 'q', 0.3)).toBe(true);
    });

    it('returns null for missing or non-finite noul', () => {
        expect(clefNoulAnswer({ q: {} }, 'q')).toBeNull();
        expect(clefNoulAnswer({ q: { noul: Number.NaN } }, 'q')).toBeNull();
        expect(clefNoulAnswer(undefined, 'q')).toBeNull();
    });
});

describe('runClefNoul', () => {
    it('calls AI.run with model/state/questions (System One)', async () => {
        let capturedModel: string | undefined;
        let capturedInput: unknown;
        let capturedOpts: unknown;
        const ai = {
            run: async (model: string, input: unknown, opts?: unknown) => {
                capturedModel = model;
                capturedInput = input;
                capturedOpts = opts;
                return {
                    answers: {
                        is_invest_related: { noul: 0.9 },
                    },
                };
            },
        };
        const result = await runClefNoul(ai as never, {
            state: '# title\n\nsnippet',
            questions: {
                is_invest_related: {
                    type: 'noul',
                    instructions: '投资相关？',
                },
            },
            tags: ['caller:test'],
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(clefNoulAnswer(result.answers, 'is_invest_related')).toBe(true);
        }
        expect(capturedModel).toBe(CLEF_FLASH_MODEL);
        expect(capturedInput).toMatchObject({
            model: 'clef-flash',
            state: '# title\n\nsnippet',
            questions: {
                is_invest_related: { type: 'noul', instructions: '投资相关？' },
            },
        });
        expect(capturedOpts).toEqual({ tags: ['caller:test'] });
    });

    it('returns ok=false when AI missing', async () => {
        const result = await runClefNoul(undefined, {
            state: 'x',
            questions: { q: { type: 'noul', instructions: 'y' } },
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toContain('AI binding');
        }
    });

    it('returns ok=false on throw', async () => {
        const ai = {
            run: async () => {
                throw new Error('upstream 503');
            },
        };
        const result = await runClefNoul(ai as never, {
            state: 'x',
            questions: { q: { type: 'noul', instructions: 'y' } },
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toContain('503');
        }
    });

    it('returns ok=false for empty state or questions', async () => {
        const ai = { run: async () => ({ answers: {} }) };
        expect(
            (
                await runClefNoul(ai as never, {
                    state: '  ',
                    questions: { q: { type: 'noul', instructions: 'y' } },
                })
            ).ok,
        ).toBe(false);
        expect((await runClefNoul(ai as never, { state: 'x', questions: {} })).ok).toBe(false);
    });
});
