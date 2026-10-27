import { describe, expect, it } from 'vitest';
import {
    CLEF_FLASH_MODEL,
    clefChoiceAnswer,
    clefNoulAnswer,
    clefScoreAnswer,
    runClefEvaluate,
    runClefNoul,
} from '../../src/ai/clef.js';

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

describe('clefChoiceAnswer / clefScoreAnswer', () => {
    it('reads choice and score', () => {
        expect(clefChoiceAnswer({ a: { choice: 'dismiss' } }, 'a')).toBe('dismiss');
        expect(clefChoiceAnswer({ a: { choice: '  ' } }, 'a')).toBeNull();
        expect(clefChoiceAnswer({}, 'a')).toBeNull();
        expect(clefScoreAnswer({ n: { score: 4.2 } }, 'n')).toBe(4.2);
        expect(clefScoreAnswer({ n: { score: Number.NaN } }, 'n')).toBeNull();
        expect(clefScoreAnswer(undefined, 'n')).toBeNull();
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
            expect(result.model).toBe(CLEF_FLASH_MODEL);
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

describe('runClefEvaluate', () => {
    it('supports choice + score + noul in one call', async () => {
        let capturedInput: unknown;
        const ai = {
            run: async (_model: string, input: unknown) => {
                capturedInput = input;
                return {
                    model: 'clef-flash',
                    answers: {
                        action: {
                            type: 'choice',
                            choice: 'dismiss',
                            confidence: 0.9,
                            probabilities: { dismiss: 0.9, keep: 0.05, needs_human: 0.05 },
                        },
                        is_security: { type: 'noul', noul: 0.1 },
                        noise: { type: 'score', score: 4.1, confidence: 0.88 },
                    },
                };
            },
        };
        const result = await runClefEvaluate(ai as never, {
            state: 'finding about outdated comment',
            questions: {
                action: {
                    type: 'choice',
                    instructions: 'Should this intake be dismissed?',
                    criteria: {
                        dismiss: 'Noise / DX only',
                        keep: 'Actionable',
                        needs_human: 'Uncertain',
                    },
                },
                is_security: {
                    type: 'noul',
                    instructions: 'Is this security related?',
                },
                noise: {
                    type: 'score',
                    instructions: 'How noisy is this finding?',
                    criteria: [
                        'Very signal',
                        'Mostly signal',
                        'Mixed',
                        'Mostly noise',
                        'Pure noise',
                    ],
                },
            },
            tags: ['caller:sch1:intake-triage'],
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(clefChoiceAnswer(result.answers, 'action')).toBe('dismiss');
            expect(clefNoulAnswer(result.answers, 'is_security')).toBe(false);
            expect(clefScoreAnswer(result.answers, 'noise')).toBe(4.1);
            expect(result.model).toBe('clef-flash');
        }
        expect(capturedInput).toMatchObject({
            model: 'clef-flash',
            questions: {
                action: { type: 'choice' },
                is_security: { type: 'noul' },
                noise: { type: 'score' },
            },
        });
    });

    it('allows overriding binding model id', async () => {
        let capturedModel: string | undefined;
        const ai = {
            run: async (model: string) => {
                capturedModel = model;
                return { answers: {} };
            },
        };
        const result = await runClefEvaluate(ai as never, {
            state: 'x',
            model: 'typesafe/jev',
            questions: { q: { type: 'noul', instructions: 'y' } },
        });
        expect(result.ok).toBe(true);
        expect(capturedModel).toBe('typesafe/jev');
    });
});
